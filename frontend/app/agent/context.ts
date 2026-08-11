import { CONFIG } from "../config"
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
  resolveBatchEfficiencyClass,
} from "./efficiency"
import type { BatchEfficiencyClass } from "./efficiency"
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
const {
  agentBaseDecayUnits,
  agentPartialInvalidPenaltyDecayUnits,
  agentZeroProgressPenaltyDecayUnits,
  agentMalformedPenaltyDecayUnits,
} = scoring

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

// describeAgentSpeedClassification states the agent's current traversal-speed classification, with
// enough color to make it land emotionally. It does not restate the mechanics: the flat per-turn
// charge that makes climbing the classification worthwhile is already explained once in
// buildMazeActionPrompt, so repeating it here would only duplicate that reasoning rather than
// reinforce it.
export function describeAgentSpeedClassification(
  playerName: string,
  speedClass: BatchEfficiencyClass,
): string {
  if (speedClass === "trailblazer") {
    return [
      `You are ${playerName} and your traversal speed classifies as trailblazer. You are in the genius zone and`,
      `might set a new record if you keep it up.`,
    ].join(" ")
  }

  return [
    `You are ${playerName} and your traversal speed has dropped to a classification of ${speedClass}. You've got an`,
    `uphill task and need to work smarter to climb into the genius zone of trailblazer classification.`,
  ].join(" ")
}

// buildMazeActionPrompt keeps request guidance compact while naming the active player.
export function buildMazeActionPrompt(playerName: string, batchEfficiencyClass: BatchEfficiencyClass): string {
  const partialInvalidTurnCost = agentBaseDecayUnits + agentPartialInvalidPenaltyDecayUnits
  return [
    describeAgentSpeedClassification(playerName, batchEfficiencyClass),
    "Call every available tool once on each turn before returning moves. Start with get_maze_structure to read currentCell,",
    "destinationCell, and nearby maze structure; call get_prediction_rules for the required response format, suggested",
    "move count, mazeDimensions, and traversal-speed metrics; call get_last_prediction_outcome for current status,",
    "score, and the previous prediction outcome.",
    "The maze is randomly generated at the start of each level with exactly one path to the destination. For the current",
    "level, maze dimensions and wall/open-exit structure are fixed once generated. When present in filteredTraversalHistory,",
    `playerName ${runtime.interactivePlayerName} marks the start cell. Use openMoves from filteredTraversalHistory`,
    "entries to build a local map; entries recorded by other players are just as trustworthy as your own.",
    "Revisiting a cell already in filteredTraversalHistory is not a mistake — once you have actually visited a cell",
    "and its type is dead-end, backtracking through it is usually the only way to reach unexplored territory or the",
    "destination. type, read directly from a visited cell's own entry, is the only reliable way to know it is a",
    "dead-end. Never assume a cell you have not yet visited is a dead-end — the absence of a connection to it from cells",
    "you already know proves nothing, since an unexplored cell's own exits are unknown until you move there.",
    "When judging whether one candidate cell is closer to destinationCell than another, compare the full combined",
    "distance (row difference plus col difference) for each candidate, not just one axis — a cell closer in column can",
    "be equally or further away overall once row is included. By design, the maze never guarantees a direct route from start",
    "to destination; the only valid path may require moving away from the target before turning towards it.",
    "Use lastMoveStatus to understand the outcome and chargedMovesCount for the exact score-decay impact from that outcome.",
    `A turn with any valid moves costs a constant ${agentBaseDecayUnits} decay units regardless of how many moves it`,
    `applied. If any of those moves is invalid, that adds a further penalty of ${agentPartialInvalidPenaltyDecayUnits}`,
    `decay unit on top - for ${partialInvalidTurnCost} decay units in total. If the very first submitted move is already invalid —`,
    `no progress at all — the turn instead costs a flat ${agentZeroProgressPenaltyDecayUnits} decay units.`,
    "A malformed response (invalid JSON, an unknown tool request, or ignoring a duplicate tool call warning) costs a",
    `fixed ${agentMalformedPenaltyDecayUnits} decay units with no moves applied — the costliest outcome of all.`,
    "One way to sustain a traversal speed above 1.0, keeping your classification at trailblazer, is to build a",
    "picture of the maze around your current cell using filteredTraversalHistory and the static maze dimensions.",
    "currentCell's openMoves are a natural place to start when extracting high-confidence multi-move predictions.",
    "With enough of that picture assembled, you can often find several consecutive moves that are all certain to",
    "apply without any invalid-move. You could also invent a better way to sustain that classification.",
    "get_prediction_rules provides the required response format and move count guidance. Submitted moves execute in",
    "order until the destination is reached or the first invalid move (a wall collision or out-of-bounds step) is hit.",
    "Because the charge above is per turn rather than per move, a longer prediction whose moves all land covers more",
    "new cells for the same decay. get_prediction_rules explains the live traversal-speed metrics and classification.",
    "lastMoveStatus reached-target or status won means the game is complete — stop predicting.",
  ].join(" ")
}

