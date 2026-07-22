import { CONFIG } from "../config"
import { getNavigationProfile } from "../maze"
import {
  cellCoordinateFromGridPoint,
  cloneTraversalHistory,
} from "../traversal"
import type {
  AgentApiConfig,
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

// ALLOWED_MOVE_ACTIONS enumerates the only traversal commands accepted from prediction sources.
const ALLOWED_MOVE_ACTIONS: MoveAction[] = ["MoveUp", "MoveDown", "MoveLeft", "MoveRight"]

// EXPECTED_RESPONSE_SCHEMA documents the exact JSON shape returned by prediction sources.
export const EXPECTED_RESPONSE_SCHEMA: AgentExpectedResponseSchema = {
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
    examples: ["0:MoveRight", "1:MoveUp", "2:MoveRight"],
  },
}

const emptyToolParameters: AgentToolDefinition["function"]["parameters"] = {
  type: "object",
  additionalProperties: false,
  properties: {},
  required: [],
}

// Tool return formats are documented in descriptions because `parameters` only describes inputs.
// gameStatusTool exposes round progress and maze dimensions without leaking full state.
const gameStatusTool: AgentToolDefinition = {
  type: "function",
  function: {
    name: "get_game_status",
    description:
      "Get current Tapoo level, status, score, and maze dimensions. Returns JSON: {\"level\":number,\"status\":string,\"score\":number,\"mazeDimensions\":{\"length\":number,\"width\":number,\"area\":number}}. length is the number of columns, width is the number of rows, area is the total cell count.",
    parameters: emptyToolParameters,
  },
}

// mazePositionsTool gives agents the minimum location data needed to plan the next move.
const mazePositionsTool: AgentToolDefinition = {
  type: "function",
  function: {
    name: "get_maze_positions",
    description:
      "Get current and destination cells. Row increases going down, col increases going right; MoveUp/Down changes row by ±1, MoveLeft/Right changes col by ±1. Returns JSON: {\"currentCell\":{\"row\":number,\"col\":number}|null,\"destinationCell\":{\"row\":number,\"col\":number}|null}.",
    parameters: emptyToolParameters,
  },
}

// traversalHistoryTool lets agents avoid repeating explored logical cells across turns.
const traversalHistoryTool: AgentToolDefinition = {
  type: "function",
  function: {
    name: "get_traversal_history",
    description:
      "Get all players' visited cells in chronological order. Returns JSON: {\"traversalHistory\":[{\"playerName\":string,\"row\":number,\"col\":number}]}. Filter by playerName to get a specific player's path.",
    parameters: emptyToolParameters,
  },
}

// predictionRulesTool documents the only accepted move response and the suggested batch size.
const predictionRulesTool: AgentToolDefinition = {
  type: "function",
  function: {
    name: "get_prediction_rules",
    description:
      "Get movement response rules. suggestedMovesPerTurn is the suggested maximum moves to submit per turn, scaled to maze size; submitting fewer moves on early turns limits wasted score if the path turns out to be wrong. Returns JSON: {\"suggestedMovesPerTurn\":number,\"expectedResponseSchema\":object}.",
    parameters: emptyToolParameters,
  },
}

// lastReplayResultTool reports the previous replay outcome so agents can correct course.
const lastReplayResultTool: AgentToolDefinition = {
  type: "function",
  function: {
    name: "get_last_replay_result",
    description:
      "Get the previous turn replay result. lastMoveStatus is the outcome (e.g. applied, reached-target, invalid-move). lastSubmittedMoves lists the moves from that turn; replayStartIndex is their zero-based offset in the overall move history. lastAppliedMoveIndex is the index within lastSubmittedMoves of the last successfully applied move — moves after it were not executed. visitedBefore indicates whether the cell entered by the last valid move was already in traversal history. chargedMovesCount is the total score-decaying moves charged that turn. Returns JSON with lastPlayerName, lastMoveStatus, replayStartIndex, lastSubmittedMovesSchema, lastSubmittedMoves, lastAppliedMoveIndex, visitedBefore, and chargedMovesCount.",
    parameters: emptyToolParameters,
  },
}

// AGENT_CONTEXT_TOOLS exposes focused context slices instead of one oversized state object.
export const AGENT_CONTEXT_TOOLS: AgentToolDefinition[] = [
  gameStatusTool,
  mazePositionsTool,
  traversalHistoryTool,
  predictionRulesTool,
  lastReplayResultTool,
]

// buildMazeActionPrompt keeps request guidance compact while naming the active player.
export function buildMazeActionPrompt(playerName: string): string {
  return [
    `Your name is ${playerName}.`,
    `playerName ${runtime.interactivePlayerName} always appears first in traversalHistory and marks the start cell.`,
    "Use currentCell as your current position and destinationCell as the target.",
    "The maze is randomly generated each level with exactly one path to the destination.",
    "Use traversalHistory entries matching your playerName to review your past moves in order.",
    "Explore carefully: prefer unvisited cells and submit shorter predictions when uncertain.",
    `Return only JSON {"moves":["MoveRight",...]} where each move is one of MoveUp, MoveDown, MoveLeft, MoveRight.`,
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
      content: [
        `It is ${playerName}'s turn to predict Tapoo maze moves.`,
        "Use the available tools to inspect the current maze state.",
        `Return only JSON {"moves":["MoveRight",...]} with moves from: MoveUp, MoveDown, MoveLeft, MoveRight.`,
      ].join(" "),
    },
  ]
}

// buildAgentToolHandlers binds the latest state snapshot to the context tools for this request.
export function buildAgentToolHandlers(
  state: State,
  agent: AgentApiConfig,
  lastActionResult: MazeActionResult | null,
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
      }
    },
    get_traversal_history() {
      return {
        traversalHistory: cloneTraversalHistory(state.traversalHistory),
      }
    },
    get_prediction_rules() {
      return {
        suggestedMovesPerTurn,
        expectedResponseSchema: EXPECTED_RESPONSE_SCHEMA,
      }
    },
    get_last_replay_result() {
      return {
        lastPlayerName: lastActionResult?.lastPlayerName ?? null,
        lastMoveStatus: lastActionResult?.lastMoveStatus ?? null,
        replayStartIndex: lastActionResult?.replayStartIndex ?? null,
        lastSubmittedMovesSchema: lastActionResult?.lastSubmittedMovesSchema ?? null,
        lastSubmittedMoves: lastActionResult?.lastSubmittedMoves ?? [],
        lastAppliedMoveIndex: lastActionResult?.lastAppliedMoveIndex ?? null,
        visitedBefore: lastActionResult?.visitedBefore ?? null,
        chargedMovesCount: lastActionResult?.chargedMovesCount ?? 0,
      }
    },
  }
}
