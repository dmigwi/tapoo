import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { EXPECTED_RESPONSE_SCHEMA, buildDuplicateToolCallMessage } from "./context"
import { OLLAMA_PREDICTION_FORMAT } from "./providers"
import { requestPredictionWithAbort } from "./request"
import { CONFIG } from "../config"
import { tapooResetLogs } from "../logs"
import { loadTapooLog } from "../storage"
import type {
  AgentApiConfig,
  MazeActionResult,
  MazeDimensions,
  State,
} from "../types"

const endpoint = "https://agents.example/chat"
const model = "qwen3.6:27b"
const prompt =
  `You are Blue and your traversal speed classifies as trailblazer. You are in the genius zone and might set a new record if you keep it up. Call every available tool once on each turn before returning moves. Start with get_maze_structure to read currentCell, destinationCell, and nearby maze structure; call get_prediction_rules for the required response format, suggested move count, mazeDimensions, and traversal-speed metrics; call get_last_prediction_outcome for current status, score, and the previous prediction outcome. The maze is randomly generated at the start of each level with exactly one path to the destination. For the current level, maze dimensions and wall/open-exit structure are fixed once generated. When present in filteredTraversalHistory, playerName Self marks the start cell. Use openMoves from filteredTraversalHistory entries to build a local map; entries recorded by other players are just as trustworthy as your own. Revisiting a cell already in filteredTraversalHistory is not a mistake. cellType is the only reliable way to know it is a dead-end — never assume a cell you have not yet visited is one, since an unexplored cell's own exits are unknown until you land there and the absence of a connection from cells you already know proves nothing. Only backtrack when your current cell's cellType is dead-end, and only toward a specific visited cell in filteredTraversalHistory with an open exit whose alreadyExplored is false; that cell is one of your actual backtrack targets, not a guess. At higher levels, more junctions mean more short dead-end branches along the solution path, so expect to rule out several before finding the right one — a single clean backtrack is the exception, not the rule. When judging whether one candidate cell is closer to destinationCell than another, compare the full combined distance (row difference plus col difference) for each candidate, not just one axis — a cell closer in column can be equally or further away overall once row is included. By design, the maze never guarantees a direct route from start to destination; the only valid path may require moving away from the target before turning towards it. Use lastMoveStatus to understand the outcome and chargedMovesCount for the exact score-decay impact from that outcome. A turn with any valid moves costs a constant 1 decay units regardless of how many moves it applied. If any of those moves is invalid, that adds a further penalty of 1 decay unit on top - for 2 decay units in total. If the very first submitted move is already invalid — no progress at all — the turn instead costs a flat 2 decay units. A malformed response (invalid JSON, an unknown tool request, or ignoring a duplicate tool call warning) costs a fixed 3 decay units with no moves applied — the costliest outcome of all. One way to sustain a traversal speed above 1.0, keeping your classification at trailblazer, is to build a picture of the maze around your current cell using filteredTraversalHistory and the static maze dimensions. currentCell's openMoves are a natural place to start when extracting high-confidence multi-move predictions. With enough of that picture assembled, you can often find several consecutive moves that are all certain to apply without any invalid-move. You could also invent a better way to sustain that classification. get_prediction_rules provides the required response format and move count guidance. Submitted moves execute in order until the destination is reached or the first invalid move (a wall collision or out-of-bounds step) is hit. Because the charge above is per turn rather than per move, a longer prediction whose moves all land covers more new cells for the same decay. get_prediction_rules explains the live traversal-speed metrics and classification. lastMoveStatus reached-target or status won means the game is complete — stop predicting.`
