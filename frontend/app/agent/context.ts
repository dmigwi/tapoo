import { AGENT_MOVES_PER_TURN_CAP, CONFIG } from "../config"
import { getNavigationProfile } from "../maze"
import {
  MOVE_ACTIONS,
  MOVE_DELTAS,
  cellCoordinateFromGridPoint,
  cloneTraversalHistory,
  mazeCellKey,
} from "../traversal"
import {
  getBatchEfficiencyMetrics,
  resolveBatchEfficiencyRank,
} from "./efficiency"
import type { BatchEfficiencyRank } from "./efficiency"
import type {
  AgentChatMessage,
  AgentApiConfig,
  AgentExpectedResponseSchema,
  AgentSubmittedMovesSchema,
  AgentToolCall,
  AgentToolDefinition,
  AgentToolHandlers,
  CellCoordinate,
  MazeActionResult,
  State,
  TraversalHistoryEntry,
} from "../types"

const { runtime, scoring } = CONFIG
const { agentBaseDecayUnits, agentPenaltyDecayUnits } = scoring

// --- Shared constants ---
// These are referenced by both the message builders and the tool layer below.

// EXPECTED_RESPONSE_SCHEMA documents the exact JSON shape returned by prediction sources.
export const EXPECTED_RESPONSE_SCHEMA: AgentExpectedResponseSchema = {
  type: "object",
  description:
    "The only accepted response format. Return this exact " +
    "JSON object with no surrounding text or markdown fences.",
  additionalProperties: false,
  required: ["moves"],
  properties: {
    moves: {
      type: "array",
      minItems: 1,
      items: {
        type: "string",
        enum: [...MOVE_ACTIONS],
      },
    },
  },
}

// PREDICTION_FORMAT is the Ollama-compatible structured-output schema for the final prediction
// request. It uses the same shape as EXPECTED_RESPONSE_SCHEMA but omits description so Ollama
// treats it as a pure JSON Schema constraint, not a model-facing annotation.
export const PREDICTION_FORMAT = {
  type: "object",
  additionalProperties: false,
  required: EXPECTED_RESPONSE_SCHEMA.required,
  properties: EXPECTED_RESPONSE_SCHEMA.properties,
} as const

// SUBMITTED_MOVES_SCHEMA documents the zero-based replay records returned after processing moves.
export const SUBMITTED_MOVES_SCHEMA: AgentSubmittedMovesSchema = {
  type: "array",
  description: "Zero-based replay records formatted as <index>:<move>.",
  items: {
    type: "string",
    pattern: "^(0|[1-9][0-9]*):(MoveUp|MoveDown|MoveLeft|MoveRight)$",
    examples: ["0:MoveRight", "1:MoveUp", "2:MoveRight", "..."],
  },
}

// --- 1. Messages ---
// System and user messages are the first content the model receives each turn.

// describeAgentRankIdentity states the agent's current rank as a personal identity to
// defend or escape. It stays deliberately bare: the flat-penalty mechanic that makes the
// identity worth acting on is already explained once in buildMazeActionPrompt, so repeating it
// here would only duplicate that reasoning rather than reinforce it.
export function describeAgentRankIdentity(
  playerName: string,
  rank: BatchEfficiencyRank,
): string {
  if (rank === "trailblazer") {
    return `You are ${playerName} and currently hold the most coveted rank of trailblazer. Work smarter to maintain it.`
  }

  return [
    `You are ${playerName} and currently hold the rank of ${rank}. Work smarter to climb to the most coveted rank of`,
    `trailblazer.`,
  ].join(" ")
}

