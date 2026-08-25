import { CONFIG } from "../config"
import {
  MOVE_ACTIONS,
  MOVE_DELTAS,
  cellCoordinateFromGridPoint,
  mazeCellKey,
} from "../traversal"
import {
  getBatchEfficiencyMetrics,
  resolveBatchEfficiencyClass,
} from "./efficiency"
import type { BatchEfficiencyClass } from "./efficiency"
import type { AgentStateSnapshot } from "./state-snapshot"
import type {
  AgentChatMessage,
  AgentApiSeatConfig,
  AgentExpectedResponseSchema,
  AgentSubmittedMovesSchema,
  AgentToolCall,
  AgentToolDefinition,
  AgentToolHandlers,
  CellCoordinate,
  MazeActionResult,
  MazeCellType,
  TraversalHistoryEntry,
  VisitStatus,
} from "../types"

const { runtime, scoring, timing } = CONFIG
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

// SUBMITTED_MOVES_SCHEMA documents the zero-based submitted-move entries returned after processing a turn.
export const SUBMITTED_MOVES_SCHEMA: AgentSubmittedMovesSchema = {
  type: "array",
  description: "Zero-based submitted-move entries formatted as <index>:<move>.",
  items: {
    type: "string",
    pattern: "^(0|[1-9][0-9]*):(MoveUp|MoveDown|MoveLeft|MoveRight)$",
    examples: ["0:MoveRight", "1:MoveUp", "2:MoveRight"],
  },
}

// --- 1. Messages ---
// System and user messages are the first content the model receives each turn.

// describeAgentSpeedClassification states the agent's current traversal-speed classification as a
// factual diagnosis, not motivational pressure. Trailblazer is evidence of forward deduction into
// unvisited structure; lower classes can be the structural ceiling for conservative play.
export function describeAgentSpeedClassification(
  playerName: string,
  speedClass: BatchEfficiencyClass,
): string {
  if (speedClass === "trailblazer") {
    return [
      `You are ${playerName} and your traversal speed classifies as trailblazer.`,
      "That means your previous predictions created more than one new-cell visit per decay unit,",
      "which requires forward deduction into unexplored structure.",
    ].join(" ")
  }

  return [
    `You are ${playerName} and your traversal speed currently classifies as ${speedClass}.`,
    "Conservative play and retrace-only batching can be structurally capped below trailblazer;",
    "exceeding 1.0 requires forward batching into unvisited cells.",
  ].join(" ")
}

