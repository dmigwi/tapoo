import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { EXPECTED_RESPONSE_SCHEMA, PREDICTION_FORMAT, buildDuplicateToolCallMessage } from "./context"
import { requestPredictionWithAbort } from "./request"
import { CONFIG } from "../config"
import { tapooResetLogs } from "../logs"
import { getNavigationProfile } from "../maze"
import { loadTapooLog } from "../storage"
import type {
  AgentApiConfig,
  MazeActionResult,
  State,
} from "../types"

const endpoint = "https://agents.example/chat"
const model = "qwen3.6:27b"
const prompt =
  `You are Blue and currently hold the most coveted rank of trailblazer. Work smarter to maintain it. playerName Self always appears first in traversalHistory and marks the start cell. currentCell is your current position; destinationCell is the target. The maze is randomly generated at each level with exactly one path to the destination. traversalHistory entries matching your playerName record your past moves in chronological order. Each entry's openMoves maps every open exit from that cell directly to the neighboring cell it leads to and whether that neighbor is already visited — exits from a cell are fixed since creation, so this helps you reconstruct the maze's path flow without computing adjacency yourself; entries recorded by other players are just as trustworthy as your own. openMoves key count reveals the physical maze structure at that cell: one open exit is a dead end (unless that is your start or destination cell); two is a corridor; three or more is a junction. traversalHistory only records the first visit to each cell; cells revisited during backtracking are not duplicated, so apparent gaps are expected. Revisiting a cell already in traversalHistory is not a mistake — once the current path is confirmed as leading to a dead end, backtracking through those cells is usually the only way to reach unexplored territory or the destination. By design, the maze never guarantees a direct route from start to destination; the only valid path may require moving away from the target before turning towards it. Tool results reflect the maze state at the time of each call — a repeat call may return updated or identical data depending on what has changed. get_last_replay_result reflects the most recent replay across all agents; lastPlayerName identifies whose outcome it is. lastMoveStatus being null means no moves have been made yet; invalid-move means the last prediction hit a wall; malformed-response means the previous response was not valid JSON, requested a tool that does not exist, or ignored a duplicate tool call warning — in all cases a penalty of 2 decay units was charged; applied means it succeeded. A turn with any valid moves costs a constant 1 decay units regardless of how many moves it applied; invalid moves (any moves after the last valid applied move) add a further penalty of 2 decay units on top — the maximum possible in a turn is 3 decay units. get_prediction_rules provides the required response format and move count guidance. Moves replay in submitted order until the destination is reached or the first invalid move (a wall collision or out-of-bounds step) is hit. Longer, well-reasoned predictions are strictly cheaper per move than single-stepping — a trailblazer can set a new scores retention record, a navigator's odds of finishing drop sharply, and a backtracker is almost certain to fail unless it corrects course. lastMoveStatus reached-target or status won means the game is complete — stop predicting.`