const developerMessage = prompt
const userMessage = `It is Blue's turn to predict next moves. Use the available tools to see the maze state.`
const agentContextTools = [
  {
    type: "function" as const,
    function: {
      name: "get_maze_structure",
      description:
        "Get current/destination cells and the nearby explored maze structure in one call. Row increases going down, col increases going right; MoveUp decreases row by 1 and MoveDown increases it by 1; MoveLeft decreases col by 1 and MoveRight increases it by 1. filteredTraversalHistory includes only first-visit records within historyWindowRadius of currentCell, preserving chronological order; currentCell is always included because its distance is 0. historyWindowRadius is a fixed configured radius — the maximum Manhattan distance a visited cell in filteredTraversalHistory can be from currentCell — unrelated to how far destinationCell is; compute that yourself from currentCell and destinationCell's row/col if you need it. Each included entry's openMoves maps every fixed open exit from that cell directly to the neighboring cell it leads to and whether that neighbor's own alreadyExplored is true — meaning it has been explored and exists in the full maze traversal history — even when that neighbor itself is outside the filtered result. cellType is precomputed from that same exit count, so you never need to count it yourself: dead-end (one exit), corridor (two exits), or junction (three or more). cellType only ever exists for a cell already in filteredTraversalHistory — an unvisited cell, including one that only appears as a neighbor inside another cell's openMoves, has no known cellType and must never be assumed to be of a specific cellType before visiting. The only way to learn an unvisited cell's own structure is to move there and read its own entry on a later turn. Returns JSON: {\"level\":number, \"currentCell\":{\"row\":number, \"col\":number}|null, \"destinationCell\":{\"row\":number, \"col\":number}|null, \"historyWindowRadius\":number, \"filteredTraversalHistory\":[{\"playerName\":string, \"cell\":{\"row\":number, \"col\":number}, \"cellType\":string, \"openMoves\":{\"MoveLeft\":{\"row\":number, \"col\":number, \"alreadyExplored\":boolean}, ...}}]}.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_prediction_rules",
      description:
        "Get move response rules. suggestedMovesPerTurn is a min/max range for how many moves to include in your predictions response per turn: submit min moves when you are only confident about the immediate next cell or two, and go up to max only when the local map supports a longer high-confidence run. Batching accuracy drops sharply the further out a prediction reaches, so lean toward min rather than max whenever you are unsure. playerUniqueCellsVisited divided by decayUnitsCharged is your current traversal speed, the progress per decay unit spent — a scale grouped by batchEfficiencyClass. Only a cell's first visit counts as progress. The higher the traversal speed, the higher the likelihood of finding the target on time. batchEfficiencyClass is set to backtracker when the speed is below 1.0 (units wasted on invalid moves or oscillation between visited cells), navigator at 1.0 (one new cell move per decay unit), or trailblazer above 1.0 (valid multi-move guesses are paying off — the only classification that can set a new best-score record). allUniqueCellsVisited is every cell any player has reached this level, not just your own — compare it against mazeDimensions.totalMazeCells to know how much of the maze, the team has collectively explored so far. At the initial game levels the single solution path covers nearly all of totalMazeCells, so expect to explore most of the maze before reaching the destination; the path's length relative to totalMazeCells drops only slightly as the level number grows, so at higher levels the destination can be reachable well before allUniqueCellsVisited approaches totalMazeCells. It does not affect your traversal speed, which is scored on playerUniqueCellsVisited against decayUnitsCharged. totalTurnCount is the number of all completed prediction turns in this game level. playerTurnsTaken is the completed turns taken by the player and is reported for context; neither count affects your speed, classification or scores. The resulting score is visible via get_last_prediction_outcome. mazeDimensions.totalMazeCells is the full level size. Before anything is charged on this level, batchEfficiencyClass defaults to trailblazer regardless of these counts, so you start already primed to predict multi-move sequences. Returns JSON: {\"suggestedMovesPerTurn\":{\"min\":number,\"max\":number}, \"allUniqueCellsVisited\":number, \"playerUniqueCellsVisited\":number, \"decayUnitsCharged\":number, \"totalTurnCount\":number, \"playerTurnsTaken\":number, \"batchEfficiencyClass\":string, \"mazeDimensions\":{\"numCols\":number,\"numRows\":number,\"totalMazeCells\":number}|null, \"expectedResponseSchema\":object}.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_last_prediction_outcome",
      description:
        "Get the outcome of the previous submitted moves: whether they fully applied, partially failed, reached the target, or were rejected. status is the current game status, score is the current score after that outcome. lastMoveStatus is the outcome of only the single last move actually dispatched that turn: null=first turn, no history yet; applied=that move executed and was added to traversal history; invalid-move=that move hit a wall or boundary, execution stopped there; reached-target=destination reached, stop predicting; malformed-response=previous response was not valid JSON, requested a tool that does not exist, or ignored a duplicate tool call warning — no moves were replayed and a fixed score penalty was charged; network-error=HTTP failure, no score charged. predictionStatus instead summarizes the entire submitted prediction as one story: all-applied=every submitted move that turn applied cleanly, or the target was reached; partially-applied=some submitted moves applied before one failed; invalid-prediction=a real prediction was replayed but the very first submitted move was already invalid, no progress made; empty-prediction=a malformed-response or network-error meant there was no usable prediction to replay at all. lastSubmittedMoves lists the moves from that turn as zero-based <index>:<move> entries; lastReplayStartIndex is their zero-based offset in the overall submitted move sequence. lastAppliedMoveIndex is the index within lastSubmittedMoves of the last successfully applied move — moves after it were not executed. visitedBefore indicates whether the cell entered by the last valid move was already in traversal history. On an empty-prediction turn these four fields are always reset to null/empty, matching that no moves were replayed — they never carry over stale data from an earlier turn. chargedMovesCount is the total decay units charged toward score that turn. Returns JSON: {\"status\":string, \"score\":number, \"lastPlayerName\":string|null, \"lastMoveStatus\":string|null, \"predictionStatus\":string|null, \"lastReplayStartIndex\":number|null, \"lastSubmittedMoves\":string[], \"lastAppliedMoveIndex\":number|null, \"visitedBefore\":boolean|null, \"chargedMovesCount\":number}.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
]
// uncalledTools builds the follow-up payload: already-called tools are dropped outright, and the
// rest keep their full definitions. Nothing is ever sent name-only, so a definition-less entry can
// never be mistaken for a newly declared tool.
function uncalledTools(calledNames: string[]) {
  const called = new Set(calledNames)
  return agentContextTools.filter(({ function: fn }) => !called.has(fn.name))
}

// expectedLoggedTools mirrors previewLoggedTool: same name, description full or truncated depending
// on keepFull. Every tool on the wire now carries a description, since partial entries are gone.
function expectedLoggedTools(
  wireTools: ReturnType<typeof uncalledTools>,
  keepFull: boolean,
): { name: string; description: string }[] {
  return wireTools.map(({ function: fn }) => ({
    name: fn.name,
    description: keepFull ? fn.description : `${fn.description.slice(0, 25)}...`,
  }))
}

const agent: AgentApiConfig = {
  id: 1,
  playerName: "Blue",
  model,
  endpoint: new URL(endpoint),
  api: "ollama",
  reasoningEffort: "max",
  enabled: true,
}

// Held separately from state so expectations can derive the navigation profile without
// re-narrowing State's nullable mazeDimensions at every assertion site.
const mazeDimensions: MazeDimensions = { numCols: 10, numRows: 10, area: 100 }

const state: State = {
  turnCount: 0,
    cumulativeRoundCount: 0,
  bestWinTraversalSpeedUnits: null,
  bestWinRetentionUnits: null,
  clock: null,
  controlMode: "agent-api",
  finalPosition: { x: 15, y: 17 },
  lastAttemptRetentionUnits: null,
  lastRoundScore: 0,
  lastWinTraversalSpeedUnits: null,
  level: 1,
  maze: null,
  mazeDimensions,
  startPosition: { x: 1, y: 1 },
  playerPosition: { x: 1, y: 1 },
  score: 10000,
  scoreDecayUnits: 0,
  status: "running",
  traversalHistory: [{ playerName: "Self", row: 0, col: 0, openMoves: [] }],
  wallWeight: 1,
  winSummary: "",
}

type SerializedRequestBody = {
  messages: unknown[]
  model: string
  stream: false
  think: true
  tools: unknown[]
  format?: unknown
  options?: unknown
}


function requestInput(
  stateOverrides: Partial<State> = {},
  resultOverrides: Partial<MazeActionResult> = {},
) {
  const lastActionResult =
    Object.keys(resultOverrides).length === 0 ? null : resultOverrides

  return {
    agent,
    lastActionResult,
    state: { ...state, ...stateOverrides },
    timeoutMs: 180_000,
    requestIntervalMs: 0,
  }
}

function requestPrediction(input: Parameters<typeof requestPredictionWithAbort>[0]) {
  return requestPredictionWithAbort(input).promise
}

function successfulResponse(content: string) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue({
      message: { role: "assistant", content },
    }),
  }
}