// buildMazeActionPrompt keeps request guidance compact while naming the active player.
export function buildMazeActionPrompt(playerName: string, batchEfficiencyClass: BatchEfficiencyClass): string {
  const partialInvalidTurnCost = agentBaseDecayUnits + agentPartialInvalidPenaltyDecayUnits
  return [
    describeAgentSpeedClassification(playerName, batchEfficiencyClass),
    "Call every available tool once on each turn before returning moves. Start with get_maze_structure to read",
    "currentCell, destinationCell, and nearby maze structure; call get_prediction_rules for the required response",
    "format, suggested move count, mazeDimensions, and traversal-speed metrics; call get_last_prediction_outcome for",
    "current status, score, and the previous prediction outcome.",
    "The maze is randomly generated at the start of each level with exactly one path to the destination. For the",
    "current level, maze dimensions and wall/open-exit structure are fixed once generated. When present in",
    `filteredTraversalHistory, playerName ${runtime.interactivePlayerName} marks the start cell. Use openMoves from`,
    "filteredTraversalHistory entries to build a local map; entries recorded by other players are just as trustworthy",
    "as your own. currentCell is the position you landed on after applying the valid moves from the previous turn;",
    "at the start of each level, currentCell matches the start-cell.",
    "Your primary objective is to reach destinationCell, the level's fixed target position, with the highest traversal",
    "speed. cellType start-cell and target-cell label the start and destination cells respectively. Every openMoves",
    "entry is a candidate direction and includes the reached cell's visitStatus as guidance for choosing that move:",
    "unvisited means new ground, explored means already reached but still holding unused exits, backtracking means all",
    "exits have been used, and oscillating means the cell has been over-visited. Each turn, prefer an unvisited",
    "neighbor of currentCell before weighing distance to destinationCell; when none is adjacent, move through explored",
    "neighbors to reach one. Treat moves into cells whose visitStatus is backtracking or oscillating as the exhausted",
    "dead-end region to move away from; moves into cells with explored or unvisited status point back toward useful search.",
    "Retreat cues are cells reached by openMoves whose visitStatus is backtracking or oscillating. A dead-end cell is set to",
    "backtracking visitStatus on first visit, then oscillating if revisited again. During deliberate retreat,",
    "revisiting a cell already in filteredTraversalHistory is not a mistake, although it adds no new-cell progress.",
    "Once a retreat cue appears, use filteredTraversalHistory to search earlier visited cells for an unexplored branch",
    "point, maybe within or beyond historyWindowRadius, so keep retreating through explored cells until a",
    "later turn's filteredTraversalHistory brings it into view.",
    "When judging whether one candidate cell is closer to destinationCell than another, compare the full combined",
    "row and col differences for each candidate, not just one axis — a cell closer on one axis can be equally far or",
    "farther away overall once the other axis is considered. By design, the maze never guarantees a direct route from",
    "start to destination; the only valid path may require moving away from the target before turning towards it.",
    "Use lastMoveStatus to understand the outcome and chargedMovesCount for the exact score-decay impact from that",
    "outcome.",
    `A turn with any valid moves costs a constant ${agentBaseDecayUnits}-unit decay charge regardless of how many submitted`,
    `moves apply. If replay then reaches an invalid move, that adds a ${agentPartialInvalidPenaltyDecayUnits}-unit penalty,`,
    `for a total charge of ${partialInvalidTurnCost}. If the very first submitted move is already invalid — no progress`,
    `at all — the turn instead costs a flat ${agentZeroProgressPenaltyDecayUnits}-unit decay charge. A malformed response`,
    `(invalid JSON, an unknown tool request, or ignoring a warning) costs a fixed ${agentMalformedPenaltyDecayUnits}`,
    `decay units with no moves applied — the costliest outcome of all.`,
    "One way to sustain a traversal speed above 1.0, keeping your classification at trailblazer, is to build a",
    "picture of the maze around your current cell using filteredTraversalHistory and the static maze dimensions.",
    "The openMoves in the filteredTraversalHistory entry matching currentCell are a natural place to start when",
    "extracting high-confidence multi-move predictions.",
    "With enough of that picture assembled, you can often find several consecutive moves that are all certain to",
    "apply without producing an invalid-move. You could also invent a better way to sustain that classification.",
    "get_prediction_rules provides the required response format and move count guidance. Submitted moves execute in",
    "order until the destination is reached or the first invalid move (a wall collision or out-of-bounds step) is hit.",
    "Because the charge above is per turn rather than per move, a longer prediction whose moves all land can cover more",
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
// uncalled, and the model remains free to request those. It is explicitly labeled with the
// configured warning prefix and uses the same warning terminology as lastPredictionOutcomeTool's malformed-response
// explanation, so a model that ignores it can tie the resulting penalty back to this message.
// describeToolCall renders each call as "name (id)", falling back to placeholders for the rare
// case a provider omits either field.
export function buildDuplicateToolCallMessage(duplicateToolCalls: AgentToolCall[]): AgentChatMessage {
  const describeToolCall = (toolCall: AgentToolCall) =>
    `${toolCall.function?.name ?? "unknown"} (${toolCall.id ?? "no id"})`

  return {
    role: "user",
    content:
      `${CONFIG.runtime.promptWarningPrefix} ${duplicateToolCalls.map(describeToolCall).join(", ")} won't yield any new information. ` +
      "You may still call any tools you haven't used yet, or respond now with only the moves JSON. Requesting " +
      "these tool call(s) once again will be treated as a malformed-response.",
  }
}

// buildTokenLimitExhaustionPrompt gives a capped-empty response one free corrective retry — only a
// repeat failure after this warning charges a penalty, matching lastPredictionOutcomeTool's
// "the same fixed score penalty was charged" description of that outcome. Named explicitly, the
// same way buildDuplicateToolCallMessage names its own consequence, rather than leaving the model to
// discover the cost only after incurring it. Keeping the complete user message here alongside the
// other model-facing context prevents controller policy code from owning prompt wording.
export function buildTokenLimitExhaustionPrompt(tokensUsage: number): AgentChatMessage {
  return {
    role: "user",
    content:
      `${CONFIG.runtime.promptWarningPrefix} Your previous response had a token-limit-exhaustion error and used ${tokensUsage} `+
      "tokens without returning a prediction. Try once more to return the correct prediction format output without overthinking. "+
      "This retry is free, but on reaching the token limit again without a prediction you will be charged the same fixed penalty " +
      "as a malformed response.",
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
      "by 1 and MoveRight increases it by 1. currentCell is the position you landed on after applying the valid moves",
      "from the previous turn. filteredTraversalHistory includes only first-visit records within",
      "historyWindowRadius of currentCell, ordered oldest-visited to most-recently-visited — currentCell's own",
      "position in this list depends on when it was first visited, not on it being current, so it will not always",
      "be last. Entries added before currentCell in this list were visited earlier; entries after it were visited more",
      "recently. If currentCell is not last, every listed entry after it is a cell first reached after currentCell but",
      "before now, so the entry itself is charted ground. However, any move under that entry's openMoves that leads",
      "to a cell with visitStatus unvisited still points at unexplored ground and remains a valid branch target.",
      "currentCell is always included because its distance is 0. historyWindowRadius is a fixed configured radius — the",
      "maximum Manhattan distance a visited cell in filteredTraversalHistory can be from currentCell — unrelated to how",
      "far destinationCell is; compute that yourself from currentCell and destinationCell's row/col if you need it.",
      "Each included entry's openMoves maps every fixed open exit from that cell to the neighboring cell reached",
      "by that move. openMoves are generated once and never change with visit counts. visitStatus gives direction",
      "choice guidance for that move and is derived from the reached cell's visit count compared with its fixed open-exit count:",
      "unvisited means zero visits and new ground to explore; explored means visited, but still with unused exits that",
      "can lead to new ground; backtracking means all exits have been used and this direction cannot lead to the",
      "destination, so do not choose it; oscillating means the cell has been visited more often than its exit count — a",
      "confirmed waste signal from crossing back into exhausted ground.",
      "An exit counts as used once it has served as the passage into that cell.",
      "A dead-end reads as backtracking from its first visit, because nothing lies beyond a single exit.",
      "cellType is precomputed so you never need to count exits yourself: start-cell (the traversal start), target-cell",
      "(the destination), dead-end (one exit), corridor (two exits), or junction (three or more). cellType and",
      "visitStatus answer different questions and are meant to be read together: cellType is the cell's fixed structure,",
      "visitStatus tells whether choosing the move toward that cell is useful for progress. start-cell and target-cell are special cells, not ordinary dead ends.",
      "cellType is only set for a cell already in filteredTraversalHistory — an unvisited cell, including one that only",
      "appears as a neighbor inside another cell's openMoves, has no known cellType and must never be assumed to be of",
      "a specific cellType before visiting. The only way to learn an unvisited cell's own structure is to move there",
      "and read its own entry on a later turn.",
      "currentCell or destinationCell being null means the game state is invalid or incomplete for planning, not a",
      "normal maze situation.",
      "Returns JSON: {\"level\":number, \"currentCell\":{\"row\":number, \"col\":number}|null,",
      "\"destinationCell\":{\"row\":number, \"col\":number}|null, \"historyWindowRadius\":number,",
      "\"filteredTraversalHistory\":[{\"playerName\":string, \"cell\":{\"row\":number, \"col\":number},",
      "\"cellType\":string, \"openMoves\":{\"MoveLeft\":{\"row\":number, \"col\":number, \"visitStatus\":string}, ...}}]}.",
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
      "Get move response rules. suggestedMovesPerTurn is a min/max range for how many moves to include in your",
      "prediction response per turn: submit min moves when you are only confident about the immediate next cell or two,",
      "and go up to max only when the local map supports a longer high-confidence run. Batching accuracy drops sharply the",
      "further out a prediction reaches, so lean toward min rather than max whenever you are unsure.",
      "When decayUnitsCharged is greater than 0, playerUniqueCellsVisited divided by decayUnitsCharged is your current",
      "traversal speed, the progress per decay unit spent — a scale grouped by batchEfficiencyClass. When",
      "decayUnitsCharged is 0, batchEfficiencyClass defaults to trailblazer. Only a cell's first visit",
      "counts as progress. Higher traversal speed means more progress per decay unit, increasing the chance of reaching",
      "the target before score runs out.",
      "batchEfficiencyClass is set to backtracker when the speed is below 1.0000, navigator at 1.0000, or trailblazer above 1.0000.",
      "Backtracker is a live game metric rating prediction efficiency class, while get_maze_structure's",
      "backtracking visitStatus marks one cell as a spent direction. The two are independent: a player can classify as",
      "backtracker without ever entering a backtracking cell, and crossing such cells costs no decay beyond the turn's",
      "own charge. Retrace-only batching can save turns but cannot",
      "create new-cell progress, so trailblazer is evidence that forward prediction into unvisited cells succeeded.",
      "allUniqueCellsVisited is every cell any player has reached this level, not just your own — compare it",
      "against mazeDimensions.totalMazeCells to know how much of the maze the team has collectively explored so far;",
      "it does not affect your traversal speed, which is scored on playerUniqueCellsVisited against decayUnitsCharged.",
      "At the initial game levels the single solution path covers nearly all of totalMazeCells, so expect to explore most",
      "of the maze before reaching the destination. At higher levels, the destination can be reachable well before",
      "allUniqueCellsVisited approaches totalMazeCells. totalTurnCount is the total number of completed prediction",
      "turns in this game level. playerTurnsTaken is the number completed by the player and is reported for context;",
      "neither count affects your speed, classification, or scores. The resulting score is visible via",
      "get_last_prediction_outcome. mazeDimensions.totalMazeCells is the full level size. mazeDimensions being null means",
      "the game state is invalid or incomplete for planning.",
      "Returns JSON:",
      "{\"suggestedMovesPerTurn\":{\"min\":number,\"max\":number}, \"allUniqueCellsVisited\":number, \"playerUniqueCellsVisited\":number,",
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
      "Get the outcome of the previous prediction attempt: whether its moves fully applied, partially failed, reached the",
      "target, or were rejected. status is the current game status, score is the current score after that outcome.",
      "decayUnitsRemaining is the current maximum number of decay units the player can spend, starting with this turn,",
      "to find the target. If the final unit is spent without reaching the target, the score becomes 0 and the level is",
      "lost; reaching the target with that unit wins with a score of 0.",
      "When moves were replayed, lastMoveStatus is the outcome of the last executed move in the previous prediction:",
      "null=first turn, no previous outcome yet; applied=the last executed move succeeded; invalid-move=the last executed",
      "move hit a wall or boundary and replay stopped there; reached-target=destination reached, stop predicting.",
      "When no moves were replayed, lastMoveStatus explains why: malformed-response=previous response was not valid JSON,",
      "requested a tool that does not exist, or ignored a warning, resulting in zero progress and a fixed score penalty.",
      `A warning is a user message beginning with "${CONFIG.runtime.promptWarningPrefix}";`,
      "token-limit-exhaustion=the previous empty prediction reached the configured token threshold and its corrective warning opportunity",
      "also returned no prediction — no moves were replayed and the same fixed score penalty was charged; network-error=HTTP",
      "failure, no score charged.",
      "predictionStatus summarizes the outcome of the entire prediction submitted in the last turn as one story:",
      "all-applied=all submitted moves applied and at least one entered a previously unvisited cell, or the target was",
      "reached; partially-applied=one or more moves applied, at least one entered a previously unvisited cell, and replay",
      "then stopped at the first invalid move; repeat-cell-visits=one or more moves applied, but none entered a new cell — replay",
      "may have completed or stopped at an invalid move; invalid-prediction=a real",
      "prediction was replayed but the very first submitted move was already invalid, no progress made;",
      "empty-prediction=a malformed-response, token-limit-exhaustion, or network-error meant there was no usable",
      "prediction to replay at all.",
      "lastSubmittedMoves lists every submitted move from that turn as a zero-based <index>:<move> entry, including moves",
      "after the first invalid move that were not executed. lastReplayStartIndex is 0 when moves were submitted and marks",
      "the first replayed submitted-move index. lastAppliedMoveIndex is the index within lastSubmittedMoves of the last successfully",
      "applied move — moves after it were not executed. On an empty-prediction turn these three fields are always reset to null/empty,",
      "matching that no moves were replayed — they never carry over stale data from an earlier turn.",
      "chargedMovesCount is the total decay units charged toward score that turn.",
      "Returns JSON: {\"status\":string, \"score\":number, \"decayUnitsRemaining\":number,",
      "\"lastMoveStatus\":string|null, \"predictionStatus\":string|null,",
      "\"lastReplayStartIndex\":number|null, \"lastSubmittedMoves\":string[], \"lastAppliedMoveIndex\":number|null,",
      "\"chargedMovesCount\":number}.",
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
function classifyCellType(
  start: CellCoordinate | null,
  target: CellCoordinate | null,
  entry: TraversalHistoryEntry,
): MazeCellType {
  if (start && entry.row === start.row && entry.col === start.col) {
    return "start-cell"
  }
  if (target && entry.row === target.row && entry.col === target.col) {
    return "target-cell"
  }

  const exitCount = entry.openMoves.length
  if (exitCount <= 1) {
    return "dead-end"
  }
  return exitCount === 2 ? "corridor" : "junction"
}

// cellVisitStatus answers "what should I do about this cell next?" rather than the weaker "has anyone
// been here". It is the model-facing preprocessing of TraversalHistoryEntry.visitCount, which is never
// exposed itself: handing over the raw tally would invite the model to re-derive this threshold and
// get it wrong, when the decision is the only part it needs.
//
// A cell with N open exits still has an unused way out while visits < N, so:
//   unvisited    — never reached; this direction immediately enters new ground.
//   explored     — reached, but at least one exit is still unused; this direction can lead back to
//                  the frontier where forward exploration resumes.
//   backtracking — visited exactly as many times as it has exits; this direction is exhausted,
//                  cannot lead to the destination, and should not be chosen.
//   oscillating  — visited more often than it has exits; the player crossed back into exhausted
//                  ground and is wasting limited moves instead of progressing toward the destination.
export function cellVisitStatus(entry: TraversalHistoryEntry | undefined): VisitStatus {
  if (!entry) {
    return "unvisited"
  }

  if (entry.visitCount < entry.openMoves.length) {
    return "explored"
  }

  return entry.visitCount === entry.openMoves.length ? "backtracking" : "oscillating"
}

// resolvedOpenMoves maps each open exit to the adjacent logical cell it reaches. openMoves are fixed
// when the maze is generated and never change during the round; only the derived visitStatus changes
// as visits accumulate. Each recorded cell owns its visitCount, and the move only tells us which
// adjacent cell to look up. The precomputed map keeps those lookups O(1) and saves the model from
// re-deriving adjacency through row/col arithmetic.
function resolvedOpenMoves(
  entry: TraversalHistoryEntry,
  visitedCellEntries: Map<string, TraversalHistoryEntry>,
): Record<string, CellCoordinate & { visitStatus: VisitStatus }> {
  return Object.fromEntries(
    entry.openMoves.map((move) => {
      const [rowDelta, colDelta] = MOVE_DELTAS[move]
      const neighbor = { row: entry.row + rowDelta, col: entry.col + colDelta }
      return [
        move,
        { ...neighbor, visitStatus: cellVisitStatus(visitedCellEntries.get(mazeCellKey(neighbor))) },
      ]
    }),
  )
}

// isWithinManhattanDistance checks whether a logical cell belongs inside the local context window.
function isWithinManhattanDistance(
  first: CellCoordinate,
  second: CellCoordinate,
  manhattanDistance: number,
): boolean {
  return (Math.abs(first.row - second.row) + Math.abs(first.col - second.col)) <= manhattanDistance
}

// buildAgentToolHandlers binds an already-frozen state snapshot (see snapshotAgentState,
// agent/state-snapshot.ts — also used for turn logging elsewhere, not tool-specific despite the
// name of this function) to the context tools for this request. Takes the snapshot itself, not
// State, so it never has to decide when to (re)read live state — that decision belongs to the caller.
export function buildAgentToolHandlers(
  snapshot: AgentStateSnapshot,
  lastActionResult: MazeActionResult | null,
  agent: AgentApiSeatConfig,
): AgentToolHandlers {
  return {
    get_prediction_rules() {
      // Raw counts are exposed instead of the derived rate so the model can compute and verify the
      // classification itself; all are always concrete numbers (0 is a valid count), never null, so
      // there is nothing ambiguous for the model to puzzle over before its first request.
      const batchEfficiencyClass = resolveBatchEfficiencyClass(snapshot.traversalHistory, agent)
      const { playerUniqueCellsVisited, allUniqueCellsVisited, decayUnitsCharged, playerTurnsTaken } =
        getBatchEfficiencyMetrics(snapshot.traversalHistory, agent)
      return {
        suggestedMovesPerTurn: runtime.modelConfig.suggestedMovesPerTurnRange,
        allUniqueCellsVisited,
        playerUniqueCellsVisited,
        decayUnitsCharged,
        totalTurnCount: snapshot.turnCount,
        playerTurnsTaken,
        batchEfficiencyClass,
        mazeDimensions: snapshot.mazeDimensions
          ? {
              numCols: snapshot.mazeDimensions.numCols,
              numRows: snapshot.mazeDimensions.numRows,
              totalMazeCells: snapshot.mazeDimensions.area,
            }
          : null,
        expectedResponseSchema: EXPECTED_RESPONSE_SCHEMA,
      }
    },
    get_maze_structure() {
      const startCell = snapshot.startPosition ? cellCoordinateFromGridPoint(snapshot.startPosition) : null
      const currentCell = snapshot.playerPosition ? cellCoordinateFromGridPoint(snapshot.playerPosition) : null
      const destinationCell = snapshot.finalPosition ? cellCoordinateFromGridPoint(snapshot.finalPosition) : null
      // Named historyWindowRadius on the wire (not manhattanDistance) even though it comes from
      // runtime.modelConfig.manhattanDistance: sitting beside currentCell/destinationCell under the
      // name "manhattanDistance" reads as the live distance between them, which it is not — it's a
      // fixed configured radius. A model that computes the real distance itself and finds this
      // field disagreeing has no way to know it isn't supposed to match, and can burn real
      // reasoning trying to reconcile the two.
      const historyWindowRadius = runtime.modelConfig.manhattanDistance
      // Keyed by cell rather than a bare membership set: resolvedOpenMoves needs each neighbor's own
      // entry (its visitCount and exit count) to derive visitStatus, not just whether one exists.
      const visitedCellEntries = new Map(snapshot.traversalHistory.map((entry) => [mazeCellKey(entry), entry] as const))
      const filteredHistory = currentCell
        ? snapshot.traversalHistory.filter((entry) => isWithinManhattanDistance(entry, currentCell, historyWindowRadius))
        : []

      return {
        level: snapshot.level,
        currentCell,
        destinationCell,
        historyWindowRadius,
        filteredTraversalHistory: filteredHistory.map((entry) => ({
          playerName: entry.playerName,
          cell: { row: entry.row, col: entry.col },
          cellType: classifyCellType(startCell, destinationCell, entry),
          openMoves: resolvedOpenMoves(entry, visitedCellEntries),
        })),
      }
    },
    get_last_prediction_outcome() {
      return {
        status: snapshot.status,
        score: snapshot.score,
        decayUnitsRemaining: Math.max(0, Math.ceil(snapshot.score / timing.scoreDecayRate)),
        lastMoveStatus: lastActionResult?.lastMoveStatus ?? null,
        predictionStatus: lastActionResult?.predictionStatus ?? null,
        lastReplayStartIndex: lastActionResult?.lastReplayStartIndex ?? null,
        lastSubmittedMoves: lastActionResult?.lastSubmittedMoves ?? [],
        lastAppliedMoveIndex: lastActionResult?.lastAppliedMoveIndex ?? null,
        chargedMovesCount: lastActionResult?.chargedMovesCount ?? 0,
      }
    },
  }
}