// buildMazeActionPrompt keeps request guidance compact while naming the active player.
export function buildMazeActionPrompt(playerName: string, batchEfficiencyRank: BatchEfficiencyRank): string {
  const maxTurnCost = agentBaseDecayUnits + agentPenaltyDecayUnits
  return [
    describeAgentRankIdentity(playerName, batchEfficiencyRank),
    `playerName ${runtime.interactivePlayerName} always appears first in traversalHistory and marks the start cell.`,
    "currentCell is your current position; destinationCell is the target. The maze is randomly generated at each level",
    "with exactly one path to the destination. traversalHistory entries matching your playerName record your past",
    "moves in chronological order. Each entry's openMoves maps every open exit from that cell directly to the",
    "neighboring cell it leads to and whether that neighbor is already visited — exits from a cell are fixed since",
    "creation, so this helps you reconstruct the maze's path flow without computing adjacency yourself; entries",
    "recorded by other players are just as trustworthy as your own. openMoves key count reveals the physical maze",
    "structure at that cell: one open exit is a dead end (unless that is your start or destination cell); two is a",
    "corridor; three or more is a junction.",
    "traversalHistory only records the first visit to each cell; cells revisited during backtracking are not",
    "duplicated, so apparent gaps are expected. Revisiting a cell already in traversalHistory is not a mistake — once",
    "the current path is confirmed as leading to a dead end, backtracking through those cells is usually the only way",
    "to reach unexplored territory or the destination. By design, the maze never guarantees a direct route from start",
    "to destination; the only valid path may require moving away from the target before turning towards it. Tool",
    "results reflect the maze state at the time of each call — a repeat call may return updated or identical data",
    "depending on what has changed. get_last_replay_result reflects the most recent replay across all agents;",
    "lastPlayerName identifies whose outcome it is. lastMoveStatus being null means no moves have been made yet;",
    "invalid-move means the last prediction hit a wall; malformed-response means the previous response was not valid",
    "JSON, requested a tool that does not exist, or ignored a duplicate tool call warning — in all cases a penalty",
    `of ${agentPenaltyDecayUnits} decay units was charged;`,
    `applied means it succeeded. A turn with any valid moves costs a constant ${agentBaseDecayUnits} decay units`,
    "regardless of how many moves it applied; invalid moves (any moves after the last valid applied move) add a",
    `further penalty of ${agentPenaltyDecayUnits} decay units on top — the maximum possible in a turn is`,
    `${maxTurnCost} decay units.`,
    "get_prediction_rules provides the required response format and move count guidance. Moves replay in submitted",
    "order until the destination is reached or the first invalid move (a wall collision or out-of-bounds step) is hit.",
    "Because the charge above is per turn rather than per move, a longer prediction whose moves all land, covers more",
    "new cells for the same decay — that ratio is your traversal speed, and it is the rank you carry: a trailblazer",
    "can set a new scores retention record, a navigator's odds of finishing drop sharply, and a backtracker is almost",
    "certain to fail unless it corrects course. lastMoveStatus reached-target or status won means the game is",
    "complete — stop predicting.",
  ].join(" ")
}

// buildAgentMessages separates durable behavior instructions from the current turn request.
export function buildAgentMessages(playerName: string, batchEfficiencyRank: BatchEfficiencyRank): AgentChatMessage[] {
  return [
    {
      role: "system",
      content: buildMazeActionPrompt(playerName, batchEfficiencyRank),
    },
    {
      role: "user",
      content: `It is ${playerName}'s turn to predict next moves. Use the available tools to see the maze state.`,
    },
  ]
}

// buildDuplicateToolCallMessage names exactly which tool call(s) already have results, rather
// than claiming no tool call can return anything new — other tools may still be genuinely
// uncalled, and the model remains free to request those. It is explicitly labeled "Warning:" and
// uses the same "duplicate tool call warning" phrase as buildMazeActionPrompt's malformed-response
// explanation, so a model that ignores it can tie the resulting penalty back to this message.
// describeToolCall renders each call as "name (id)", falling back to placeholders for the rare
// case a provider omits either field.
export function buildDuplicateToolCallMessage(duplicateToolCalls: AgentToolCall[]): AgentChatMessage {
  const describeToolCall = (toolCall: AgentToolCall) =>
    `${toolCall.function?.name ?? "unknown"} (${toolCall.id ?? "no id"})`

  return {
    role: "user",
    content:
      `Warning: ${duplicateToolCalls.map(describeToolCall).join(", ")} won't yield any new information. ` +
      "You may still call any tools you haven't used yet, or respond now with only the moves JSON. Requesting " +
      "these tool call(s) once again will be treated as a malformed-response.",
  }
}

// --- 2. Tool definitions ---
// Tool definitions are sent alongside messages so the model knows what it can call.
// Tool return formats are documented in descriptions because `parameters` only describes inputs.

const emptyToolParameters: AgentToolDefinition["function"]["parameters"] = {
  type: "object",
  properties: {},
  required: [],
}

// predictionRulesTool documents the only accepted move response and the suggested batch size.
// It deliberately does not restate the charging model: buildMazeActionPrompt already carries that,
// with the actual unit counts, and is sent as the system message on every single turn. The split is
// that the prompt owns the durable rules — what a turn costs and what each rank implies — while this
// tool owns the live numbers and how to read them: the raw metrics, the division that yields
// traversal speed, the thresholds it is scored against, and where to find the resulting retention.
const predictionRulesTool: AgentToolDefinition = {
  type: "function",
  function: {
    name: "get_prediction_rules",
    description: [
      "Get move response rules. suggestedMovesPerTurn is the suggested moves count to include in your predictions",
      "response per turn. uniqueCellsVisited divided by decayUnitsCharged is your current traversal speed, the",
      "progress per decay unit spent — a scale grouped by batchEfficiencyRank. Only a cell's first visit counts as",
      "progress. The higher the traversal speed, the higher the likelihood of finding the target on time.",
      "batchEfficiencyRank is set to backtracker rank when the speed is below 1.0 (units wasted on invalid moves or",
      "oscillation between visited cells), navigator rank at 1.0 (one new cell move per decay unit),",
      "or trailblazer rank above 1.0 (valid multi-move guesses are paying off — the only rank that can set a new",
      "score retention record). turnsTaken is reported for context and does not affect your speed, rank or scores",
      "Each turn's decay units are subtracted immediately; the resulting score retention is visible via",
      "get_game_status.",
      "Before anything is charged on this level, batchEfficiencyRank defaults to trailblazer regardless of these",
      "counts, so you start already primed to predict multi-move sequences. Returns JSON:",
      "{\"suggestedMovesPerTurn\":number, \"uniqueCellsVisited\":number, \"decayUnitsCharged\":number,",
      "\"turnsTaken\":number, \"batchEfficiencyRank\":string,\"expectedResponseSchema\":object}.",
    ].join(" "),
    parameters: emptyToolParameters,
  },
}