function toolCallResponse(toolCalls: unknown[]) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue({
      message: {
        role: "assistant",
        content: "",
        tool_calls: toolCalls,
      },
    }),
  }
}

function thinkingToolCallResponse(toolCalls: unknown[]) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue({
      message: {
        role: "assistant",
        content: "",
        thinking: "I should inspect the maze state before predicting moves.",
        tool_calls: toolCalls,
      },
    }),
  }
}

// mazeStructureContent mirrors the exact JSON string sent by the maze-structure tool.
function mazeStructureContent(overrides: Partial<State> = {}): string {
  const nextState = { ...state, ...overrides }
  const currentCell = nextState.playerPosition
    ? {
        row: Math.floor((nextState.playerPosition.y - 1) / 2),
        col: Math.floor((nextState.playerPosition.x - 1) / 2),
      }
    : null
  const destinationCell = nextState.finalPosition
    ? {
        row: Math.floor((nextState.finalPosition.y - 1) / 2),
        col: Math.floor((nextState.finalPosition.x - 1) / 2),
      }
    : null
  const { manhattanDistance: historyWindowRadius } = CONFIG.runtime.modelConfig
  const visitedCells = new Set(
    nextState.traversalHistory.map(({ row, col }) => `${row},${col}`),
  )
  const filteredTraversalHistory = currentCell
    ? nextState.traversalHistory
        .filter(({ row, col }) => Math.abs(row - currentCell.row) + Math.abs(col - currentCell.col) <= historyWindowRadius)
        .map(({ playerName, row, col, openMoves }) => ({
          playerName,
          cell: { row, col },
          cellType: openMoves.length <= 1 ? "dead-end" : openMoves.length === 2 ? "corridor" : "junction",
          openMoves: Object.fromEntries(
            openMoves.map((move) => {
              const [rowDelta, colDelta] = {
                MoveLeft: [0, -1],
                MoveRight: [0, 1],
                MoveUp: [-1, 0],
                MoveDown: [1, 0],
              }[move]
              const neighbor = { row: row + rowDelta, col: col + colDelta }
              return [move, { ...neighbor, alreadyExplored: visitedCells.has(`${neighbor.row},${neighbor.col}`) }]
            }),
          ),
        }))
    : []
  return JSON.stringify({
    level: nextState.level,
    currentCell,
    destinationCell,
    historyWindowRadius,
    filteredTraversalHistory,
  })
}

