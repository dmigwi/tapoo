import { CONFIG } from "../config"
import { getNavigationProfile } from "../maze"
import {
  cellCoordinateFromGridPoint,
  cloneTraversalHistory,
} from "../traversal"
import type {
  AgentExpectedResponseSchema,
  AgentSubmittedMovesSchema,
  MazeActionResult,
  MoveAction,
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

// ALLOWED_MOVE_ACTIONS enumerates the only traversal commands accepted from prediction sources.
export const ALLOWED_MOVE_ACTIONS: MoveAction[] = ["MoveUp", "MoveDown", "MoveLeft", "MoveRight"]

// EXPECTED_RESPONSE_SCHEMA documents the exact JSON shape returned by prediction sources.
export const EXPECTED_RESPONSE_SCHEMA: AgentExpectedResponseSchema = {
  description: "The only accepted response format. Return this exact JSON object with no surrounding text or markdown fences.",
  type: "object",
  additionalProperties: false,
  required: ["moves"],
  properties: {
    moves: {
      type: "array",
      minItems: 1,
      items: {
        type: "string",
        enum: [...ALLOWED_MOVE_ACTIONS],
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

// buildMazeActionPrompt keeps request guidance compact while naming the active player.
export function buildMazeActionPrompt(playerName: string): string {
  return [
    `Your name is ${playerName}. playerName ${runtime.interactivePlayerName} always appears first in traversalHistory and`,
    "marks the start cell. Use currentCell as your current position and destinationCell as the target.",
    "The maze is randomly generated at each level with exactly one path to the destination.",
    "Use traversalHistory entries matching your playerName to review your past moves in order.",
    "By design, the maze never guarantees a direct route from start to destination; the only valid path may require",
    "moving away from the target before turning towards it — never assume moves toward the destination are passable.",
    "Tool results reflect the maze state at the time of each call — a repeat call may return updated or identical data depending on what has changed.",
    "Prefer unvisited cells over revisiting known ones, and calibrate how many moves you submit",
    "against your own last replay outcome from get_last_replay_result: null or invalid-move signals high uncertainty",
    "so submit fewer moves; applied signals confirmed progress so you may extend your move sequence.",
    "Call get_prediction_rules to get the required response format and submission constraints before predicting moves.",
    "Moves replay in order until the destination or the first invalid move (a wall collision or out-of-bounds step).",
    "Every submitted move counts toward score decay, including moves after the first invalid move.",
    "Stop predicting when lastMoveStatus is reached-target or status is won.",
    "Choose the moves most likely to reach the destination with the fewest submitted moves.",
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
  additionalProperties: false,
  // properties: {},
  // required: [],
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

// mazePositionsTool gives agents their current location, destination, and passable exits in one call.
const mazePositionsTool: AgentToolDefinition = {
  type: "function",
  function: {
    name: "get_maze_positions",
    description:
      "Get current cell, destination cell, and which moves are passable from the current cell. Row increases going down, col increases going right; MoveUp and MoveDown change row by ±1; MoveLeft and MoveRight change col by ±1. All 4 moves are always classified in directions — each appears in exactly one of open or blocked; selecting a blocked move triggers an invalid-move. Returns JSON: {\"currentCell\":{\"row\":number,\"col\":number}|null,\"destinationCell\":{\"row\":number,\"col\":number}|null,\"directions\":{\"open\":[...],\"blocked\":[]}}.",
    parameters: emptyToolParameters,
  },
}

// traversalHistoryTool lets agents avoid repeating explored logical cells across turns.
const traversalHistoryTool: AgentToolDefinition = {
  type: "function",
  function: {
    name: "get_traversal_history",
    description:
      "Get all players' visit records in chronological order. Returns JSON: {\"traversalHistory\":[{\"playerName\":string,\"row\":number,\"col\":number}]}. Filter by playerName to review a specific player's visit sequence.",
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
      "Get move submission rules. suggestedMovesPerTurn is the suggested maximum moves to submit per turn, scaled to maze size; submitting fewer moves on early turns limits wasted score if your predicted moves turn out to be wrong. Returns JSON: {\"suggestedMovesPerTurn\":number,\"expectedResponseSchema\":object}.",
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
  openDirections: MoveAction[],
): AgentToolHandlers {
  const suggestedMovesPerTurn = state.mazeDimensions
    ? getNavigationProfile(state.mazeDimensions).__hardCorridorLimit
    : 0

  return {
    get_game_status() {
      return {
        level: state.level,
        status: state.status,
        score: state.score,
        mazeDimensions: state.mazeDimensions,
      }
    },
    get_maze_positions() {
      return {
        currentCell: state.playerPosition
          ? cellCoordinateFromGridPoint(state.playerPosition)
          : null,
        destinationCell: state.finalPosition
          ? cellCoordinateFromGridPoint(state.finalPosition)
          : null,
        directions: {
          open: openDirections,
          blocked: ALLOWED_MOVE_ACTIONS.filter((m) => !openDirections.includes(m)),
        },
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