// gameStatusTool exposes round progress and maze dimensions without leaking full state.
const gameStatusTool: AgentToolDefinition = {
  type: "function",
  function: {
    name: "get_game_status",
    description: [
      "Get current Tapoo level, status, score, and maze dimensions. status is one of: running (prediction active), won",
      "(destination reached, stop predicting), lost, await-agent, or paused. Returns JSON: {\"level\":number,",
      "\"status\":string, \"score\":number, \"mazeDimensions\":{\"numCols\":number, \"numRows\":number,",
      "\"area\":number}}. numCols is the number of columns, numRows is the number of rows, area is the total cell",
      "count.",
    ].join(" "),
    parameters: emptyToolParameters,
  },
}

// mazePositionsTool gives agents their current location and destination in one call.
const mazePositionsTool: AgentToolDefinition = {
  type: "function",
  function: {
    name: "get_maze_positions",
    description: [
      "Get current cell and destination cell. Row increases going down, col increases going right; MoveUp decreases",
      "row by 1 and MoveDown increases it by 1; MoveLeft decreases col by 1 and MoveRight increases it by 1. Use",
      "get_traversal_history to find which moves are open from the current cell. Returns JSON:",
      "{\"currentCell\":{\"row\":number, \"col\":number}|null,",
      "\"destinationCell\":{\"row\":number, \"col\":number}|null}.",
    ].join(" "),
    parameters: emptyToolParameters,
  },
}

// traversalHistoryTool lets agents avoid repeating explored logical cells across turns.
// Each entry's openMoves resolves every open exit directly to the neighboring cell it leads to
// and whether that neighbor is already visited, so the model can reconstruct dead ends,
// corridors, and junctions without computing adjacency from row/col itself.
const traversalHistoryTool: AgentToolDefinition = {
  type: "function",
  function: {
    name: "get_traversal_history",
    description: [
      "Get all players' visit records in chronological order, structured as an adjacency list. cell is that entry's",
      "position. openMoves maps each open exit directly to the neighboring cell it leads to and whether that neighbor",
      "has already been visited — the exits from a cell are fixed since creation, so this lets you reconstruct the",
      "physical maze structure you have already explored without computing adjacency from row/col yourself. Use the",
      "full, unfiltered list for maze-structure reconstruction — every player's openMoves data is equally trustworthy;",
      "filter by playerName only when you specifically want one player's own chronological move sequence.",
      "Returns JSON: {\"traversalHistory\":[{\"playerName\":string, \"cell\":{\"row\":number, \"col\":number},",
      "\"openMoves\":{\"MoveLeft\":{\"row\":number, \"col\":number, \"visited\":boolean}, ...}}]}.",
    ].join(" "),
    parameters: emptyToolParameters,
  },
}

// lastReplayResultTool reports the previous replay outcome so agents can correct course.
const lastReplayResultTool: AgentToolDefinition = {
  type: "function",
  function: {
    name: "get_last_replay_result",
    description: [
      "Get the previous turn replay result. lastMoveStatus values: null=first turn, no history yet; applied=move",
      "executed and added to traversal history; reached-target=destination reached, stop predicting; invalid-move=move",
      "hit a wall or boundary, replay stopped; malformed-response=previous response was not valid JSON, requested a",
      "tool that does not exist, or ignored a duplicate tool call warning — in all cases no moves were replayed and a",
      "fixed score penalty was charged; network-error=HTTP failure, no score charged.",
      "lastSubmittedMoves lists the moves from that turn as zero-based <index>:<move> entries; lastReplayStartIndex is",
      "their zero-based offset in the overall submitted move sequence. lastAppliedMoveIndex is the index within",
      "lastSubmittedMoves of the last successfully applied move — moves after it were not executed. visitedBefore",
      "indicates whether the cell entered by the last valid move was already in traversal history. chargedMovesCount",
      "is the total decay units charged toward score that turn. Returns JSON: {\"lastPlayerName\":string|null,",
      "\"lastMoveStatus\":string|null, \"lastReplayStartIndex\":number|null, \"lastSubmittedMoves\":string[],",
      "\"lastAppliedMoveIndex\":number|null, \"visitedBefore\":boolean|null, \"chargedMovesCount\":number}.",
    ].join(" "),
    parameters: emptyToolParameters,
  },
}

