import { AGENT_MOVES_PER_TURN_CAP, CONFIG } from "../config"
import { getNavigationProfile } from "../maze"
import {
  MOVE_ACTIONS,
  cellCoordinateFromGridPoint,
  cloneTraversalHistory,
} from "../traversal"
import type {
  AgentExpectedResponseSchema,
  AgentSubmittedMovesSchema,
  MazeActionResult,
  State,
} from "../types"
import type {
  AgentChatMessage,
  AgentToolDefinition,
  AgentToolHandlers,
} from "./request"

const { runtime } = CONFIG

// --- Shared constants ---
// These are referenced by both the message builders and the tool layer below.

// EXPECTED_RESPONSE_SCHEMA documents the exact JSON shape returned by prediction sources.
export const EXPECTED_RESPONSE_SCHEMA: AgentExpectedResponseSchema = {
  type: "object",
  description: "The only accepted response format. Return this exact JSON object with no surrounding text or markdown fences.",
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

// buildMazeActionPrompt keeps request guidance compact while naming the active player.
export function buildMazeActionPrompt(playerName: string): string {
  return [
    `Your name is ${playerName}. playerName ${runtime.interactivePlayerName} always appears first in traversalHistory and marks the start cell.`,
    "currentCell is your current position; destinationCell is the target.",
    "The maze is randomly generated at each level with exactly one path to the destination.",
    "traversalHistory entries matching your playerName record your past moves in chronological order.",
    "Each entry includes openMoves — the exits that were open from that cell.",
    "openMoves count reveals cell topology: one open move is a dead end (unless that is where you came from); two is a corridor; three or more is a junction.",
    "Revisiting a cell already in traversalHistory is only valid when every other exit from the current cell leads to already-visited cells.",
    "By design, the maze never guarantees a direct route from start to destination; the only valid path may require moving away from the target before turning towards it.",
    "Tool results reflect the maze state at the time of each call — a repeat call may return updated or identical data depending on what has changed.",
    "get_last_replay_result reflects the most recent replay across all agents; lastPlayerName identifies whose outcome it is.",
    "lastMoveStatus null means no moves have been made yet; invalid-move means the last prediction hit a wall; malformed-response means",
    "the previous response was not valid JSON and a score penalty was charged; applied means it succeeded.",
    "get_prediction_rules provides the required response format and move count guidance.",
    "Moves replay in order until the destination or the first invalid move (a wall collision or out-of-bounds step).",
    "Every move in your response counts toward score decay, including moves after the first invalid move.",
    "lastMoveStatus reached-target or status won means the game is complete — stop predicting.",
    "Score decay charges every submitted move, so fewer correct moves preserve more score.",
  ].join(" ")
}

// buildAgentMessages separates durable behavior instructions from the current turn request.
export function buildAgentMessages(playerName: string): AgentChatMessage[] {
  return [
    {
      role: "system",
      content: buildMazeActionPrompt(playerName),
    },
    {
      role: "user",
      content: `It is ${playerName}'s turn to predict Tapoo maze moves. Use the available tools to inspect the current maze state.`,
    },
  ]
}

// --- 2. Tool definitions ---
// Tool definitions are sent alongside messages so the model knows what it can call.
// Tool return formats are documented in descriptions because `parameters` only describes inputs.

const emptyToolParameters: AgentToolDefinition["function"]["parameters"] = {
  type: "object",
  properties: {},
  required: [],
}

// gameStatusTool exposes round progress and maze dimensions without leaking full state.
const gameStatusTool: AgentToolDefinition = {
  type: "function",
  function: {
    name: "get_game_status",
    description:
      "Get current Tapoo level, status, score, and maze dimensions. status is one of: running (prediction active), won (destination reached, stop predicting), lost, await-agent, or paused. Returns JSON: {\"level\":number,\"status\":string,\"score\":number,\"mazeDimensions\":{\"length\":number,\"width\":number,\"area\":number}}. length is the number of columns, width is the number of rows, area is the total cell count.",
    parameters: emptyToolParameters,
  },
}

// mazePositionsTool gives agents their current location and destination in one call.
const mazePositionsTool: AgentToolDefinition = {
  type: "function",
  function: {
    name: "get_maze_positions",
    description:
      "Get current cell and destination cell. Row increases going down, col increases going right; MoveUp and MoveDown change row by ±1; MoveLeft and MoveRight change col by ±1. Use get_traversal_history to find which moves are open from the current cell. Returns JSON: {\"currentCell\":{\"row\":number,\"col\":number}|null,\"destinationCell\":{\"row\":number,\"col\":number}|null}.",
    parameters: emptyToolParameters,
  },
}

// traversalHistoryTool lets agents avoid repeating explored logical cells across turns.
// Each entry includes openMoves so the model can reconstruct dead ends and junction topology.
const traversalHistoryTool: AgentToolDefinition = {
  type: "function",
  function: {
    name: "get_traversal_history",
    description:
      "Get all players' visit records in chronological order. Each entry includes openMoves — the open exits from that cell — so you can reconstruct the maze topology you have already explored. Returns JSON: {\"traversalHistory\":[{\"playerName\":string,\"row\":number,\"col\":number,\"openMoves\":[\"MoveLeft\",...]}]}. Filter by playerName to review a specific player's visit sequence.",
    parameters: emptyToolParameters,
  },
}

// lastReplayResultTool reports the previous replay outcome so agents can correct course.
const lastReplayResultTool: AgentToolDefinition = {
  type: "function",
  function: {
    name: "get_last_replay_result",
    description:
      "Get the previous turn replay result. lastMoveStatus values: null=first turn, no history yet; applied=move executed and added to traversal history; reached-target=destination reached, stop predicting; invalid-move=move hit a wall or boundary, replay stopped; malformed-response=previous response was not valid JSON, no moves were replayed and a fixed score penalty was charged; network-error=HTTP failure, no score charged. lastSubmittedMoves lists the moves from that turn as zero-based <index>:<move> entries; lastReplayStartIndex is their zero-based offset in the overall submitted move sequence. lastAppliedMoveIndex is the index within lastSubmittedMoves of the last successfully applied move — moves after it were not executed. visitedBefore indicates whether the cell entered by the last valid move was already in traversal history. chargedMovesCount is the total moves charged toward score decay that turn. Returns JSON: {\"lastPlayerName\":string|null,\"lastMoveStatus\":string|null,\"lastReplayStartIndex\":number|null,\"lastSubmittedMoves\":string[],\"lastAppliedMoveIndex\":number|null,\"visitedBefore\":boolean|null,\"chargedMovesCount\":number}.",
    parameters: emptyToolParameters,
  },
}

// predictionRulesTool documents the only accepted move response and the suggested batch size.
const predictionRulesTool: AgentToolDefinition = {
  type: "function",
  function: {
    name: "get_prediction_rules",
    description:
      "Get move response rules. suggestedMovesPerTurn is the suggested maximum moves to include in your response per turn, scaled to maze size; returning fewer moves on early turns limits wasted score if your predicted moves turn out to be wrong. Returns JSON: {\"suggestedMovesPerTurn\":number,\"expectedResponseSchema\":object}.",
    parameters: emptyToolParameters,
  },
}

// AGENT_CONTEXT_TOOLS exposes focused context slices instead of one oversized state object.
export const AGENT_CONTEXT_TOOLS: AgentToolDefinition[] = [
  gameStatusTool,
  mazePositionsTool,
  traversalHistoryTool,
  lastReplayResultTool,
  predictionRulesTool,
]

// --- 3. Tool handlers ---
// Handlers execute when the model calls a tool and produce the tool result messages.

// buildAgentToolHandlers binds the latest state snapshot to the context tools for this request.
export function buildAgentToolHandlers(
  state: State,
  lastActionResult: MazeActionResult | null,
): AgentToolHandlers {
  // The hard corridor limit governs DFS maze carving, not player path planning.
  // AGENT_MOVES_PER_TURN_CAP (p95 of actual run lengths) is the tighter bound for predictions.
  const suggestedMovesPerTurn = state.mazeDimensions
    ? Math.min(getNavigationProfile(state.mazeDimensions).__hardCorridorLimit, AGENT_MOVES_PER_TURN_CAP)
    : 0

  return {
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
      return {
        traversalHistory: cloneTraversalHistory(state.traversalHistory),
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
    get_prediction_rules() {
      return {
        suggestedMovesPerTurn,
        expectedResponseSchema: EXPECTED_RESPONSE_SCHEMA,
      }
    },
  }
}