const developerMessage = prompt
const userMessage = `It is Blue's turn to predict next moves. Use the available tools to see the maze state.`
const agentContextTools = [
  {
    type: "function" as const,
    function: {
      name: "get_prediction_rules",
      description:
        "Get move response rules. suggestedMovesPerTurn is the suggested moves count to include in your predictions response per turn. All correct predictions per turn cost a constant number of decay units regardless of how many moves you included, and all wrong predictions per turn cost a further penalty in decay units on top — so predicting many moves at once costs nothing extra if you are wrong but advances further, more cheaply, if you are right. Each turn's decay units are subtracted immediately; the resulting score retention is visible via get_game_status. uniqueCellsVisited and requestsMade are the raw metrics behind batchEfficiencyRank, which shows your likelihood of finishing the game — obtained by dividing uniqueCellsVisited by requestsMade. It is set to backtracker rank when that rate is below 1.0 (requests being wasted on invalid moves or oscillation between cells), navigator rank at 1.0 (matching one move per turn), or trailblazer rank above 1.0 (multi-move guesses are paying off). Before making any requests on this level, batchEfficiencyRank defaults to trailblazer regardless of these counts, so you start already primed to predict multi-move sequences. Returns JSON: {\"suggestedMovesPerTurn\":number, \"uniqueCellsVisited\":number, \"requestsMade\":number, \"batchEfficiencyRank\":string, \"expectedResponseSchema\":object}.",
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
      name: "get_game_status",
      description:
        "Get current Tapoo level, status, score, and maze dimensions. status is one of: running (prediction active), won (destination reached, stop predicting), lost, await-agent, or paused. Returns JSON: {\"level\":number, \"status\":string, \"score\":number, \"mazeDimensions\":{\"numCols\":number, \"numRows\":number, \"area\":number}}. numCols is the number of columns, numRows is the number of rows, area is the total cell count.",
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
      name: "get_maze_positions",
      description:
        "Get current cell and destination cell. Row increases going down, col increases going right; MoveUp decreases row by 1 and MoveDown increases it by 1; MoveLeft decreases col by 1 and MoveRight increases it by 1. Use get_traversal_history to find which moves are open from the current cell. Returns JSON: {\"currentCell\":{\"row\":number, \"col\":number}|null, \"destinationCell\":{\"row\":number, \"col\":number}|null}.",
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
      name: "get_traversal_history",
      description:
        "Get all players' visit records in chronological order, structured as an adjacency list. cell is that entry's position. openMoves maps each open exit directly to the neighboring cell it leads to and whether that neighbor has already been visited — the exits from a cell are fixed since creation, so this lets you reconstruct the physical maze structure you have already explored without computing adjacency from row/col yourself. Use the full, unfiltered list for maze-structure reconstruction — every player's openMoves data is equally trustworthy; filter by playerName only when you specifically want one player's own chronological move sequence. Returns JSON: {\"traversalHistory\":[{\"playerName\":string, \"cell\":{\"row\":number, \"col\":number}, \"openMoves\":{\"MoveLeft\":{\"row\":number, \"col\":number, \"visited\":boolean}, ...}}]}.",
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
      name: "get_last_replay_result",
      description:
        "Get the previous turn replay result. lastMoveStatus values: null=first turn, no history yet; applied=move executed and added to traversal history; reached-target=destination reached, stop predicting; invalid-move=move hit a wall or boundary, replay stopped; malformed-response=previous response was not valid JSON, requested a tool that does not exist, or ignored a duplicate tool call warning — in all cases no moves were replayed and a fixed score penalty was charged; network-error=HTTP failure, no score charged. lastSubmittedMoves lists the moves from that turn as zero-based <index>:<move> entries; lastReplayStartIndex is their zero-based offset in the overall submitted move sequence. lastAppliedMoveIndex is the index within lastSubmittedMoves of the last successfully applied move — moves after it were not executed. visitedBefore indicates whether the cell entered by the last valid move was already in traversal history. chargedMovesCount is the total decay units charged toward score that turn. Returns JSON: {\"lastPlayerName\":string|null, \"lastMoveStatus\":string|null, \"lastReplayStartIndex\":number|null, \"lastSubmittedMoves\":string[], \"lastAppliedMoveIndex\":number|null, \"visitedBefore\":boolean|null, \"chargedMovesCount\":number}.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
]
// compactedTools builds the mixed follow-up payload: called tools are name-only; uncalled keep full definitions.
function compactedTools(calledNames: string[]) {
  const called = new Set(calledNames)
  return agentContextTools.map(({ type, function: fn }) =>
    called.has(fn.name) ? { type, function: { name: fn.name } } : { type, function: fn }
  )
}

// expectedLoggedTools mirrors previewLoggedTool: same name, description full or truncated
// depending on keepFull, and absent altogether for already-compacted (called) tools.
function expectedLoggedTools(
  wireTools: ReturnType<typeof compactedTools>,
  keepFull: boolean,
): { name: string; description?: string }[] {
  return wireTools.map(({ function: fn }) => ({
    name: fn.name,
    description:
      "description" in fn
        ? keepFull
          ? fn.description
          : `${fn.description.slice(0, 25)}...`
        : undefined,
  }))
}

const agent: AgentApiConfig = {
  id: 1,
  playerName: "Blue",
  model,
  endpoint: new URL(endpoint),
  enabled: true,
}

const state: State = {
  agentRequestCount: 0,
    cumulativeRoundCount: 0,
  bestWinRequestCount: null,
  bestWinRetentionUnits: null,
  canResume: false,
  clock: null,
  controlMode: "agent-api",
  finalPosition: { x: 15, y: 17 },
  lastAttemptRetentionUnits: null,
  lastRoundScore: 0,
  lastWinRequestCount: null,
  level: 1,
  maze: null,
  mazeDimensions: { numCols: 10, numRows: 10, area: 100 },
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
  think: false
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

// positionsContent mirrors the exact JSON string sent by the positions tool.
function positionsContent(overrides: Partial<State> = {}): string {
  const nextState = { ...state, ...overrides }
  return JSON.stringify({
    currentCell: nextState.playerPosition
      ? {
          row: Math.floor((nextState.playerPosition.y - 1) / 2),
          col: Math.floor((nextState.playerPosition.x - 1) / 2),
        }
      : null,
    destinationCell: nextState.finalPosition
      ? {
          row: Math.floor((nextState.finalPosition.y - 1) / 2),
          col: Math.floor((nextState.finalPosition.x - 1) / 2),
        }
      : null,
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
              id: "call_positions",
              function: {
                index: 0,
                name: "get_maze_positions",
                arguments: {},
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_positions",
          tool_name: "get_maze_positions",
          content:
            "{\"currentCell\":{\"row\":0,\"col\":0},\"destinationCell\":{\"row\":8,\"col\":7}}",
        },
      ],
      tools: compactedTools(["get_maze_positions"]),
      options: { num_ctx: CONFIG.runtime.modelConfig.contextWindowFloor, temperature: CONFIG.runtime.modelConfig.temperature, num_predict: CONFIG.runtime.modelConfig.numPredict },
      think: false,
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
              id: "call_positions",
              function: {
                index: 0,
                name: "get_maze_positions",
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
            id: "call_positions",
            function: { index: 0, name: "get_maze_positions", arguments: {} },
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
        requestTurn: number
        mode: "predict" | "tools"
        tools: { name: string; description?: string }[]
        newMessages: unknown[]
      }
    }>(CONFIG.runtime.controlModes.agentApi).filter(
      (entry) => entry.payload === "Agent request.",
    )

    expect(requestEntries).toHaveLength(2)

    // agentRequestCount defaults to 0, so this is the level's first request: everything logs
    // in full, including the system/user prompt and tool descriptions.
    expect(requestEntries[0].details).toEqual({
      endpoint,
      requestTurn: 1,
      mode: "tools",
      tools: expectedLoggedTools(compactedTools([]), true),
      newMessages: [
        { role: "system", content: developerMessage },
        { role: "user", content: userMessage },
      ],
    })

    // Round 2 logs the full accumulated history (system+user+assistant+tool), not just the new
    // assistant/tool-result messages — no delta tracking, every entry stands on its own. Not
    // every tool has been called yet, so compactToolsPayload keeps all 5 names (one now
    // name-only). keepFull only covers round 1 (isFirstRequestOfLevel && reqTurn <= 1), so by
    // round 2 the system/user prompt and tool descriptions are previewed even within the
    // level's first turn — further limiting duplication across a single turn's tool-call rounds.
    expect(requestEntries[1].details).toEqual({
      endpoint,
      requestTurn: 2,
      mode: "tools",
      tools: expectedLoggedTools(compactedTools(["get_maze_positions"]), false),
      newMessages: [
        { role: "system", content: `${developerMessage.slice(0, 25)}...` },
        { role: "user", content: `${userMessage.slice(0, 25)}...` },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call_positions",
              function: { index: 0, name: "get_maze_positions", arguments: {} },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_positions",
          tool_name: "get_maze_positions",
          content:
            "{\"currentCell\":{\"row\":0,\"col\":0},\"destinationCell\":{\"row\":8,\"col\":7}}",
        },
      ],
    })
  })

  it("previews the repeated system/user prompt and tool descriptions in a later turn, every round", async () => {
    tapooResetLogs(CONFIG.runtime.controlModes.agentApi)

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        toolCallResponse([
          {
            id: "call_positions",
            function: { index: 0, name: "get_maze_positions", arguments: {} },
          },
        ]),
      )
      .mockResolvedValueOnce(
        successfulResponse(JSON.stringify({ moves: ["MoveRight", "MoveDown"] })),
      )
    vi.stubGlobal("fetch", fetchMock)

    // agentRequestCount > 0 means this is not the level's first agent-api request.
    await requestPrediction(requestInput({ agentRequestCount: 1 }))

    const requestEntries = loadTapooLog<{
      payload: string
      details?: {
        requestTurn: number
        mode: "predict" | "tools"
        tools: { name: string; description?: string }[]
        newMessages: unknown[]
      }
    }>(CONFIG.runtime.controlModes.agentApi).filter(
      (entry) => entry.payload === "Agent request.",
    )

    expect(requestEntries).toHaveLength(2)

    // Round 1: the static system/user prompt is previewed (role intact, content shortened),
    // and tool descriptions are previewed too, since both repeat verbatim every turn.
    expect(requestEntries[0].details).toEqual({
      endpoint,
      requestTurn: 1,
      mode: "tools",
      tools: expectedLoggedTools(compactedTools([]), false),
      newMessages: [
        { role: "system", content: `${developerMessage.slice(0, 25)}...` },
        { role: "user", content: `${userMessage.slice(0, 25)}...` },
      ],
    })

    // Round 2 logs the full accumulated history too — the previewed system/user messages stay
    // previewed (gated by role, not round, so this stays consistent with round 1), while the
    // assistant/tool-call messages are turn-unique and always log in full.
    expect(requestEntries[1].details).toEqual({
      endpoint,
      requestTurn: 2,
      mode: "tools",
      tools: expectedLoggedTools(compactedTools(["get_maze_positions"]), false),
      newMessages: [
        { role: "system", content: `${developerMessage.slice(0, 25)}...` },
        { role: "user", content: `${userMessage.slice(0, 25)}...` },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call_positions",
              function: { index: 0, name: "get_maze_positions", arguments: {} },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_positions",
          tool_name: "get_maze_positions",
          content:
            "{\"currentCell\":{\"row\":0,\"col\":0},\"destinationCell\":{\"row\":8,\"col\":7}}",
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
      think: false,
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
            function: { index: 0, name: "get_maze_positions", arguments: {} },
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
              name: "get_maze_positions",
              arguments: {},
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_1",
        tool_name: "get_maze_positions",
        content: positionsContent({
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
          { function: { name: "get_maze_positions", arguments: {} } },
          { function: { name: "get_traversal_history", arguments: "{}" } },
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
        tool_name: "get_maze_positions",
        content: positionsContent(),
      },
      {
        role: "tool",
        tool_name: "get_traversal_history",
        content: JSON.stringify({
          traversalHistory: state.traversalHistory.map(({ playerName, row, col }) => ({
            playerName,
            cell: { row, col },
            openMoves: {},
          })),
        }),
      },
    ])
  })

  it("detects Ollama thinking responses that include native tool calls", async () => {
    const firstResponse = thinkingToolCallResponse([
      {
        id: "call_status",
        function: { index: 0, name: "get_game_status", arguments: {} },
      },
      {
        id: "call_positions",
        function: { index: 1, name: "get_maze_positions", arguments: {} },
      },
      {
        id: "call_history",
        function: { index: 2, name: "get_traversal_history", arguments: {} },
      },
      {
        id: "call_replay",
        function: { index: 3, name: "get_last_replay_result", arguments: {} },
      },
      {
        id: "call_rules",
        function: { index: 4, name: "get_prediction_rules", arguments: {} },
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
    const toolMessages = secondRequestBody.messages.slice(-5) as Array<{
      role: string
      tool_call_id: string
      tool_name: string
      content: string
    }>
    expect(toolMessages.map(({ role, tool_call_id, tool_name }) => ({ role, tool_call_id, tool_name }))).toEqual([
      { role: "tool", tool_call_id: "call_status",    tool_name: "get_game_status" },
      { role: "tool", tool_call_id: "call_positions", tool_name: "get_maze_positions" },
      { role: "tool", tool_call_id: "call_history",   tool_name: "get_traversal_history" },
      { role: "tool", tool_call_id: "call_replay",    tool_name: "get_last_replay_result" },
      { role: "tool", tool_call_id: "call_rules",     tool_name: "get_prediction_rules" },
    ])
    expect(toolMessages.map(({ content }) => JSON.parse(content) as unknown)).toEqual([
      {
        level: state.level,
        status: state.status,
        score: state.score,
        mazeDimensions: state.mazeDimensions,
      },
      JSON.parse(positionsContent()) as unknown,
      {
        traversalHistory: state.traversalHistory.map(({ playerName, row, col }) => ({
          playerName,
          cell: { row, col },
          openMoves: {},
        })),
      },
      {
        lastPlayerName: null,
        lastMoveStatus: null,
        lastReplayStartIndex: null,
        lastSubmittedMoves: [],
        lastAppliedMoveIndex: null,
        visitedBefore: null,
        chargedMovesCount: 0,
      },
      {
        suggestedMovesPerTurn: Math.min(getNavigationProfile(state.mazeDimensions).__maxCorridorLength, 4),
        uniqueCellsVisited: 0,
        requestsMade: 0,
        batchEfficiencyRank: "trailblazer",
        expectedResponseSchema: EXPECTED_RESPONSE_SCHEMA,
      },
    ])
  })

  it.each([
    ["bare json", "{\"moves\":[\"MoveRight\"]}", ["MoveRight"]],
    ["json fence", "```json\n{\"moves\":[\"MoveDown\"]}\n```", ["MoveDown"]],
    ["plain fence", "```\n{\"moves\":[\"MoveLeft\",\"MoveUp\"]}\n```", ["MoveLeft", "MoveUp"]],
    [
      "prose prefix with embedded json fence",
      [
        "Based on the current state:",
        "- **Current Cell**: `(row: 0, col: 8)`",
        "- **Destination Cell**: `(row: 2, col: 2)`",
        "",
        "The destination is 2 rows down and 6 columns to the left.",
        "I will predict the following moves:",
        "1. Move Left 6 times to reach column 2.",
        "2. Move Down 2 times to reach row 2.",
        "",
        "```json",
        "{\"moves\":[\"MoveLeft\",\"MoveLeft\",\"MoveLeft\",\"MoveLeft\",\"MoveLeft\",\"MoveLeft\",\"MoveDown\",\"MoveDown\"]}",
        "```",
      ].join("\n"),
      ["MoveLeft", "MoveLeft", "MoveLeft", "MoveLeft", "MoveLeft", "MoveLeft", "MoveDown", "MoveDown"],
    ],
    [
      "prose prefix with reasoning",
      [
        "I am currently at (0,8). The destination is at (2,2).",
        "The maze is 10x7.",
        "Since this is Level 1 and my history only shows the start cell (0,8), I need to explore.",
        "The target is down and to the left. I should generally move in that direction.",
        'Let\'s try moving Left first along the top row. Given "suggestedMovesPerTurn" is 10, but I should start conservative.',
        "",
        "Proposed moves:",
        "1. MoveLeft (to 0,7)",
        "2. MoveLeft (to 0,6)",
        "3. MoveLeft (to 0,5)",
        "4. MoveDown (to 1,5)",
        "5. MoveDown (to 2,5)",
        "6. MoveLeft (to 2,4)",
        "7. MoveLeft (to 2,3)",
        "8. MoveLeft (to 2,2 - Target!)",
        "",
        "Let's refine: Start by moving **Left** until col 2, then Down.",
        "",
        "{\"moves\":[\"MoveLeft\",\"MoveLeft\",\"MoveLeft\",\"MoveLeft\",\"MoveLeft\",\"MoveLeft\",\"MoveDown\",\"MoveDown\"]}",
      ].join("\n"),
      ["MoveLeft", "MoveLeft", "MoveLeft", "MoveLeft", "MoveLeft", "MoveLeft", "MoveDown", "MoveDown"],
    ],
  ])("parses valid predictions wrapped as %s", async (_caseName, content, moves) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(successfulResponse(content)))
    await expect(requestPrediction(requestInput())).resolves.toEqual({ ok: true, moves })
  })

  it.each([
    ["invalid json", "not-json"],
    ["missing moves", "{}"],
    ["empty moves", "{\"moves\":[]}"],
    ["unsupported move", "{\"moves\":[\"MoveSideways\"]}"],
  ])("returns malformed-response for %s", async (_caseName, content) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(successfulResponse(content)))

    await expect(requestPrediction(requestInput())).resolves.toMatchObject({
      ok: false,
      reason: "malformed-response",
      diagnostic: {
        message: "Malformed agent prediction response.",
        details: { endpoint, requestTurn: 1 },
      },
    })
  })

  it.each([
    [
      "non-ok response",
      vi.fn().mockResolvedValue({ ok: false, status: 503, statusText: "Unavailable" }),
      "Provider HTTP response failed.",
      { endpoint, status: 503, statusText: "Unavailable" },
    ],
    [
      "fetch failure",
      vi.fn().mockRejectedValue(new TypeError("failed")),
      "Request failed before a valid response.",
      { endpoint },
    ],
  ])("returns network-error for %s", async (_caseName, fetchMock, expectedMessage, expectedDetails) => {
    vi.stubGlobal("fetch", fetchMock)

    await expect(requestPrediction(requestInput())).resolves.toMatchObject({
      ok: false,
      reason: "network-error",
      diagnostic: {
        message: expectedMessage,
        details: expectedDetails,
      },
    })
  })

  it("returns provider request failures with actionable diagnostic context", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("failed")))

    await expect(requestPrediction(requestInput())).resolves.toMatchObject({
      ok: false,
      reason: "network-error",
      diagnostic: {
        message: "Request failed before a valid response.",
        details: { endpoint },
      },
    })
  })

  it("returns network-error when the request times out", async () => {
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
      reason: "network-error",
      diagnostic: {
        message: "Request failed before a valid response.",
        details: { endpoint },
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
          { function: { name: "get_maze_positions", arguments: {} } },
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
          requestTurn: 1,
          toolNames: name === undefined ? [] : [name],
        },
      },
    })
  })

  it("proactively removes tools when all available tools were called in the previous round", async () => {
    // When r0 calls all 5 tools, calledToolNames covers every available tool before r1 is sent.
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
    expect(secondBody.format).toEqual(PREDICTION_FORMAT)
    expect(secondBody.options).toEqual({ num_ctx: CONFIG.runtime.modelConfig.contextWindowFloor, temperature: CONFIG.runtime.modelConfig.temperature, num_predict: CONFIG.runtime.modelConfig.numPredict })
  })

  it("reminds about a duplicate call while still offering the tools genuinely left uncalled", async () => {
    // Round 1: model calls get_game_status (new tool, processed normally).
    // Round 2: model calls get_game_status again (all-duplicate round → reminder naming that
    // specific call is appended; the other 4 tools remain genuinely uncalled, so round 3 still
    // offers them rather than being forced into prediction mode).
    // Round 3: model answers directly anyway.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        toolCallResponse([
          { id: "call_1", function: { index: 0, name: "get_game_status", arguments: {} } },
        ]),
      )
      .mockResolvedValueOnce(
        toolCallResponse([
          { id: "call_2", function: { index: 0, name: "get_game_status", arguments: {} } },
        ]),
      )
      .mockResolvedValueOnce(successfulResponse("{\"moves\":[\"MoveRight\"]}"))
    vi.stubGlobal("fetch", fetchMock)

    const result = await requestPrediction(requestInput())
    expect(result).toEqual({ ok: true, moves: ["MoveRight"] })
    expect(fetchMock).toHaveBeenCalledTimes(3)

    const thirdRequest = fetchMock.mock.calls[2][1] as RequestInit
    const thirdBody = JSON.parse(thirdRequest.body as string) as SerializedRequestBody

    // Round 3 still offers the 4 tools genuinely never called (get_game_status compacted to
    // name-only) — no early forcing into prediction mode.
    expect(thirdBody.tools).toEqual(compactedTools(["get_game_status"]))
    expect(thirdBody.format).toBeUndefined()

    // The duplicate reminder names the specific repeated call, not a blanket "no tools left" claim.
    // Exact wording is covered by context.test.ts's buildDuplicateToolCallMessage suite.
    expect(thirdBody.messages.at(-1)).toEqual(
      buildDuplicateToolCallMessage([
        { id: "call_2", function: { index: 0, name: "get_game_status", arguments: {} } },
      ]),
    )
  })

  it("services the new call in a mixed round and only reminds about the duplicate", async () => {
    // Round 1: model calls get_game_status (new).
    // Round 2: model calls get_game_status again (duplicate) AND get_maze_positions (new) in the
    // same response — only get_maze_positions should be serviced; get_game_status should get a
    // reminder instead of a re-served payload.
    // Round 3: model predicts.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        toolCallResponse([
          { id: "call_1", function: { index: 0, name: "get_game_status", arguments: {} } },
        ]),
      )
      .mockResolvedValueOnce(
        toolCallResponse([
          { id: "call_2", function: { index: 0, name: "get_game_status", arguments: {} } },
          { id: "call_3", function: { index: 1, name: "get_maze_positions", arguments: {} } },
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
        tool_name: "get_maze_positions",
        content: positionsContent(),
      },
      buildDuplicateToolCallMessage([
        { id: "call_2", function: { index: 0, name: "get_game_status", arguments: {} } },
      ]),
    ])

    // A mixed round makes real progress, so it must not consume the two-strike allowance —
    // round 3 is a clean predict attempt rather than a "warned" round.
    const modes = loadTapooLog<{ payload: string; details?: { mode: string } }>(
      CONFIG.runtime.controlModes.agentApi,
    )
      .filter((entry) => entry.payload === "Agent request.")
      .map((entry) => entry.details?.mode)
    expect(modes.at(-1)).not.toBe("warned")
  })

  it("gives one reminder before failing on a second all-duplicate round", async () => {
    // Round 1 (mode: tools): model calls all 5 tools — natural exhaustion, predict mode next.
    // Round 2 (mode: predict): model re-requests an already-called tool — first violation:
    // no payload is re-served, just a reminder naming that specific call.
    // Round 3 (mode: warned): model re-requests it again despite the reminder — second
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
          { id: "call_extra_1", function: { index: 0, name: "get_game_status", arguments: {} } },
        ]),
      )
      .mockResolvedValueOnce(
        toolCallResponse([
          { id: "call_extra_2", function: { index: 0, name: "get_game_status", arguments: {} } },
        ]),
      )
    vi.stubGlobal("fetch", fetchMock)

    await expect(requestPrediction(requestInput())).resolves.toEqual({
      ok: false,
      reason: "malformed-response",
      diagnostic: {
        message: "Agent kept re-requesting already-called tools after being told so.",
        details: { endpoint, requestTurn: 3 },
      },
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)

    // Round 2's violation must have gotten a reminder naming that specific call — no re-served
    // payload — shown as the final message of round 3's own request body.
    const thirdRequest = fetchMock.mock.calls[2][1] as RequestInit
    const thirdBody = JSON.parse(thirdRequest.body as string) as SerializedRequestBody
    expect(thirdBody.messages.at(-1)).toEqual(
      buildDuplicateToolCallMessage([
        { id: "call_extra_1", function: { index: 0, name: "get_game_status", arguments: {} } },
      ]),
    )

    // The three rounds are logged with distinct modes: gathering, clean predict attempt, then
    // the post-reminder "warned" round that ultimately fails.
    const modes = loadTapooLog<{ payload: string; details?: { mode: string } }>(
      CONFIG.runtime.controlModes.agentApi,
    )
      .filter((entry) => entry.payload === "Agent request.")
      .map((entry) => entry.details?.mode)
    expect(modes).toEqual(["tools", "predict", "warned"])
  })
})