// AGENT_CONTEXT_TOOLS exposes focused context slices instead of one oversized state object.
export const AGENT_CONTEXT_TOOLS: AgentToolDefinition[] = [
  predictionRulesTool,
  gameStatusTool,
  mazePositionsTool,
  traversalHistoryTool,
  lastReplayResultTool,
]

// --- 3. Tool handlers ---
// Handlers execute when the model calls a tool and produce the tool result messages.

// resolvedOpenMoves maps each of an entry's open exits to its neighboring cell (using the same
// row/col deltas mazePositionsTool documents) and whether that neighbor is already visited, using
// a precomputed key set so every lookup stays O(1) rather than rescanning traversalHistory per
// neighbor per entry. Precomputing the neighbor cells here spares the model from re-deriving
// adjacency via coordinate arithmetic itself across dozens of traversalHistory entries.
function resolvedOpenMoves(
  entry: TraversalHistoryEntry,
  visitedCellKeys: Set<string>,
): Record<string, CellCoordinate & { visited: boolean }> {
  return Object.fromEntries(
    entry.openMoves.map((move) => {
      const [rowDelta, colDelta] = MOVE_DELTAS[move]
      const neighbor = { row: entry.row + rowDelta, col: entry.col + colDelta }
      return [move, { ...neighbor, visited: visitedCellKeys.has(mazeCellKey(neighbor)) }]
    }),
  )
}

// buildAgentToolHandlers binds the latest state snapshot to the context tools for this request.
export function buildAgentToolHandlers(
  state: State,
  lastActionResult: MazeActionResult | null,
  agent: AgentApiConfig,
): AgentToolHandlers {
  return {
    get_prediction_rules() {
      // The max corridor length governs DFS maze carving, not player path planning.
      // AGENT_MOVES_PER_TURN_CAP (p95 of actual run lengths) is the tighter bound for predictions.
      // getNavigationProfile dereferences the dimensions, so it stays inside the null branch.
      const suggestedMovesPerTurn = state.mazeDimensions
        ? Math.min(getNavigationProfile(state.mazeDimensions).__maxCorridorLength, AGENT_MOVES_PER_TURN_CAP)
        : 0

      // Raw counts are exposed instead of the derived rate so the model can compute and verify the
      // rank itself; all are always concrete numbers (0 is a valid count), never null, so there is
      // nothing ambiguous for the model to puzzle over before its first request.
      const batchEfficiencyRank = resolveBatchEfficiencyRank(state.traversalHistory, agent)
      const { uniqueCellsVisited, decayUnitsCharged, turnsTaken } =
        getBatchEfficiencyMetrics(state.traversalHistory, agent)
      return {
        suggestedMovesPerTurn,
        uniqueCellsVisited,
        decayUnitsCharged,
        turnsTaken,
        batchEfficiencyRank,
        expectedResponseSchema: EXPECTED_RESPONSE_SCHEMA,
      }
    },
    get_game_status() {
      return {
        score: state.score,
        level: state.level,
        status: state.status,
        mazeDimensions: state.mazeDimensions,
      }
    },
    get_maze_positions() {
      return {
        currentCell: state.playerPosition ? cellCoordinateFromGridPoint(state.playerPosition) : null,
        destinationCell: state.finalPosition ? cellCoordinateFromGridPoint(state.finalPosition) : null,
      }
    },
    get_traversal_history() {
      const history = cloneTraversalHistory(state.traversalHistory)
      const visitedCellKeys = new Set(history.map((entry) => mazeCellKey(entry)))

      return {
        traversalHistory: history.map((entry) => ({
          playerName: entry.playerName,
          cell: { row: entry.row, col: entry.col },
          openMoves: resolvedOpenMoves(entry, visitedCellKeys),
        })),
      }
    },
    get_last_replay_result() {
      return {
        lastPlayerName: lastActionResult?.lastPlayerName ?? null,
        lastMoveStatus: lastActionResult?.lastMoveStatus ?? null,
        lastReplayStartIndex: lastActionResult?.lastReplayStartIndex ?? null,
        lastSubmittedMoves: lastActionResult?.lastSubmittedMoves ?? [],
        lastAppliedMoveIndex: lastActionResult?.lastAppliedMoveIndex ?? null,
        visitedBefore: lastActionResult?.visitedBefore ?? null,
        chargedMovesCount: lastActionResult?.chargedMovesCount ?? 0,
      }
    },
  }
}
