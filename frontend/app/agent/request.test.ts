import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  EXPECTED_RESPONSE_SCHEMA,
  buildDuplicateToolCallMessage,
  buildMazeActionPrompt,
  buildTokenLimitExhaustionPrompt,
} from "./context"
import { OLLAMA_PREDICTION_FORMAT } from "./providers"
import { requestPredictionWithAbort } from "./request"
import { snapshotAgentState } from "./state-snapshot"
import { CONFIG } from "../config"
import { checksumLoggedDescription, encodeMazeForLog, tapooResetLogs } from "../logs"
import { loadTapooLog } from "../storage"
import type {
  AgentApiSeatConfig,
  MazeActionResult,
  MazeCellType,
  MazeDimensions,
  State,
} from "../types"

// structureToolResult is the get_maze_structure payload these fixtures expect, kept in one place so
// the trimmed copy and its checksum cannot disagree about what was trimmed.
// compactedStructureToolResult is what the log keeps: the same result with every field a reader can
// recompute removed. Written out rather than derived so a change to the compaction has to be stated
// here too, instead of the fixture silently agreeing with whatever the code now produces.
function compactedStructureToolResult(): string {
  return "{\"currentCell\":[0,0],\"filteredTraversalHistory\":[{\"playerName\":\"Self\",\"cell\":[0,0],\"openMoves\":[]}]}"
}

function structureToolResult(): string {
  return "{\"level\":1,\"currentCell\":{\"row\":0,\"col\":0},\"destinationCell\":{\"row\":8,\"col\":7},\"historyWindowRadius\":4,\"filteredTraversalHistory\":[{\"playerName\":\"Self\",\"cell\":{\"row\":0,\"col\":0},\"cellType\":\"start-cell\",\"openMoves\":{}}]}"
}

