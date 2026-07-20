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
  MazeAction,
  MazeActionState,
  MoveStatus,
  MoveAction,
  State,
} from "../types"

const { runtime } = CONFIG

// ALLOWED_MOVE_ACTIONS enumerates the only traversal commands the agent may return.
const ALLOWED_MOVE_ACTIONS: MoveAction[] = ["MoveUp", "MoveDown", "MoveLeft", "MoveRight"]

// VALID_PREDICTION_FORMAT documents the one supported agent response payload.
const VALID_PREDICTION_FORMAT = {
  validPredictionFormat: {
    moves: ["MoveRight", "MoveDown"] as MoveAction[],
  },
} as const

// agentPrompt keeps request guidance compact while naming the active agent for history lookup.
function agentPrompt(playerName: string): string {
  return [
    `Your name is ${playerName}.`,
    `playerName ${runtime.interactivePlayerName} always appears first in traversalHistory and marks the start cell.`,
    "Use currentCell as your current position and destinationCell as the target.",
    "Use traversalHistory entries matching your playerName to review your past moves in order.",
    "Explore carefully: prefer unvisited cells and submit shorter predictions when uncertain.",
    "Return only the expected JSON moves payload using allowedMoves.",
    "Moves replay in order until the destination or the first invalid move.",
    "Every submitted move counts toward score decay, including moves after the first invalid move.",
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
  overrides: Partial<MazeActionState> = {},
): MazeActionState {
  return {
    level: state.level,
    status: state.status,
    score: state.score,
    model: "",
    stream: false,
    format: "json",
    playerName,
    currentCell: state.playerPosition ? cellCoordinateFromGridPoint(state.playerPosition) : null,
    destinationCell: state.finalPosition ? cellCoordinateFromGridPoint(state.finalPosition) : null,
    traversalHistory: cloneTraversalHistory(state.traversalHistory),
    allowedMoves: [...ALLOWED_MOVE_ACTIONS],
    recommendedAvgPredictionLimit: recommendedAvgPredictionLimit(state),
    prompt: agentPrompt(playerName),
    expectedResponseFormat: {
      validPredictionFormat: {
        moves: [...VALID_PREDICTION_FORMAT.validPredictionFormat.moves],
      },
    },
    submittedMovesIndexBase: 0,
    submittedMovesPattern: "<index>:<MoveAction>",
    submittedMoves: [],
    lastMoveStatus: null,
    lastValidMoveIndex: null,
    decayedMovesCount: 0,
    ...overrides,
  }
}

// mergeMazeActionState reapplies transient replay details on top of the latest normalized base payload.
export function mergeMazeActionState(
  actionState: MazeActionState,
  overrides: Partial<MazeActionState> = {},
): MazeActionState {
  const playerName = overrides.playerName ?? actionState.playerName

  return {
    ...actionState,
    allowedMoves: [...actionState.allowedMoves],
    expectedResponseFormat: {
      validPredictionFormat: {
        moves: [...actionState.expectedResponseFormat.validPredictionFormat.moves],
      },
    },
    traversalHistory: cloneTraversalHistory(actionState.traversalHistory),
    submittedMoves: [...actionState.submittedMoves],
    prompt: overrides.prompt ?? agentPrompt(playerName),
    ...overrides,
  }
}

type CommandFeedbackContext = {
  state: State
  playerName: string
  executeCommand: (action: MazeAction) => void
  handleMove: (action: MoveAction, playerName?: string) => void
}

// buildReplayState records the result of one replay step using the shared agent payload shape.
function buildReplayState(
  state: State,
  playerName: string,
  command: MoveAction,
  status: MoveStatus,
  visitedBefore?: boolean,
): MazeActionState {
  const lastValidMoveIndex = status === "applied" || status === "reached-target" ? 0 : null
  const visitedBeforeState = visitedBefore === undefined ? {} : { visitedBefore }

  return buildMazeActionState(state, playerName, {
    lastMoveStatus: status,
    submittedMoves: normalizeSubmittedMoves([command]),
    lastValidMoveIndex,
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

  const { state, handleMove, playerName } = context
  const move = action.type
  const moveEvaluation = resolvePlayerMove(state, move)
  if (!moveEvaluation.canMove) {
    return buildReplayState(state, playerName, move, "invalid-move")
  }

  handleMove(move, playerName)
  const finalStatus: MoveStatus = isWonStatus(state.status) ? "reached-target" : "applied"

  return buildReplayState(
    state,
    playerName,
    move,
    finalStatus,
    moveEvaluation.visitedBefore,
  )
}