describe("agent request service", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("documents the raw follow-up json payload sent after a tool call", async () => {
    const expectedJsonInput = {
      model: "qwen3.6:27b",
      messages: [
        {
          role: "system",
          content: developerMessage,
        },
        {
          role: "user",
          content: userMessage,
        },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call_structure",
              function: {
                index: 0,
                name: "get_maze_structure",
                arguments: {},
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_structure",
          tool_name: "get_maze_structure",
          content:
            "{\"level\":1,\"currentCell\":{\"row\":0,\"col\":0},\"destinationCell\":{\"row\":8,\"col\":7},\"historyWindowRadius\":4,\"filteredTraversalHistory\":[{\"playerName\":\"Self\",\"cell\":{\"row\":0,\"col\":0},\"cellType\":\"dead-end\",\"openMoves\":{}}]}",
        },
      ],
      tools: uncalledTools(["get_maze_structure"]),
      options: { num_ctx: CONFIG.runtime.modelConfig.contextWindowFloor, temperature: CONFIG.runtime.modelConfig.temperature, num_predict: CONFIG.runtime.modelConfig.numPredict },
      think: true,
      stream: false,
    }
    const expectedJsonOutput = {
      ok: true,
      moves: ["MoveRight", "MoveDown"],
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        toolCallResponse([
          {
              id: "call_structure",
              function: {
                index: 0,
                name: "get_maze_structure",
                arguments: {},
              },
            },
        ]),
      )
      .mockResolvedValueOnce(
        successfulResponse(JSON.stringify({ moves: expectedJsonOutput.moves })),
      )
    vi.stubGlobal("fetch", fetchMock)

    await expect(requestPrediction(requestInput())).resolves.toEqual(
      expectedJsonOutput,
    )

    const secondRequest = fetchMock.mock.calls[1][1] as RequestInit
    expect(JSON.parse(secondRequest.body as string)).toEqual(expectedJsonInput)
  })

  it("logs the level's first request in full at round 1 only, previewing later rounds", async () => {
    tapooResetLogs(CONFIG.runtime.controlModes.agentApi)

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        toolCallResponse([
          {
            id: "call_structure",
            function: { index: 0, name: "get_maze_structure", arguments: {} },
          },
        ]),
      )
      .mockResolvedValueOnce(
        successfulResponse(JSON.stringify({ moves: ["MoveRight", "MoveDown"] })),
      )
    vi.stubGlobal("fetch", fetchMock)

    await requestPrediction(requestInput())

    const requestEntries = loadTapooLog<{
      payload: string
      details?: {
        requestCount: number
        agentMode: "predict" | "tools"
        tools: { name: string; description?: string }[]
        messages: unknown[]
      }
    }>(CONFIG.runtime.controlModes.agentApi).filter(
      (entry) => entry.payload === "Agent request.",
    )

    expect(requestEntries).toHaveLength(2)

    // turnCount defaults to 0, so this is the level's first agent-api turn: everything logs
    // in full, including the system/user prompt and tool descriptions.
    expect(requestEntries[0].details).toEqual({
      endpoint,
      api: agent.api,
      requestCount: 1,
      agentMode: "tools",
      reasoning: agent.reasoningEffort,
      tools: expectedLoggedTools(uncalledTools([]), true),
      messages: [
        { role: "system", content: developerMessage },
        { role: "user", content: userMessage },
      ],
    })

    // Round 2 logs the full accumulated history (system+user+assistant+tool), not just the new
    // assistant/tool-result messages — no delta tracking, every entry stands on its own. Not
    // every tool has been called yet, so only the still-uncalled tools remain on the wire, all
    // with full definitions. keepFull only covers request 1 (isFirstRequestOfLevel && requestCount <= 1),
    // so by round 2 the system/user prompt and tool descriptions are previewed even within the
    // level's first turn — further limiting duplication across a single turn's tool-call rounds.
    expect(requestEntries[1].details).toEqual({
      endpoint,
      api: agent.api,
      requestCount: 2,
      agentMode: "tools",
      reasoning: agent.reasoningEffort,
      tools: expectedLoggedTools(uncalledTools(["get_maze_structure"]), false),
      messages: [
        { role: "system", content: `${developerMessage.slice(0, 25)}...` },
        { role: "user", content: `${userMessage.slice(0, 25)}...` },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call_structure",
              function: { index: 0, name: "get_maze_structure", arguments: {} },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_structure",
          tool_name: "get_maze_structure",
          content:
            "{\"level\":1,\"currentCell\":{\"row\":0,\"col\":0},\"destinationCell\":{\"row\":8,\"col\":7},\"historyWindowRadius\":4,\"filteredTraversalHistory\":[{\"playerName\":\"Self\",\"cell\":{\"row\":0,\"col\":0},\"cellType\":\"dead-end\",\"openMoves\":{}}]}",
        },
      ],
    })
  })

  it("stamps every request/response entry with the maze level being played", async () => {
    tapooResetLogs(CONFIG.runtime.controlModes.agentApi)

    const fetchMock = vi
      .fn()
      .mockResolvedValue(successfulResponse(JSON.stringify({ moves: ["MoveRight"] })))
    vi.stubGlobal("fetch", fetchMock)

    await requestPrediction(requestInput({ level: 6 }))

    const entries = loadTapooLog<{ payload: string; level: number }>(
      CONFIG.runtime.controlModes.agentApi,
    ).filter((entry) => entry.payload === "Agent request." || entry.payload === "Agent response.")

    expect(entries.length).toBeGreaterThan(0)
    expect(entries.every((entry) => entry.level === 6)).toBe(true)
  })

  it("previews the repeated system/user prompt and tool descriptions in a later turn, every round", async () => {
    tapooResetLogs(CONFIG.runtime.controlModes.agentApi)

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        toolCallResponse([
          {
            id: "call_structure",
            function: { index: 0, name: "get_maze_structure", arguments: {} },
          },
        ]),
      )
      .mockResolvedValueOnce(
        successfulResponse(JSON.stringify({ moves: ["MoveRight", "MoveDown"] })),
      )
    vi.stubGlobal("fetch", fetchMock)

    // turnCount > 0 means this is not the level's first agent-api turn.
    await requestPrediction(requestInput({ turnCount: 1 }))

    const requestEntries = loadTapooLog<{
      payload: string
      details?: {
        requestCount: number
        agentMode: "predict" | "tools"
        tools: { name: string; description?: string }[]
        messages: unknown[]
      }
    }>(CONFIG.runtime.controlModes.agentApi).filter(
      (entry) => entry.payload === "Agent request.",
    )

    expect(requestEntries).toHaveLength(2)

    // Round 1: the static system/user prompt is previewed (role intact, content shortened),
    // and tool descriptions are previewed too, since both repeat verbatim every turn.
    expect(requestEntries[0].details).toEqual({
      endpoint,
      api: agent.api,
      requestCount: 1,
      agentMode: "tools",
      reasoning: agent.reasoningEffort,
      tools: expectedLoggedTools(uncalledTools([]), false),
      messages: [
        { role: "system", content: `${developerMessage.slice(0, 25)}...` },
        { role: "user", content: `${userMessage.slice(0, 25)}...` },
      ],
    })

    // Round 2 logs the full accumulated history too — the previewed system/user messages stay
    // previewed (gated by role, not round, so this stays consistent with round 1), while the
    // assistant/tool-call messages are turn-unique and always log in full.
    expect(requestEntries[1].details).toEqual({
      endpoint,
      api: agent.api,
      requestCount: 2,
      agentMode: "tools",
      reasoning: agent.reasoningEffort,
      tools: expectedLoggedTools(uncalledTools(["get_maze_structure"]), false),
      messages: [
        { role: "system", content: `${developerMessage.slice(0, 25)}...` },
        { role: "user", content: `${userMessage.slice(0, 25)}...` },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call_structure",
              function: { index: 0, name: "get_maze_structure", arguments: {} },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_structure",
          tool_name: "get_maze_structure",
          content:
            "{\"level\":1,\"currentCell\":{\"row\":0,\"col\":0},\"destinationCell\":{\"row\":8,\"col\":7},\"historyWindowRadius\":4,\"filteredTraversalHistory\":[{\"playerName\":\"Self\",\"cell\":{\"row\":0,\"col\":0},\"cellType\":\"dead-end\",\"openMoves\":{}}]}",
        },
      ],
    })
  })

  it("sends the initial chat payload and returns final movement predictions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      successfulResponse("{\"moves\":[\"MoveRight\",\"MoveDown\"]}"),
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(requestPrediction(requestInput())).resolves.toEqual({
      ok: true,
      moves: ["MoveRight", "MoveDown"],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      new URL(endpoint),
      expect.objectContaining({
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
    )

    const request = fetchMock.mock.calls[0][1] as RequestInit
    const requestBody = JSON.parse(request.body as string) as SerializedRequestBody
    expect(requestBody).toEqual({
      model,
      messages: [
        { role: "system", content: developerMessage },
        { role: "user", content: userMessage },
      ],
      tools: agentContextTools,
      options: { num_ctx: CONFIG.runtime.modelConfig.contextWindowFloor, temperature: CONFIG.runtime.modelConfig.temperature, num_predict: CONFIG.runtime.modelConfig.numPredict },
      think: true,
      stream: false,
    })
  })

  it("executes one tool-call round before reading the final prediction", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        toolCallResponse([
          {
            id: "call_1",
            function: { index: 0, name: "get_maze_structure", arguments: {} },
          },
        ]),
      )
      .mockResolvedValueOnce(successfulResponse("{\"moves\":[\"MoveRight\"]}"))
    vi.stubGlobal("fetch", fetchMock)

    const result = await requestPrediction(
      requestInput({
        finalPosition: { x: 3, y: 1 },
        playerPosition: { x: 1, y: 1 },
      }),
    )

    expect(result).toEqual({ ok: true, moves: ["MoveRight"] })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const secondRequest = fetchMock.mock.calls[1][1] as RequestInit
    const secondRequestBody = JSON.parse(secondRequest.body as string) as SerializedRequestBody
    expect(secondRequestBody.messages).toEqual([
      { role: "system", content: developerMessage },
      { role: "user", content: userMessage },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call_1",
            function: {
              index: 0,
              name: "get_maze_structure",
              arguments: {},
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_1",
        tool_name: "get_maze_structure",
        content: mazeStructureContent({
          finalPosition: { x: 3, y: 1 },
          playerPosition: { x: 1, y: 1 },
        }),
      },
    ])
  })

  it("handles multiple context tool calls in one response in order", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        toolCallResponse([
          { function: { name: "get_last_prediction_outcome", arguments: {} } },
          { function: { name: "get_maze_structure", arguments: "{}" } },
        ]),
      )
      .mockResolvedValueOnce(successfulResponse("{\"moves\":[\"MoveDown\"]}"))
    vi.stubGlobal("fetch", fetchMock)

    await requestPrediction(requestInput())

    const secondRequest = fetchMock.mock.calls[1][1] as RequestInit
    const secondRequestBody = JSON.parse(secondRequest.body as string) as SerializedRequestBody
    expect(secondRequestBody.messages.slice(-2)).toEqual([
      {
        role: "tool",
        tool_name: "get_last_prediction_outcome",
        content: JSON.stringify({
          status: state.status,
          score: state.score,
          lastPlayerName: null,
          lastMoveStatus: null,
          predictionStatus: null,
          lastReplayStartIndex: null,
          lastSubmittedMoves: [],
          lastAppliedMoveIndex: null,
          visitedBefore: null,
          chargedMovesCount: 0,
        }),
      },
      {
        role: "tool",
        tool_name: "get_maze_structure",
        content: mazeStructureContent(),
      },
    ])
  })

  it("detects Ollama thinking responses that include native tool calls", async () => {
    const firstResponse = thinkingToolCallResponse([
      {
        id: "call_structure",
        function: { index: 0, name: "get_maze_structure", arguments: {} },
      },
      {
        id: "call_outcome",
        function: { index: 1, name: "get_last_prediction_outcome", arguments: {} },
      },
      {
        id: "call_rules",
        function: { index: 2, name: "get_prediction_rules", arguments: {} },
      },
    ])
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(firstResponse)
      .mockResolvedValueOnce(successfulResponse("{\"moves\":[\"MoveRight\"]}"))
    vi.stubGlobal("fetch", fetchMock)

    await expect(requestPrediction(requestInput())).resolves.toEqual({
      ok: true,
      moves: ["MoveRight"],
    })

    expect(firstResponse.json).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const secondRequest = fetchMock.mock.calls[1][1] as RequestInit
    const secondRequestBody = JSON.parse(secondRequest.body as string) as SerializedRequestBody
    const toolMessages = secondRequestBody.messages.slice(-3) as Array<{
      role: string
      tool_call_id: string
      tool_name: string
      content: string
    }>
    expect(toolMessages.map(({ role, tool_call_id, tool_name }) => ({ role, tool_call_id, tool_name }))).toEqual([
      { role: "tool", tool_call_id: "call_structure", tool_name: "get_maze_structure" },
      { role: "tool", tool_call_id: "call_outcome",   tool_name: "get_last_prediction_outcome" },
      { role: "tool", tool_call_id: "call_rules",     tool_name: "get_prediction_rules" },
    ])
    expect(toolMessages.map(({ content }) => JSON.parse(content) as unknown)).toEqual([
      JSON.parse(mazeStructureContent()) as unknown,
      {
        status: state.status,
        score: state.score,
        lastPlayerName: null,
        lastMoveStatus: null,
        predictionStatus: null,
        lastReplayStartIndex: null,
        lastSubmittedMoves: [],
        lastAppliedMoveIndex: null,
        visitedBefore: null,
        chargedMovesCount: 0,
      },
      {
        suggestedMovesPerTurn: CONFIG.runtime.modelConfig.suggestedMovesPerTurnRange,
        playerUniqueCellsVisited: 0,
        allUniqueCellsVisited: 1,
        decayUnitsCharged: 0,
        totalTurnCount: 0,
        playerTurnsTaken: 0,
        batchEfficiencyClass: "trailblazer",
        mazeDimensions: {
          numCols: state.mazeDimensions?.numCols,
          numRows: state.mazeDimensions?.numRows,
          totalMazeCells: state.mazeDimensions?.area,
        },
        expectedResponseSchema: EXPECTED_RESPONSE_SCHEMA,
      },
    ])
  })

  it("paces requests after the first within a turn by requestIntervalMs, but never before the first", async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        toolCallResponse([
          { function: { name: "get_maze_structure", arguments: {} } },
          { function: { name: "get_prediction_rules", arguments: {} } },
          { function: { name: "get_last_prediction_outcome", arguments: {} } },
        ]),
      )
      .mockResolvedValueOnce(successfulResponse("{\"moves\":[\"MoveRight\"]}"))
    vi.stubGlobal("fetch", fetchMock)

    const result = requestPrediction({ ...requestInput(), requestIntervalMs: 5_000 })

    // The first request fires immediately — no delay applied before it.
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // The second request (servicing the tool results) is held back until requestIntervalMs elapses.
    await vi.advanceTimersByTimeAsync(4_999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await expect(result).resolves.toEqual({ ok: true, moves: ["MoveRight"] })
  })

  it("returns malformed-response when final content is not a valid prediction", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(successfulResponse("not-json")))

    await expect(requestPrediction(requestInput())).resolves.toMatchObject({
      ok: false,
      reason: "malformed-response",
      diagnostic: {
        message: "Malformed agent prediction response.",
        details: { endpoint, requestCount: 1 },
      },
    })
  })

  it("returns network-error for non-ok response, including the provider's raw error body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Unavailable",
        text: vi.fn().mockResolvedValue("{\"error\":\"model overloaded\"}"),
      }),
    )

    await expect(requestPrediction(requestInput())).resolves.toMatchObject({
      ok: false,
      reason: "network-error",
      diagnostic: {
        message: "Provider HTTP response failed.",
        details: {
          endpoint,
          status: 503,
          statusText: "Unavailable",
          responseBody: "{\"error\":\"model overloaded\"}",
        },
      },
    })
  })

  it("still reports a non-ok response when reading its body fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: vi.fn().mockRejectedValue(new Error("stream already used")),
      }),
    )

    await expect(requestPrediction(requestInput())).resolves.toMatchObject({
      ok: false,
      reason: "network-error",
      diagnostic: {
        message: "Provider HTTP response failed.",
        details: {
          endpoint,
          status: 500,
          statusText: "Internal Server Error",
          responseBody: undefined,
        },
      },
    })
  })

  it("returns connection-error for fetch failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("failed")))

    await expect(requestPrediction(requestInput())).resolves.toMatchObject({
      ok: false,
      reason: "connection-error",
      diagnostic: {
        message: "Request failed before a valid response.",
        details: { endpoint, error: "TypeError: failed" },
      },
    })
  })

  it("returns connection-error request failures with actionable diagnostic context", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("failed")))

    await expect(requestPrediction(requestInput())).resolves.toMatchObject({
      ok: false,
      reason: "connection-error",
      diagnostic: {
        message: "Request failed before a valid response.",
        // The actual thrown error is captured as a string here rather than discarded: Error and
        // DOMException instances serialize to "{}" via JSON.stringify (name/message are
        // non-enumerable own properties), so a raw caught error logged as-is would silently vanish
        // from a downloaded log, leaving no way to tell a timeout from a DNS failure after the fact.
        details: { endpoint, error: "TypeError: failed" },
      },
    })
  })

  it("captures a non-Error thrown value as a string instead of discarding it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue("plain string rejection"))

    await expect(requestPrediction(requestInput())).resolves.toMatchObject({
      ok: false,
      reason: "connection-error",
      diagnostic: {
        message: "Request failed before a valid response.",
        details: { endpoint, error: "plain string rejection" },
      },
    })
  })

  it("returns connection-error when the request times out", async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_endpoint: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"))
        })
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = requestPrediction({ ...requestInput(), timeoutMs: 1000 })
    await vi.advanceTimersByTimeAsync(1000)

    await expect(result).resolves.toMatchObject({
      ok: false,
      reason: "connection-error",
      diagnostic: {
        message: "Request failed before a valid response.",
        details: { endpoint, error: "AbortError: aborted" },
      },
    })
  })

  it("stops before the next round when aborted in the gap between rounds", async () => {
    // activeController is briefly null between one round's cleanup and the next round's fetch —
    // aborting in that exact window must still stop the loop rather than silently proceeding to
    // fire another request, which is what the wasExpectedAbort guard at the top of the loop is for.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        toolCallResponse([
          { function: { name: "get_maze_structure", arguments: {} } },
        ]),
      )
      .mockResolvedValueOnce(successfulResponse("{\"moves\":[\"MoveRight\"]}"))
    vi.stubGlobal("fetch", fetchMock)

    const request = requestPredictionWithAbort(requestInput())

    // Let round 1's fetch resolve and the tool-call handling begin before aborting, landing this
    // call in the gap where activeController is momentarily null between rounds.
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    request.abort()

    await expect(request.promise).resolves.toEqual({ ok: false, reason: "caller-abort" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("marks manually aborted requests without throwing provider details", async () => {
    const fetchMock = vi.fn((_endpoint: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"))
        })
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    const request = requestPredictionWithAbort(requestInput())
    request.abort()

    expect(request.isAborted()).toBe(true)
    await expect(request.promise).resolves.toEqual({
      ok: false,
      reason: "caller-abort",
    })
  })

  it.each([
    ["unknown tool", "missing_tool"],
    ["missing tool name", undefined],
  ])("returns malformed-response for a hallucinated tool call (%s)", async (_caseName, name) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        toolCallResponse([{ function: { name, arguments: {} } }]),
      ),
    )

    await expect(requestPrediction(requestInput())).resolves.toMatchObject({
      ok: false,
      reason: "malformed-response",
      diagnostic: {
        message: "Agent requested an unknown or hallucinated tool.",
        details: {
          endpoint,
          requestCount: 1,
          toolNames: name === undefined ? [] : [name],
        },
      },
    })
  })

  it("proactively removes tools when all available tools were called in the previous round", async () => {
    // When r0 calls every tool, calledToolNames covers every available tool before r1 is sent.
    // The proactive check fires first, setting availableTools=[] so r1 goes straight to the
    // format-constrained prediction without sending tools or making another tool-call round.
    const allToolCalls = agentContextTools.map(({ function: { name } }, i) => ({
      id: `call_${i}`,
      function: { index: i, name, arguments: {} },
    }))
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(toolCallResponse(allToolCalls))
      .mockResolvedValueOnce(successfulResponse("{\"moves\":[\"MoveDown\"]}"))
    vi.stubGlobal("fetch", fetchMock)

    await expect(requestPrediction(requestInput())).resolves.toEqual({ ok: true, moves: ["MoveDown"] })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const secondRequest = fetchMock.mock.calls[1][1] as RequestInit
    const secondBody = JSON.parse(secondRequest.body as string) as SerializedRequestBody
    expect(secondBody.tools).toEqual([])
    expect(secondBody.format).toEqual(OLLAMA_PREDICTION_FORMAT.format)
    expect(secondBody.options).toEqual({ num_ctx: CONFIG.runtime.modelConfig.contextWindowFloor, temperature: CONFIG.runtime.modelConfig.temperature, num_predict: CONFIG.runtime.modelConfig.numPredict })
  })

  it("reminds about a duplicate call while still offering the tools genuinely left uncalled", async () => {
    // Round 1: model calls get_last_prediction_outcome (new tool, processed normally).
    // Round 2: model calls get_last_prediction_outcome again (all-duplicate round → reminder naming that
    // specific call is appended; the other tools remain genuinely uncalled, so round 3 still
    // offers them rather than being forced into prediction mode).
    // Round 3: model answers directly anyway.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        toolCallResponse([
          { id: "call_1", function: { index: 0, name: "get_last_prediction_outcome", arguments: {} } },
        ]),
      )
      .mockResolvedValueOnce(
        toolCallResponse([
          { id: "call_2", function: { index: 0, name: "get_last_prediction_outcome", arguments: {} } },
        ]),
      )
      .mockResolvedValueOnce(successfulResponse("{\"moves\":[\"MoveRight\"]}"))
    vi.stubGlobal("fetch", fetchMock)

    const result = await requestPrediction(requestInput())
    expect(result).toEqual({ ok: true, moves: ["MoveRight"] })
    expect(fetchMock).toHaveBeenCalledTimes(3)

    const thirdRequest = fetchMock.mock.calls[2][1] as RequestInit
    const thirdBody = JSON.parse(thirdRequest.body as string) as SerializedRequestBody

    // Round 3 still offers the tools genuinely never called, at full definition, with
    // get_last_prediction_outcome dropped entirely — no early forcing into prediction mode.
    expect(thirdBody.tools).toEqual(uncalledTools(["get_last_prediction_outcome"]))
    expect(thirdBody.format).toBeUndefined()

    // The duplicate reminder names the specific repeated call, not a blanket "no tools left" claim.
    // Exact wording is covered by context.test.ts's buildDuplicateToolCallMessage suite.
    expect(thirdBody.messages.at(-1)).toEqual(
      buildDuplicateToolCallMessage([
        { id: "call_2", function: { index: 0, name: "get_last_prediction_outcome", arguments: {} } },
      ]),
    )
  })

  it("services the new call in a mixed round and only reminds about the duplicate", async () => {
    // Round 1: model calls get_last_prediction_outcome (new).
    // Round 2: model calls get_last_prediction_outcome again (duplicate) AND get_maze_structure (new) in the
    // same response — only get_maze_structure should be serviced; get_last_prediction_outcome should get a
    // reminder instead of a re-served payload.
    // Round 3: model predicts.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        toolCallResponse([
          { id: "call_1", function: { index: 0, name: "get_last_prediction_outcome", arguments: {} } },
        ]),
      )
      .mockResolvedValueOnce(
        toolCallResponse([
          { id: "call_2", function: { index: 0, name: "get_last_prediction_outcome", arguments: {} } },
          { id: "call_3", function: { index: 1, name: "get_maze_structure", arguments: {} } },
        ]),
      )
      .mockResolvedValueOnce(successfulResponse("{\"moves\":[\"MoveRight\"]}"))
    vi.stubGlobal("fetch", fetchMock)

    const result = await requestPrediction(requestInput())
    expect(result).toEqual({ ok: true, moves: ["MoveRight"] })
    expect(fetchMock).toHaveBeenCalledTimes(3)

    const thirdRequest = fetchMock.mock.calls[2][1] as RequestInit
    const thirdBody = JSON.parse(thirdRequest.body as string) as SerializedRequestBody

    // Only the genuinely new call gets a tool-result payload, immediately followed by the
    // reminder naming the duplicate that rode along with it.
    expect(thirdBody.messages.slice(-2)).toEqual([
      {
        role: "tool",
        tool_call_id: "call_3",
        tool_name: "get_maze_structure",
        content: mazeStructureContent(),
      },
      buildDuplicateToolCallMessage([
        { id: "call_2", function: { index: 0, name: "get_last_prediction_outcome", arguments: {} } },
      ]),
    ])

    // A mixed round makes real progress, so it must not consume the two-strike allowance —
    // round 3 is a clean predict attempt rather than a "warned" round.
    const agentModes = loadTapooLog<{ payload: string; details?: { agentMode: string } }>(
      CONFIG.runtime.controlModes.agentApi,
    )
      .filter((entry) => entry.payload === "Agent request.")
      .map((entry) => entry.details?.agentMode)
    expect(agentModes.at(-1)).not.toBe("warned")
  })

  it("gives one reminder before failing on a second all-duplicate round", async () => {
    // Round 1 (agentMode: tools): model calls every tool — natural exhaustion, predict mode next.
    // Round 2 (agentMode: predict): model re-requests an already-called tool — first violation:
    // no payload is re-served, just a reminder naming that specific call.
    // Round 3 (agentMode: warned): model re-requests it again despite the reminder — second
    // violation: the turn fails as malformed-response instead of reminding indefinitely.
    tapooResetLogs(CONFIG.runtime.controlModes.agentApi)

    const allToolCalls = agentContextTools.map(({ function: { name } }, i) => ({
      id: `call_${i}`,
      function: { index: i, name, arguments: {} },
    }))
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(toolCallResponse(allToolCalls))
      .mockResolvedValueOnce(
        toolCallResponse([
          { id: "call_extra_1", function: { index: 0, name: "get_last_prediction_outcome", arguments: {} } },
        ]),
      )
      .mockResolvedValueOnce(
        toolCallResponse([
          { id: "call_extra_2", function: { index: 0, name: "get_last_prediction_outcome", arguments: {} } },
        ]),
      )
    vi.stubGlobal("fetch", fetchMock)

    await expect(requestPrediction(requestInput())).resolves.toEqual({
      ok: false,
      reason: "malformed-response",
      diagnostic: {
        message: "Agent kept re-requesting already-called tools after being told so.",
        details: { endpoint, requestCount: 3 },
      },
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)

    // Round 2's violation must have gotten a reminder naming that specific call — no re-served
    // payload — shown as the final message of round 3's own request body.
    const thirdRequest = fetchMock.mock.calls[2][1] as RequestInit
    const thirdBody = JSON.parse(thirdRequest.body as string) as SerializedRequestBody
    expect(thirdBody.messages.at(-1)).toEqual(
      buildDuplicateToolCallMessage([
        { id: "call_extra_1", function: { index: 0, name: "get_last_prediction_outcome", arguments: {} } },
      ]),
    )

    // The three rounds are logged with distinct modes: gathering, clean predict attempt, then
    // the post-reminder "warned" round that ultimately fails.
    const agentModes = loadTapooLog<{ payload: string; details?: { agentMode: string } }>(
      CONFIG.runtime.controlModes.agentApi,
    )
      .filter((entry) => entry.payload === "Agent request.")
      .map((entry) => entry.details?.agentMode)
    expect(agentModes).toEqual(["tools", "predict", "warned"])
  })

  it("never logs a configured agent's credential or extraHeaders", async () => {
    // Logs land in sessionStorage and are user-downloadable, so a credential reaching one of them
    // would be a real leak, not an ephemeral one. Both sentinels are deliberately distinctive
    // strings unlikely to appear anywhere else in a request/response payload.
    tapooResetLogs(CONFIG.runtime.controlModes.agentApi)

    const credentialSentinel = "sk-redaction-sentinel-credential-000111"
    const extraHeadersSentinel = "redaction-sentinel-extra-header-222333"
    const anthropicAgent: AgentApiConfig = {
      ...agent,
      api: "anthropic",
      credential: credentialSentinel,
      extraHeaders: `anthropic-version: ${extraHeadersSentinel}`,
    }

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          role: "assistant",
          content: [{ type: "text", text: "{\"moves\":[\"MoveRight\"]}" }],
        }),
      }),
    )

    await requestPrediction({ ...requestInput(), agent: anthropicAgent })

    const loggedEntries = loadTapooLog<unknown>(CONFIG.runtime.controlModes.agentApi)
    const serializedLog = JSON.stringify(loggedEntries)

    expect(serializedLog).not.toContain(credentialSentinel)
    expect(serializedLog).not.toContain(extraHeadersSentinel)
  })

  it("echoes an assistant's reasoning back on the next round when echoBackReasoning is on, for reasoning models that require it preserved (e.g. Kimi K3)", async () => {
    const openaiAgent: AgentApiConfig = { ...agent, api: "openai", echoBackReasoning: true }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                role: "assistant",
                content: "",
                reasoning_content: "Let me check the maze structure first.",
                tool_calls: [
                  { id: "call_structure", function: { index: 0, name: "get_maze_structure", arguments: "{}" } },
                ],
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [
            { message: { role: "assistant", content: JSON.stringify({ moves: ["MoveRight"] }) } },
          ],
        }),
      })
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      requestPrediction({ ...requestInput(), agent: openaiAgent }),
    ).resolves.toEqual({ ok: true, moves: ["MoveRight"] })

    const secondRequest = fetchMock.mock.calls[1][1] as RequestInit
    const secondBody = JSON.parse(secondRequest.body as string) as { messages: { role: string; reasoning_content?: string }[] }
    const assistantMessage = secondBody.messages.find((msg) => msg.role === "assistant")
    expect(assistantMessage?.reasoning_content).toBe("Let me check the maze structure first.")
  })

  it("withholds reasoning_content by default, for models that require it not be sent back (e.g. Gemma)", async () => {
    const openaiAgent: AgentApiConfig = { ...agent, api: "openai" }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                role: "assistant",
                content: "",
                reasoning_content: "Let me check the maze structure first.",
                tool_calls: [
                  { id: "call_structure", function: { index: 0, name: "get_maze_structure", arguments: "{}" } },
                ],
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [
            { message: { role: "assistant", content: JSON.stringify({ moves: ["MoveRight"] }) } },
          ],
        }),
      })
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      requestPrediction({ ...requestInput(), agent: openaiAgent }),
    ).resolves.toEqual({ ok: true, moves: ["MoveRight"] })

    const secondRequest = fetchMock.mock.calls[1][1] as RequestInit
    const secondBody = JSON.parse(secondRequest.body as string) as { messages: { role: string; reasoning_content?: string }[] }
    const assistantMessage = secondBody.messages.find((msg) => msg.role === "assistant")
    expect(assistantMessage?.reasoning_content).toBeUndefined()
    expect(assistantMessage && "reasoning_content" in assistantMessage).toBe(false)
  })

  it("fails a turn cleanly for an agent whose api has no matching adapter, instead of throwing", async () => {
    // agent.api is typed as AgentApiProvider, but that only binds at compile time — this exercises
    // the runtime guard for a provider that reached this far without a PROVIDER_ADAPTERS entry
    // (e.g. added to the type but not yet wired in, or a corrupted persisted record).
    const unsupportedAgent = { ...agent, api: "unsupported-provider" as never }
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      requestPrediction({ ...requestInput(), agent: unsupportedAgent }),
    ).resolves.toEqual({
      ok: false,
      reason: "network-error",
      diagnostic: {
        message: "Unsupported agent API provider.",
        details: { endpoint, api: "unsupported-provider" },
      },
    })
    // No request should have gone out — there is no wire format to build a body or headers with.
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
