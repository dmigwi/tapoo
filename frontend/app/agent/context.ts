import { getNavigationProfile } from "../maze"
import { isWonStatus } from "../status"
import {
  cellCoordinateFromGridPoint,
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
    "Use traversalHistory entries matching your playerName to review your past moves in order,",
    "then use the provided context to predict the next valid moves.",
    "Valid moves advance you until the first invalid move stops replay.",
    "Every submitted prediction counts toward score decay until the destination is reached.",
    "Locate the randomized path between the current position and destination with the highest score retention.",
  ].join("\n")
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
    traversalHistory: state.traversalHistory.map(({ playerName, row, col }) => ({
      playerName, row, col,
    })),
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
    traversalHistory: actionState.traversalHistory.map(({ playerName, row, col }) => ({
      playerName, row, col,
    })),
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