// buildAgentMessages separates durable behavior instructions from the current turn request.
export function buildAgentMessages(playerName: string, batchEfficiencyClass: BatchEfficiencyClass): AgentChatMessage[] {
  return [
    {
      role: "system",
      content: buildMazeActionPrompt(playerName, batchEfficiencyClass),
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
// uses the same "duplicate tool call warning" phrase as lastPredictionOutcomeTool's malformed-response
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

// mazeStructureTool gives agents position anchors plus nearby explored structure in one compact call.
const mazeStructureTool: AgentToolDefinition = {
  type: "function",
  function: {
    name: "get_maze_structure",
    description: [
      "Get current/destination cells and the nearby explored maze structure in one call. Row increases going down,",
      "col increases going right; MoveUp decreases row by 1 and MoveDown increases it by 1; MoveLeft decreases col",
      "by 1 and MoveRight increases it by 1. filteredTraversalHistory includes only first-visit records within",
      "historyWindowRadius of currentCell, preserving chronological order; currentCell is always included because",
      "its distance is 0. historyWindowRadius is a fixed configured radius — the maximum Manhattan distance a visited",
      "cell in filteredTraversalHistory can be from currentCell — unrelated to how far destinationCell is; compute that",
      "yourself from currentCell and destinationCell's row/col if you need it. Each included entry's",
      "openMoves maps every fixed open exit from that cell directly to the neighboring cell it leads to and whether",
      "that neighbor has already been visited in the full internal history, even when that neighbor is outside the",
      "filtered result. type is precomputed from that same exit count so you never need to count it yourself:",
      "dead-end (one exit), corridor (two exits), or junction (three or more). type only ever exists for a cell",
      "already in filteredTraversalHistory — an unvisited cell, including one that only appears as a neighbor inside",
      "another cell's openMoves, has no known type and must never be assumed to be of a specific type before visiting.",
      "The only way to learn an unvisited cell's own structure is to move there and read its own entry on a later turn.",
      "Returns JSON: {\"level\":number, \"currentCell\":{\"row\":number, \"col\":number}|null,",
      "\"destinationCell\":{\"row\":number, \"col\":number}|null, \"historyWindowRadius\":number,",
      "\"filteredTraversalHistory\":[{\"playerName\":string, \"cell\":{\"row\":number, \"col\":number},",
      "\"type\":string, \"openMoves\":{\"MoveLeft\":{\"row\":number, \"col\":number, \"visited\":boolean}, ...}}]}.",
    ].join(" "),
    parameters: emptyToolParameters,
  },
}

// predictionRulesTool documents the only accepted move response and the suggested batch size.
// It deliberately does not restate the charging model: buildMazeActionPrompt already carries that,
// with the actual unit counts, and is sent as the system message on every single turn. The split is
// that the prompt owns the durable rules — what a turn costs and what each classification implies —
// while this tool owns the live numbers and how to read them: the raw metrics, the division that
// yields traversal speed, the thresholds it is scored against, and where to find the resulting
// score.
const predictionRulesTool: AgentToolDefinition = {
  type: "function",
  function: {
    name: "get_prediction_rules",
    description: [
      "Get move response rules. suggestedMovesPerTurn is the suggested moves count to include in your predictions",
      "response per turn; it is capped by historyWindowRadius from get_maze_structure. playerUniqueCellsVisited divided by",
      "decayUnitsCharged is your current traversal speed, the progress per decay unit spent — a scale grouped by",
      "batchEfficiencyClass. Only a cell's first visit counts as progress. The higher the traversal speed, the higher",
      "the likelihood of finding the target on time. batchEfficiencyClass is set to backtracker when the speed is below",
      "1.0 (units wasted on invalid moves or oscillation between visited cells), navigator at 1.0",
      "(one new cell move per decay unit), or trailblazer above 1.0 (valid multi-move guesses are paying off — the",
      "only classification that can set a new best-score record). allUniqueCellsVisited is every cell any player has",
      "reached this level, not just your own — compare it against mazeDimensions.totalMazeCells to know how much of the",
      "maze, the team has collectively explored so far. At the initial game levels the single solution path covers nearly",
      "all of totalMazeCells, so expect to explore most of the maze before reaching the destination; the path's length",
      "relative to totalMazeCells drops only slightly as the level number grows, so at higher levels the destination can",
      "be reachable well before allUniqueCellsVisited approaches totalMazeCells. It does not affect your traversal speed,",
      "which is scored on playerUniqueCellsVisited against decayUnitsCharged. totalTurnCount is the number of all completed prediction",
      "turns in this game level. playerTurnsTaken is the completed turns taken by the player and is reported for context;",
      "neither count affects your speed, classification or scores. The resulting score is visible via",
      "get_last_prediction_outcome. mazeDimensions.totalMazeCells is the full level size.",
      "Before anything is charged on this level, batchEfficiencyClass defaults to trailblazer regardless of these",
      "counts, so you start already primed to predict multi-move sequences. Returns JSON:",
      "{\"suggestedMovesPerTurn\":number, \"playerUniqueCellsVisited\":number, \"allUniqueCellsVisited\":number,",
      "\"decayUnitsCharged\":number, \"totalTurnCount\":number, \"playerTurnsTaken\":number, \"batchEfficiencyClass\":string,",
      "\"mazeDimensions\":{\"numCols\":number,\"numRows\":number,\"totalMazeCells\":number}|null,",
      "\"expectedResponseSchema\":object}.",
    ].join(" "),
    parameters: emptyToolParameters,
  },
}

// lastPredictionOutcomeTool reports the previous prediction outcome so agents can correct course.
const lastPredictionOutcomeTool: AgentToolDefinition = {
  type: "function",
  function: {
    name: "get_last_prediction_outcome",
    description: [
      "Get the outcome of the previous submitted moves: whether they fully applied, partially failed, reached the",
      "target, or were rejected. status is the current game status, score is the current score after that outcome.",
      "lastMoveStatus is the outcome of only the single last move actually dispatched that turn:",
      "null=first turn, no history yet; applied=that move executed and was added to traversal history;",
      "invalid-move=that move hit a wall or boundary, execution stopped there; reached-target=destination reached,",
      "stop predicting;",
      "malformed-response=previous response was not valid JSON, requested a tool that does not exist, or ignored a",
      "duplicate tool call warning — no moves were replayed and a fixed score penalty was charged; network-error=HTTP",
      "failure, no score charged. predictionStatus instead summarizes the entire submitted prediction as one story:",
      "all-applied=every submitted move that turn applied cleanly, or the target was reached; partially-applied=some",
      "submitted moves applied before one failed; invalid-prediction=a real prediction was replayed but the very first",
      "submitted move was already invalid, no progress made; empty-prediction=a malformed-response or network-error",
      "meant there was no usable prediction to replay at all.",
      "lastSubmittedMoves lists the moves from that turn as zero-based <index>:<move> entries; lastReplayStartIndex is",
      "their zero-based offset in the overall submitted move sequence. lastAppliedMoveIndex is the index within",
      "lastSubmittedMoves of the last successfully applied move — moves after it were not executed. visitedBefore",
      "indicates whether the cell entered by the last valid move was already in traversal history. On an",
      "empty-prediction turn these four fields are always reset to null/empty, matching that no moves were replayed —",
      "they never carry over stale data from an earlier turn.",
      "chargedMovesCount is the total decay units charged toward score that turn.",
      "Returns JSON: {\"status\":string, \"score\":number,",
      "\"lastPlayerName\":string|null, \"lastMoveStatus\":string|null, \"predictionStatus\":string|null,",
      "\"lastReplayStartIndex\":number|null, \"lastSubmittedMoves\":string[], \"lastAppliedMoveIndex\":number|null,",
      "\"visitedBefore\":boolean|null, \"chargedMovesCount\":number}.",
    ].join(" "),
    parameters: emptyToolParameters,
  },
}

// AGENT_CONTEXT_TOOLS exposes focused context slices instead of one oversized state object.
export const AGENT_CONTEXT_TOOLS: AgentToolDefinition[] = [
  mazeStructureTool,
  predictionRulesTool,
  lastPredictionOutcomeTool,
]

// --- 3. Tool handlers ---
// Handlers execute when the model calls a tool and produce the tool result messages.

// classifyCellType names a visited cell's local structure from its fixed exit count, sparing the
// model from re-deriving "one exit is a dead-end, two is a corridor, three or more is a junction"
// from openMoves key counts itself on every turn. Real gameplay logs showed the model getting this
// wrong even though the rule was already spelled out in mazeStructureTool's description — handing
// it the precomputed label removes the room for that misreading, the same way historyWindowRadius
// and playerUniqueCellsVisited/allUniqueCellsVisited hand over other conclusions instead of raw
// material to re-derive.
function classifyCellType(exitCount: number): "dead-end" | "corridor" | "junction" {
  if (exitCount <= 1) {
    return "dead-end"
  }
  return exitCount === 2 ? "corridor" : "junction"
}

// resolvedOpenMoves maps each of an entry's open exits to its neighboring cell (using the same
// row/col deltas mazeStructureTool documents) and whether that neighbor is already visited, using
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

// suggestedMovesPerTurn is the prediction-size hint; the configured Manhattan distance is its
// ceiling, ensuring move batches never outgrow the local context window the model can inspect.
// The navigation profile's max corridor length comes from maze generation; the cap keeps that
// generation-derived value within the observed practical range for prediction batches.
// Never 0: a zero suggestion reads as "batch nothing", which no playable round intends. Dimensions
// should exist while running, so the fallback only protects unreachable or malformed state.
function suggestedMovesPerTurn(state: State): number {
  const distance = runtime.modelConfig.manhattanDistance
  return state.mazeDimensions
    ? Math.min(getNavigationProfile(state.mazeDimensions).__maxCorridorLength, distance)
    : distance
}

// isWithinManhattanDistance checks whether a logical cell belongs inside the local context window.
function isWithinManhattanDistance(
  first: CellCoordinate,
  second: CellCoordinate,
  manhattanDistance: number,
): boolean {
  return (Math.abs(first.row - second.row) + Math.abs(first.col - second.col)) <= manhattanDistance
}

// buildAgentToolHandlers binds the latest state snapshot to the context tools for this request.
export function buildAgentToolHandlers(
  state: State,
  lastActionResult: MazeActionResult | null,
  agent: AgentApiConfig,
): AgentToolHandlers {
  return {
    get_prediction_rules() {
      // Raw counts are exposed instead of the derived rate so the model can compute and verify the
      // classification itself; all are always concrete numbers (0 is a valid count), never null, so
      // there is nothing ambiguous for the model to puzzle over before its first request.
      const batchEfficiencyClass = resolveBatchEfficiencyClass(state.traversalHistory, agent)
      const { playerUniqueCellsVisited, allUniqueCellsVisited, decayUnitsCharged, playerTurnsTaken } =
        getBatchEfficiencyMetrics(state.traversalHistory, agent)
      return {
        suggestedMovesPerTurn: suggestedMovesPerTurn(state),
        playerUniqueCellsVisited,
        allUniqueCellsVisited,
        decayUnitsCharged,
        totalTurnCount: state.turnCount,
        playerTurnsTaken,
        batchEfficiencyClass,
        mazeDimensions: state.mazeDimensions
          ? {
              numCols: state.mazeDimensions.numCols,
              numRows: state.mazeDimensions.numRows,
              totalMazeCells: state.mazeDimensions.area,
            }
          : null,
        expectedResponseSchema: EXPECTED_RESPONSE_SCHEMA,
      }
    },
    get_maze_structure() {
      const currentCell = state.playerPosition ? cellCoordinateFromGridPoint(state.playerPosition) : null
      const destinationCell = state.finalPosition ? cellCoordinateFromGridPoint(state.finalPosition) : null
      // Named historyWindowRadius on the wire (not manhattanDistance) even though it comes from
      // runtime.modelConfig.manhattanDistance: sitting beside currentCell/destinationCell under the
      // name "manhattanDistance" reads as the live distance between them, which it is not — it's a
      // fixed configured radius. A model that computes the real distance itself and finds this
      // field disagreeing has no way to know it isn't supposed to match, and can burn real
      // reasoning trying to reconcile the two.
      const historyWindowRadius = runtime.modelConfig.manhattanDistance
      const history = cloneTraversalHistory(state.traversalHistory)
      const visitedCellKeys = new Set(history.map((entry) => mazeCellKey(entry)))
      const filteredHistory = currentCell
        ? history.filter((entry) => isWithinManhattanDistance(entry, currentCell, historyWindowRadius))
        : []

      return {
        level: state.level,
        currentCell,
        destinationCell,
        historyWindowRadius,
        filteredTraversalHistory: filteredHistory.map((entry) => ({
          playerName: entry.playerName,
          cell: { row: entry.row, col: entry.col },
          type: classifyCellType(entry.openMoves.length),
          openMoves: resolvedOpenMoves(entry, visitedCellKeys),
        })),
      }
    },
    get_last_prediction_outcome() {
      return {
        status: state.status,
        score: state.score,
        lastPlayerName: lastActionResult?.lastPlayerName ?? null,
        lastMoveStatus: lastActionResult?.lastMoveStatus ?? null,
        predictionStatus: lastActionResult?.predictionStatus ?? null,
        lastReplayStartIndex: lastActionResult?.lastReplayStartIndex ?? null,
        lastSubmittedMoves: lastActionResult?.lastSubmittedMoves ?? [],
        lastAppliedMoveIndex: lastActionResult?.lastAppliedMoveIndex ?? null,
        visitedBefore: lastActionResult?.visitedBefore ?? null,
        chargedMovesCount: lastActionResult?.chargedMovesCount ?? 0,
      }
    },
  }
}
