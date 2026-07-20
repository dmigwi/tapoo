import { CONFIG } from "../config"
import { getNavigationProfile } from "../maze"
import { isWonStatus } from "../status"
import {
  cellCoordinateFromGridPoint,
  cloneTraversalHistory,
  isMoveAction,
  resolvePlayerMove,
} from "../traversal"
import type {
  AgentExpectedResponseSchema,
  AgentSubmittedMovesSchema,
  MazeAction,
  MazeActionState,
  MoveStatus,
  MoveAction,
  State,
} from "../types"

const { runtime } = CONFIG

// ALLOWED_MOVE_ACTIONS enumerates the only traversal commands the agent may return.
const ALLOWED_MOVE_ACTIONS: MoveAction[] = ["MoveUp", "MoveDown", "MoveLeft", "MoveRight"]

// EXPECTED_RESPONSE_SCHEMA documents the exact JSON shape agents should return.
const EXPECTED_RESPONSE_SCHEMA: AgentExpectedResponseSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
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

// SUBMITTED_MOVES_SCHEMA documents the zero-based replay records Tapoo returns after a turn.
const SUBMITTED_MOVES_SCHEMA: AgentSubmittedMovesSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "array",
  description: "Zero-based replay records formatted as <index>:<move>.",
  items: {
    type: "string",
    pattern: "^(0|[1-9][0-9]*):(MoveUp|MoveDown|MoveLeft|MoveRight)$",
    examples: ["0:MoveRight"],
  },
}

// buildAgentPrompt keeps request guidance compact while naming the active agent for history lookup.
export function buildAgentPrompt(playerName: string): string {
  return [
    `Your name is ${playerName}.`,
    `playerName ${runtime.interactivePlayerName} always appears first in traversalHistory and marks the start cell.`,
    "Use currentCell as your current position and destinationCell as the target.",
    "Use traversalHistory entries matching your playerName to review your past moves in order.",
    "Explore carefully: prefer unvisited cells and submit shorter predictions when uncertain.",
    "Return only a JSON object matching expectedResponseSchema.",
    "Moves replay in order until the destination or the first invalid move.",
    "Every submitted move counts toward score decay, including moves after the first invalid move.",
    "Stop predicting when lastMoveStatus is reached-target or status is won.",
    "Choose the moves most likely to reach the destination with the fewest submitted moves.",
  ].join(" ")
}

// recommendedAvgPredictionLimit derives the advisory prediction length from the active navigation profile.
function recommendedAvgPredictionLimit(state: State): number {
  if (!state.mazeDimensions) {
    return 0
  }

  const profile = getNavigationProfile(state.mazeDimensions)
  return profile.__softCorridorLimit + profile.__hardCorridorLimit
}

// normalizeSubmittedMoves formats replayed commands into the stable stepNumber:MoveAction shape.
function normalizeSubmittedMoves(moves: MoveAction[]): string[] {
  return moves.map((move, index) => `${index}:${move}`)
}

// buildMazeActionState snapshots the live maze state together with the latest agent replay result.
export function buildMazeActionState(
  state: State,
  playerName: string,
  model: string,
  overrides: Partial<MazeActionState> = {},
): MazeActionState {
  return {
    level: state.level,
    status: state.status,
    score: state.score,
    model,
    stream: false,
    format: "json",
    currentCell: state.playerPosition ? cellCoordinateFromGridPoint(state.playerPosition) : null,
    destinationCell: state.finalPosition ? cellCoordinateFromGridPoint(state.finalPosition) : null,
    traversalHistory: cloneTraversalHistory(state.traversalHistory),
    recommendedAvgPredictionLimit: recommendedAvgPredictionLimit(state),
    prompt: buildAgentPrompt(playerName),
    expectedResponseSchema: EXPECTED_RESPONSE_SCHEMA,
    ...overrides,
  }
}

// mergeMazeActionState reapplies transient replay details on top of the latest normalized base payload.
export function mergeMazeActionState(
  actionState: MazeActionState,
  overrides: Partial<MazeActionState> = {},
): MazeActionState {
  return {
    ...actionState,
    expectedResponseSchema: actionState.expectedResponseSchema,
    ...(actionState.lastSubmittedMovesSchema
      ? { lastSubmittedMovesSchema: actionState.lastSubmittedMovesSchema }
      : {}),
    traversalHistory: cloneTraversalHistory(actionState.traversalHistory),
    ...(actionState.lastSubmittedMoves
      ? { lastSubmittedMoves: [...actionState.lastSubmittedMoves] }
      : {}),
    prompt: overrides.prompt ?? actionState.prompt,
    ...overrides,
  }
}

type CommandFeedbackContext = {
  state: State
  model: string
  playerName: string
  executeCommand: (action: MazeAction) => void
  handleMove: (action: MoveAction, playerName?: string) => void
}

// buildReplayState records the result of one replay step using the shared agent payload shape.
function buildReplayState(
  state: State,
  model: string,
  playerName: string,
  command: MoveAction,
  status: MoveStatus,
  visitedBefore?: boolean,
): MazeActionState {
  const lastValidMoveIndex = status === "applied" || status === "reached-target" ? 0 : null
  const visitedBeforeState = visitedBefore === undefined ? {} : { visitedBefore }

  return buildMazeActionState(state, playerName, model, {
    lastPlayerName: playerName,
    lastMoveStatus: status,
    lastSubmittedMovesIndexBase: 0,
    lastSubmittedMovesSchema: SUBMITTED_MOVES_SCHEMA,
    lastSubmittedMoves: normalizeSubmittedMoves([command]),
    lastValidMoveIndex,
    decayedMovesCount: 0,
    ...visitedBeforeState,
  })
}

// executeActionWithFeedback classifies one requested command and returns feedback when supported.
export function executeActionWithFeedback(
  action: MazeAction,
  context: CommandFeedbackContext,
): MazeActionState | null {
  if (!isMoveAction(action)) {
    context.executeCommand(action)
    return null
  }

  const { state, handleMove, model, playerName } = context
  const move = action.type
  const moveEvaluation = resolvePlayerMove(state, move)
  if (!moveEvaluation.canMove) {
    return buildReplayState(state, model, playerName, move, "invalid-move")
  }

  handleMove(move, playerName)
  const finalStatus: MoveStatus = isWonStatus(state.status) ? "reached-target" : "applied"

  return buildReplayState(
    state, model, playerName, move, finalStatus, moveEvaluation.visitedBefore,
  )
}