const endpoint = "https://agents.example/chat"
const model = "qwen3.6:27b"
const prompt = buildMazeActionPrompt("Blue", "trailblazer", true)
const developerMessage = prompt
const userMessage = `It is Blue's turn to predict the next moves. Call every available tool once, then reply with only the moves JSON.`
const agentContextTools = [
  {
    type: "function" as const,
    function: {
      name: "get_maze_structure",
      description:
        "Get current/destination cells and the nearby explored maze structure in one call. Row increases going down, col increases going right; MoveUp decreases row by 1 and MoveDown increases it by 1; MoveLeft decreases col by 1 and MoveRight increases it by 1. currentCell is where the previous turn's valid moves ended, whoever played it, or is the start position in turn 0. filteredTraversalHistory holds one record per visited cell, created when that cell was first reached, for cells within historyWindowRadius of currentCell. It is ordered by first visit, oldest first - currentCell's own position depends on when it was first visited, not on it being current, so it will not always be the last. Order says nothing about recent activity: a cell listed early may have been re-entered moments ago, and its visitStatus, not its position, is what reports that. If currentCell is not last, every listed entry after it is a cell first reached after currentCell but before now, so the entry itself is charted ground. However, any move under that entry's openMoves that leads to a cell with visitStatus set to unvisited still points at unexplored ground and remains a valid branch target. currentCell is always included because its distance is 0. historyWindowRadius is a fixed configured radius - the maximum Manhattan distance a visited cell in filteredTraversalHistory can be from currentCell - unrelated to how far destinationCell is; compute that yourself from currentCell and destinationCell's row/col if you need it. Each included entry's openMoves maps every fixed open exit from that cell to the neighboring cell reached by that move. openMoves are generated once and never change with visits count. visitStatus gives direction guidance for each cell in filteredTraversalHistory by comparing that cell's visits count with its fixed open-exit count: unvisited=no recorded visit and new ground to explore; explored=visits count is below the open-exit count; backtracking=visits count equals the open-exit count, so this direction is exhausted; oscillating=visits count is greater than the open-exit count, proving this direction is wasting limited moves. A dead-end reads as backtracking from its first visit, because nothing lies beyond a single exit. cellType is precomputed so you never need to count exits yourself: start-cell (the traversal start), target-cell (the destination), dead-end (one exit), corridor (two exits), or junction (three or more). cellType and visitStatus answer different questions, and help in extracting high-confidence moves: cellType is the cell's fixed structure, visitStatus provides a sense of direction based on cell visits count. start-cell and target-cell are special cells, not ordinary dead ends. cellType is only set for a cell already in filteredTraversalHistory - an unvisited cell, including one that only appears as a neighbor inside another cell's openMoves, has no known cellType and must never be assumed to be of a specific cellType before visiting. The only way to learn an unvisited cell's own structure is to move there and read its own entry on a later turn. currentCell or destinationCell being null means the game state is invalid or incomplete for planning, not a normal maze situation. Returns JSON: {\"level\":number, \"currentCell\":{\"row\":number, \"col\":number}|null, \"destinationCell\":{\"row\":number, \"col\":number}|null, \"historyWindowRadius\":number, \"filteredTraversalHistory\":[{\"playerName\":string, \"cell\":{\"row\":number, \"col\":number}, \"cellType\":string, \"openMoves\":{\"MoveLeft\":{\"row\":number, \"col\":number, \"visitStatus\":string}, ...}}]}.",
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
        "Get move response rules. suggestedMovesPerTurn is a min/max range of how many moves a prediction per turn can include - absolute minimum required is 1. Use the local map to extract moves you are most confident about. Batching accuracy drops sharply the further out a prediction reaches, so lean toward min rather than max whenever you are unsure. When decayUnitsCharged is greater than 0, playerUniqueCellsVisited divided by decayUnitsCharged is your current traversal speed, the progress per decay unit spent, which batchEfficiencyClass groups into bands. When decayUnitsCharged is 0, batchEfficiencyClass defaults to trailblazer. Only a cell's first visit counts as progress. Higher traversal speed means more progress per decay unit, increasing the chance of reaching the target before score runs out. batchEfficiencyClass is set to backtracker when the speed is below 1.0000, navigator at 1.0000, or trailblazer above 1.0000. Backtracker is a live game metric rating prediction efficiency class, while get_maze_structure's backtracking visitStatus marks one cell as a spent direction. The two are independent: a player can classify as backtracker without ever entering a backtracking cell, and crossing such cells costs no decay beyond the turn's own charge. Retrace-only batching can save turns but cannot create new-cell progress, so trailblazer is evidence that forward prediction into unvisited cells succeeded. allUniqueCellsVisited is every cell any player has reached this level, not just your own - compare it against mazeDimensions.totalMazeCells to know how much of the maze the team has collectively explored so far; it does not affect your traversal speed, which is scored on playerUniqueCellsVisited against decayUnitsCharged. At the initial game levels the single solution path covers nearly all of totalMazeCells, so expect to explore most of the maze before reaching the destination. At higher levels, the destination can be reachable well before allUniqueCellsVisited approaches totalMazeCells. totalTurnCount is the total number of completed prediction turns in this game level. playerTurnsTaken is the number completed by the player and is reported for context; neither count affects your speed, classification, or scores. The resulting score is visible via get_last_prediction_outcome. mazeDimensions.totalMazeCells is the full level size. mazeDimensions being null means the game state is invalid or incomplete for planning. Returns JSON: {\"suggestedMovesPerTurn\":{\"min\":number,\"max\":number}, \"allUniqueCellsVisited\":number, \"playerUniqueCellsVisited\":number, \"decayUnitsCharged\":number, \"totalTurnCount\":number, \"playerTurnsTaken\":number, \"batchEfficiencyClass\":string, \"mazeDimensions\":{\"numCols\":number,\"numRows\":number,\"totalMazeCells\":number}|null, \"expectedResponseSchema\":object}.",
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
        "Get the outcome of the previous prediction attempt: whether its moves fully applied, partially failed, reached the target, or were rejected. status is the current game status, score is the current score after that outcome. decayUnitsRemaining is the current maximum number of decay units the player can spend, starting with this turn, to find the target. If the final unit is spent without reaching the target, the score becomes 0 and the level is lost; reaching the target with that unit wins with a score of 0. When moves were replayed, lastMoveStatus is the outcome of the last executed move in the previous prediction: null=first turn, no previous outcome yet; applied=the last executed move succeeded; invalid-move=the last executed move hit a wall or boundary and replay stopped there; reached-target=destination reached, stop predicting. When no moves were replayed, lastMoveStatus explains why: malformed-response=previous response was not valid JSON, requested a tool that does not exist, or ignored a warning, resulting in zero progress and a fixed score penalty. A warning is a user message beginning with \"Warning:\"; token-limit-exhaustion=the previous empty prediction reached the configured token threshold and its corrective warning opportunity also returned no prediction - no moves were replayed and the same fixed score penalty was charged; network-error=HTTP failure, no score charged. predictionStatus summarizes the outcome of the entire prediction submitted in the last turn as one story: all-applied=all submitted moves applied and at least one entered a previously unvisited cell, or the target was reached; partially-applied=one or more moves applied, at least one entered a previously unvisited cell, and replay then stopped at the first invalid move; repeat-cell-visits=one or more moves applied, but none entered a new cell - replay may have completed or stopped at an invalid move; invalid-prediction=a real prediction was replayed but the very first submitted move was already invalid, no progress made; empty-prediction=a malformed-response, token-limit-exhaustion, or network-error meant there was no usable prediction to replay at all. lastSubmittedMoves lists every submitted move from that turn, in order and exactly as sent, including moves after the first invalid move that were not executed. lastReplayStartIndex is 0 when moves were submitted and marks the first replayed submitted-move index. lastAppliedMoveIndex is the index within lastSubmittedMoves of the last successfully applied move - moves after it were not executed. lastReplayStartCell is the cell position replay began from: where the previous player stood before those moves were applied, not where it stands now. Walk lastSubmittedMoves forward from lastReplayStartCell up to and including lastAppliedMoveIndex to see exactly which move landed where, and the move at lastAppliedMoveIndex + 1 is the one that was rejected. Do not measure last turn's moves from currentCell: currentCell is where replay ended, so assuming it is where replay started makes an applied move look like it never happened. On an empty-prediction turn these fields are always reset to null/empty, matching that no moves were replayed - they never carry over stale data from an earlier turn. chargedMovesCount is the total decay units charged toward score that turn. Returns JSON: {\"status\":string, \"score\":number, \"decayUnitsRemaining\":number, \"lastMoveStatus\":string|null, \"predictionStatus\":string|null, \"lastReplayStartIndex\":number|null, \"lastReplayStartCell\":{\"row\":number, \"col\":number}|null, \"lastSubmittedMoves\":string[], \"lastAppliedMoveIndex\":number|null, \"chargedMovesCount\":number}.",
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
): { name: string; description_checksum: string | undefined; description: string }[] {
  return wireTools.map(({ function: fn }) => ({
    name: fn.name,
    description_checksum: checksumLoggedDescription(fn.description),
    description: keepFull ? fn.description : `${fn.description.slice(0, 25)}...`,
  }))
}

const agent: AgentApiSeatConfig = {
  seatId: 1,
  sessionId: 1_700_000_000_000,
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
  restartLevel: 1,
  maze: null,
  mazeDimensions,
  startPosition: { x: 1, y: 1 },
  playerPosition: { x: 1, y: 1 },
  score: 10000,
  scoreDecayUnits: 0,
  status: "running",
  traversalHistory: [{ playerName: "Self", row: 0, col: 0, openMoves: [], visitCount: 1 }],
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

function encodeMazeForLevelStart(state: State) {
  if (!state.maze || !state.mazeDimensions) {
    return null
  }

  return {
    ...encodeMazeForLog(state.maze),
    dimensions: state.mazeDimensions,
  }
}

function requestInput(
  stateOverrides: Partial<State> = {},
  resultOverrides: Partial<MazeActionResult> = {},
) {
  const lastActionResult =
    Object.keys(resultOverrides).length === 0 ? null : resultOverrides
  const mergedState = { ...state, ...stateOverrides }

  return {
    agent,
    lastActionResult,
    encodedMazeForLevelStart: encodeMazeForLevelStart(mergedState),
    stateSnapshot: snapshotAgentState(mergedState),
    timeoutMs: 180_000,
    requestIntervalMs: 0,
    // Running unless a test says otherwise, which is the state every turn starts from.
    isRoundRunning: () => true,
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

function toolCallResponse(
  toolCalls: unknown[],
  usage: { prompt_eval_count?: number; eval_count?: number } = {},
) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue({
      ...usage,
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
  // Mirrors resolvedOpenMoves/cellVisitStatus in agent/context.ts: keyed by cell so each neighbor's
  // own entry (visitCount and exit count) is available, since visitStatus is derived from both.
  const visitedCells = new Map(
    nextState.traversalHistory.map((entry) => [`${entry.row},${entry.col}`, entry]),
  )
  const filteredTraversalHistory = currentCell
    ? nextState.traversalHistory
        .filter(({ row, col }) => Math.abs(row - currentCell.row) + Math.abs(col - currentCell.col) <= historyWindowRadius)
        .map(({ playerName, row, col, openMoves }) => {
          const cellType: MazeCellType = (() => {
            if (nextState.startPosition) {
              const start = {
                row: Math.floor((nextState.startPosition.y - 1) / 2),
                col: Math.floor((nextState.startPosition.x - 1) / 2),
              }
              if (row === start.row && col === start.col) {
                return "start-cell"
              }
            }
            if (destinationCell && row === destinationCell.row && col === destinationCell.col) {
              return "target-cell"
            }
            return openMoves.length <= 1 ? "dead-end" : openMoves.length === 2 ? "corridor" : "junction"
          })()

          return {
            playerName,
            cell: { row, col },
            cellType,
            openMoves: Object.fromEntries(
              openMoves.map((move) => {
                const [rowDelta, colDelta] = {
                  MoveLeft: [0, -1],
                  MoveRight: [0, 1],
                  MoveUp: [-1, 0],
                  MoveDown: [1, 0],
                }[move]
                const neighbor = { row: row + rowDelta, col: col + colDelta }
                const neighborEntry = visitedCells.get(`${neighbor.row},${neighbor.col}`)
                const visitStatus = !neighborEntry
                  ? "unvisited"
                  : neighborEntry.visitCount < neighborEntry.openMoves.length
                    ? "explored"
                    : neighborEntry.visitCount === neighborEntry.openMoves.length
                      ? "backtracking"
                      : "oscillating"
                return [move, { ...neighbor, visitStatus }]
              }),
            ),
          }
        })
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
    vi.stubGlobal("indexedDB", undefined)
  })

  afterEach(async () => {
    await tapooResetLogs(CONFIG.runtime.controlModes.agentApi)
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
          // The wire payload, not the log: the model still receives the tool result in full.
          content: structureToolResult(),
        },
      ],
      tools: uncalledTools(["get_maze_structure"]),
      options: {
        num_ctx: CONFIG.runtime.modelConfig.contextWindowFloor,
        num_predict: CONFIG.runtime.modelConfig.maxTokens,
      },
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
        ], { prompt_eval_count: 21, eval_count: 13 }),
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
    await tapooResetLogs(CONFIG.runtime.controlModes.agentApi)

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        toolCallResponse([
          {
            id: "call_structure",
            function: { index: 0, name: "get_maze_structure", arguments: {} },
          },
        ], { prompt_eval_count: 21, eval_count: 13 }),
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
        player: string
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
      player: "Blue the Trailblazer - Default",
      reasoning: agent.reasoningEffort,
      tools: expectedLoggedTools(uncalledTools([]), true),
      messages: [
        { role: "system", content_checksum: checksumLoggedDescription(developerMessage), content: developerMessage },
        { role: "user", content_checksum: checksumLoggedDescription(userMessage), content: userMessage },
      ],
    })

    // Round 2 logs the full accumulated history (system+user+assistant+tool), not just the new
    // assistant/tool-result messages - no delta tracking, every entry stands on its own. Not
    // every tool has been called yet, so only the still-uncalled tools remain on the wire, all
    // with full definitions. keepFull only covers request 1 (isFirstRequestOfLevel && requestCount <= 1),
    // so by round 2 the system/user prompt and tool descriptions are previewed even within the
    // level's first turn - further limiting duplication across a single turn's tool-call rounds.
    expect(requestEntries[1].details).toEqual({
      endpoint,
      api: agent.api,
      requestCount: 2,
      agentMode: "tools",
      player: "Blue the Trailblazer - Default",
      reasoning: agent.reasoningEffort,
      tools: expectedLoggedTools(uncalledTools(["get_maze_structure"]), false),
      messages: [
        {
          role: "system",
          content_checksum: checksumLoggedDescription(developerMessage),
          content: `${developerMessage.slice(0, 25)}...`,
        },
        {
          role: "user",
          content_checksum: checksumLoggedDescription(userMessage),
          content: `${userMessage.slice(0, 25)}...`,
        },
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
          // The logged copy: cells as [row, col], openMoves as [move, status] pairs, cellType
          // recomputed by the reader. Checksummed against the full result the model was sent.
          content_checksum: checksumLoggedDescription(structureToolResult()),
          content: compactedStructureToolResult(),
        },
      ],
    })
  })

  it("logs the encoded maze before the level's first request", async () => {
    await tapooResetLogs(CONFIG.runtime.controlModes.agentApi)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(successfulResponse(JSON.stringify({ moves: ["MoveRight"] }))),
    )

    await requestPrediction(requestInput({
      finalPosition: { x: 1, y: 1 },
      maze: [
        ["|", "---", "|"],
        ["|", "   ", "|"],
        ["|", "---", "|"],
      ],
      mazeDimensions: { numCols: 1, numRows: 1, area: 1 },
      startPosition: { x: 1, y: 1 },
    }))

    const entries = loadTapooLog<{
      payload: string
      level: number
      game: number
      details?: Record<string, unknown>
    }>(CONFIG.runtime.controlModes.agentApi)

    const levelStartedIndex = entries.findIndex((entry) => entry.payload === "Agent level started.")
    const requestIndex = entries.findIndex((entry) => entry.payload === "Agent request.")
    expect(levelStartedIndex).toBeGreaterThanOrEqual(0)
    expect(requestIndex).toBeGreaterThan(levelStartedIndex)

    const levelStarted = entries[levelStartedIndex]
    expect(levelStarted.level).toBe(1)
    expect(levelStarted.game).toBe(0)
    // Static expected encoding for this 1x1 maze, first-seen order "|"(0), "---"(1), "   "(2),
    // then "\n"(3) as the row separator.
    expect(levelStarted.details).toEqual({
      startPosition: { x: 1, y: 1 },
      finalPosition: { x: 1, y: 1 },
      // Recorded once here rather than in every turn's get_maze_structure result: both are fixed
      // for the level, and a reader needs them to expand the compacted per-turn results.
      destinationCell: { row: 0, col: 0 },
      historyWindowRadius: CONFIG.runtime.modelConfig.manhattanDistance,
      maze: {
        index_chars: ["|", "---", "   ", "\n"],
        structure_checksum: "0x279d74cddf9d2e85",
        structure: "01030203010",
        dimensions: { numCols: 1, numRows: 1, area: 1 },
      },
    })
  })

  it("stamps every request/response entry with the maze level being played", async () => {
    await tapooResetLogs(CONFIG.runtime.controlModes.agentApi)

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
    await tapooResetLogs(CONFIG.runtime.controlModes.agentApi)

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
        player: string
        tools: { name: string; description?: string }[]
        messages: unknown[]
      }
    }>(CONFIG.runtime.controlModes.agentApi).filter(
      (entry) => entry.payload === "Agent request.",
    )

    expect(requestEntries).toHaveLength(2)
    expect(
      loadTapooLog<{ payload: string }>(CONFIG.runtime.controlModes.agentApi)
        .some((entry) => entry.payload === "Agent level started."),
    ).toBe(false)

    // Round 1: the static system/user prompt is previewed (role intact, content shortened),
    // and tool descriptions are previewed too, since both repeat verbatim every turn.
    expect(requestEntries[0].details).toEqual({
      endpoint,
      api: agent.api,
      requestCount: 1,
      agentMode: "tools",
      player: "Blue the Trailblazer - Default",
      reasoning: agent.reasoningEffort,
      tools: expectedLoggedTools(uncalledTools([]), false),
      messages: [
        {
          role: "system",
          content_checksum: checksumLoggedDescription(developerMessage),
          content: `${developerMessage.slice(0, 25)}...`,
        },
        {
          role: "user",
          content_checksum: checksumLoggedDescription(userMessage),
          content: `${userMessage.slice(0, 25)}...`,
        },
      ],
    })

    // Round 2 logs the full accumulated history too - the previewed system/user messages stay
    // previewed (gated by role, not round, so this stays consistent with round 1), while the
    // assistant/tool-call messages are turn-unique and always log in full.
    expect(requestEntries[1].details).toEqual({
      endpoint,
      api: agent.api,
      requestCount: 2,
      agentMode: "tools",
      player: "Blue the Trailblazer - Default",
      reasoning: agent.reasoningEffort,
      tools: expectedLoggedTools(uncalledTools(["get_maze_structure"]), false),
      messages: [
        {
          role: "system",
          content_checksum: checksumLoggedDescription(developerMessage),
          content: `${developerMessage.slice(0, 25)}...`,
        },
        {
          role: "user",
          content_checksum: checksumLoggedDescription(userMessage),
          content: `${userMessage.slice(0, 25)}...`,
        },
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
          // The logged copy: cells as [row, col], openMoves as [move, status] pairs, cellType
          // recomputed by the reader. Checksummed against the full result the model was sent.
          content_checksum: checksumLoggedDescription(structureToolResult()),
          content: compactedStructureToolResult(),
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
      options: {
        num_ctx: CONFIG.runtime.modelConfig.contextWindowFloor,
        num_predict: CONFIG.runtime.modelConfig.maxTokens,
      },
      think: true,
      stream: false,
    })
  })

  // The opening persona is decided per agent, not per round. In a multi-agent round the seats play
  // in rotation, so the second and later agents make their own first prediction on a nonzero shared
  // State.turnCount - they are still unmeasured, and must still be told they open at trailblazer.
  it("primes an agent on its own first turn even when the round is already several turns in", async () => {
    const fetchMock = vi.fn().mockResolvedValue(successfulResponse("{\"moves\":[\"MoveRight\"]}"))
    vi.stubGlobal("fetch", fetchMock)

    await requestPrediction({
      ...requestInput({ turnCount: 3 }),
      agent: { ...agent, turnCount: 0, decayUnitsCharged: 0 },
    })

    const requestBody = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    ) as SerializedRequestBody
    expect(requestBody.messages[0]).toEqual({ role: "system", content: developerMessage })
    expect(developerMessage).toContain("primed for success")
  })

  // The contrast that makes the test above mean something, one counter at a time. Any single
  // non-zero counter is enough to withdraw the opening framing: the three are checked together
  // precisely so that no one of them can carry the claim on its own.
  const playedAgentCases = [
    {
      name: "a turn of its own",
      agentOverrides: { turnCount: 1 },
      stateOverrides: {},
    },
    {
      name: "decay units of its own",
      agentOverrides: { decayUnitsCharged: 2 },
      stateOverrides: {},
    },
    {
      name: "a cell of its own on the board",
      agentOverrides: {},
      stateOverrides: {
        traversalHistory: [{ playerName: "Blue", row: 0, col: 0, openMoves: [], visitCount: 1 }],
      } satisfies Partial<State>,
    },
  ]

  for (const { name, agentOverrides, stateOverrides } of playedAgentCases) {
    it(`drops the opening framing once the agent has ${name}`, async () => {
      const fetchMock = vi.fn().mockResolvedValue(successfulResponse("{\"moves\":[\"MoveRight\"]}"))
      vi.stubGlobal("fetch", fetchMock)

      await requestPrediction({
        ...requestInput({ turnCount: 3, ...stateOverrides }),
        agent: { ...agent, turnCount: 0, decayUnitsCharged: 0, ...agentOverrides },
      })

      const requestBody = JSON.parse(
        (fetchMock.mock.calls[0][1] as RequestInit).body as string,
      ) as SerializedRequestBody
      const systemMessage = requestBody.messages[0] as { role: string; content: string }
      expect(systemMessage.content).not.toContain("primed for success")
      expect(systemMessage.content).not.toBe(developerMessage)
    })
  }

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
          decayUnitsRemaining: Math.ceil(state.score / CONFIG.timing.scoreDecayRate),
          lastMoveStatus: null,
          predictionStatus: null,
          lastReplayStartIndex: null,
          lastReplayStartCell: null,
          lastSubmittedMoves: [],
          lastAppliedMoveIndex: null,
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
        decayUnitsRemaining: Math.ceil(state.score / CONFIG.timing.scoreDecayRate),
        lastMoveStatus: null,
        predictionStatus: null,
        lastReplayStartIndex: null,
        lastReplayStartCell: null,
        lastSubmittedMoves: [],
        lastAppliedMoveIndex: null,
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

    // The first request fires immediately - no delay applied before it.
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

  it("returns token-limit-exhaustion when capped token usage produces an empty prediction", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        // A large prompt_eval_count on its own must never trigger this - only eval_count (the
        // completion side alone) is compared against maxTokens. See providers.test.ts's
        // "ignoring the prompt side" coverage for that in isolation.
        prompt_eval_count: 1,
        eval_count: CONFIG.runtime.modelConfig.maxTokens,
        message: { role: "assistant", content: "" },
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(requestPrediction(requestInput())).resolves.toMatchObject({
      ok: false,
      reason: "token-limit-exhaustion",
      diagnostic: {
        message: "Agent exhausted the token cap without returning a prediction.",
        details: {
          endpoint,
          requestCount: 2,
          tokensUsed: CONFIG.runtime.modelConfig.maxTokens,
        },
      },
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const firstRequest = fetchMock.mock.calls[0]?.[1] as RequestInit
    const retryRequest = fetchMock.mock.calls[1]?.[1] as RequestInit
    if (typeof firstRequest.body !== "string" || typeof retryRequest.body !== "string") {
      throw new Error("expected token-limit retry request bodies to be serialized json")
    }
    const firstBody = JSON.parse(firstRequest.body) as { messages: unknown[]; tools: unknown[] }
    const retryBody = JSON.parse(retryRequest.body) as {
      messages: Array<{ role: string; content?: string }>
      tools: unknown[]
    }
    expect(retryBody.messages.slice(0, -1)).toEqual(firstBody.messages)
    expect(retryBody.tools).toEqual(firstBody.tools)
    expect(retryBody.messages.at(-1)).toEqual(buildTokenLimitExhaustionPrompt(
      CONFIG.runtime.modelConfig.maxTokens,
    ))
  })

  it("keeps nonempty invalid capped output classified as malformed-response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        prompt_eval_count: CONFIG.runtime.modelConfig.maxTokens,
        eval_count: 0,
        message: { role: "assistant", content: "not-json" },
      }),
    }))

    await expect(requestPrediction(requestInput())).resolves.toMatchObject({
      ok: false,
      reason: "malformed-response",
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

  it("adds a dual-meaning explanation for provider 429 responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: "",
        text: vi.fn().mockResolvedValue("{\"error\":\"Rate limit exceeded\"}\n"),
      }),
    )

    await expect(requestPrediction(requestInput())).resolves.toMatchObject({
      ok: false,
      reason: "network-error",
      diagnostic: {
        message: "Provider HTTP response failed.",
        details: {
          endpoint,
          status: 429,
          statusText: "",
          statusHint:
            "429 may mean rate limiting or temporary provider capacity exhaustion.",
          responseBody: "{\"error\":\"Rate limit exceeded\"}\n",
        },
      },
    })
  })

  it("adds a broad provider-switch hint for 400 request-payload failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "",
        text: vi.fn().mockResolvedValue(
          "{\"error\":{\"message\":\"Invalid JSON data: missing field `json_schema`\",\"type\":\"invalid_request_error\",\"code\":\"json_parse_error\"}}",
        ),
      }),
    )

    await expect(requestPrediction(requestInput())).resolves.toMatchObject({
      ok: false,
      reason: "network-error",
      diagnostic: {
        message: "Provider HTTP response failed.",
        details: {
          endpoint,
          status: 400,
          statusText: "",
          statusHint:
            "Provider may have misunderstood the request payload. Try another provider if the explanation made no sense.",
          responseBody:
            "{\"error\":{\"message\":\"Invalid JSON data: missing field `json_schema`\",\"type\":\"invalid_request_error\",\"code\":\"json_parse_error\"}}",
        },
      },
    })
  })

  it("applies the same 400 explanation to unsupported payload parameters too", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "",
        text: vi.fn().mockResolvedValue(
          "{\"error\":{\"message\":\"unsupported reasoning_effort value: max\",\"type\":\"invalid_request_error\",\"code\":\"invalid_parameter\"}}",
        ),
      }),
    )

    await expect(requestPrediction(requestInput())).resolves.toMatchObject({
      ok: false,
      reason: "network-error",
      diagnostic: {
        message: "Provider HTTP response failed.",
        details: {
          endpoint,
          status: 400,
          statusText: "",
          statusHint:
            "Provider may have misunderstood the request payload. Try another provider if the explanation made no sense.",
          responseBody:
            "{\"error\":{\"message\":\"unsupported reasoning_effort value: max\",\"type\":\"invalid_request_error\",\"code\":\"invalid_parameter\"}}",
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
          statusHint: "Provider-side error unrelated to the request payload; usually transient.",
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
    // activeController is briefly null between one round's cleanup and the next round's fetch -
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

  // A round that stops mid-turn is lifecycle cleanup, exactly like a caller abort - not a provider
  // failure - so it must not spend score or disable the agent.
  it("stops before the first request when the round is no longer running", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const request = requestPredictionWithAbort({
      ...requestInput(),
      isRoundRunning: () => false,
    })

    await expect(request.promise).resolves.toEqual({ ok: false, reason: "caller-abort" })
    // Not one provider request went out for a round that had already stopped.
    expect(fetchMock).not.toHaveBeenCalled()
    expect(request.isAborted()).toBe(true)
  })

  // The case the live callback exists for: a turn spans several provider requests, and the round
  // stops after the first. A value read off the frozen stateSnapshot could never notice this.
  it("stops between provider requests when the round stops mid-turn", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        toolCallResponse([
          { function: { name: "get_maze_structure", arguments: {} } },
        ]),
      )
      .mockResolvedValueOnce(successfulResponse("{\"moves\":[\"MoveRight\"]}"))
    vi.stubGlobal("fetch", fetchMock)

    let running = true
    const request = requestPredictionWithAbort({
      ...requestInput(),
      isRoundRunning: () => running,
    })

    // Let the first round's fetch resolve and its tool call be serviced, then stop the round
    // before the follow-up request goes out.
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    running = false

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
    expect(secondBody.options).toEqual({
      num_ctx: CONFIG.runtime.modelConfig.contextWindowFloor,
      num_predict: CONFIG.runtime.modelConfig.maxTokens,
    })
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
    // get_last_prediction_outcome dropped entirely - no early forcing into prediction mode.
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
    // same response - only get_maze_structure should be serviced; get_last_prediction_outcome should get a
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

    // A mixed round makes real progress, so it must not consume the two-strike allowance -
    // round 3 is a clean predict attempt rather than a "warned" round.
    const agentModes = loadTapooLog<{ payload: string; details?: { agentMode: string } }>(
      CONFIG.runtime.controlModes.agentApi,
    )
      .filter((entry) => entry.payload === "Agent request.")
      .map((entry) => entry.details?.agentMode)
    expect(agentModes.at(-1)).not.toBe("warned")
  })

  it("gives one reminder before failing on a second all-duplicate round", async () => {
    // Round 1 (agentMode: tools): model calls every tool - natural exhaustion, predict mode next.
    // Round 2 (agentMode: predict): model re-requests an already-called tool - first violation:
    // no payload is re-served, just a reminder naming that specific call.
    // Round 3 (agentMode: warned): model re-requests it again despite the reminder - second
    // violation: the turn fails as malformed-response instead of reminding indefinitely.
    await tapooResetLogs(CONFIG.runtime.controlModes.agentApi)

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

    // Round 2's violation must have gotten a reminder naming that specific call - no re-served
    // payload - shown as the final message of round 3's own request body.
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
    await tapooResetLogs(CONFIG.runtime.controlModes.agentApi)

    const credentialSentinel = "sk-redaction-sentinel-credential-000111"
    const extraHeadersSentinel = "redaction-sentinel-extra-header-222333"
    const anthropicAgent: AgentApiSeatConfig = {
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
    const openaiAgent: AgentApiSeatConfig = { ...agent, api: "openai", echoBackReasoning: true }
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
    const openaiAgent: AgentApiSeatConfig = { ...agent, api: "openai" }
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
    // agent.api is typed as AgentApiProvider, but that only binds at compile time - this exercises
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
    // No request should have gone out - there is no wire format to build a body or headers with.
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
