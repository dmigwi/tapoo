import { CONFIG } from "./config"
import { getNavigationProfile } from "./maze"
import { isRunningStatus, isWonStatus } from "./status"
import { isSpaceFound } from "./traversal"
import type {
  CellCoordinate,
  MazeAction,
  MazeActionState,
  MoveStatus,
  MoveAction,
  RenderGridPoint,
  State,
  TraversalHistoryEntry,
} from "./types"

const { maze, runtime } = CONFIG

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
  return `Your name is ${playerName}. Use traversalHistory entries matching your playerName to review your past moves in order, then use the provided context to predict the next valid moves. Valid moves advance you until the first invalid move stops replay. Every submitted prediction counts toward score decay until the destination is reached. Locate the randomized path between the current position and destination with the highest score retention.`
}

// MOVE_DELTAS mirrors runtime movement so feedback can validate moves before dispatching them.
const MOVE_DELTAS: Record<MoveAction, readonly [number, number]> = {
  MoveLeft: [0, -1],
  MoveRight: [0, 1],
  MoveUp: [-1, 0],
  MoveDown: [1, 0],
}

// cellCoordinateFromGridPoint converts one rendered maze-grid point into a logical cell position.
function cellCoordinateFromGridPoint(position: RenderGridPoint): CellCoordinate {
  return {
    row: Math.floor((position.y - 1) / maze.cellSpan),
    col: Math.floor((position.x - 1) / maze.cellSpan),
  }
}

// traversalHistoryIncludes reports whether the chronological visit history already contains a cell.
function traversalHistoryIncludes(
  traversalHistory: TraversalHistoryEntry[],
  cell: CellCoordinate,
): boolean {
  return traversalHistory.some(
    (visitedCell) =>
      visitedCell.row === cell.row && visitedCell.col === cell.col,
  )
}

// recommendedAvgPredictionLimit derives the advisory prediction length from the active navigation profile.
function recommendedAvgPredictionLimit(state: State): number {
  if (!state.dims) {
    return 0
  }

  const profile = getNavigationProfile(state.dims)
  return profile.__softCorridorLimit + profile.__hardCorridorLimit
}

// normalizeSubmittedMoves formats replayed commands into the stable stepNumber:MoveAction shape.
function normalizeSubmittedMoves(moves: MoveAction[]): string[] {
  return moves.map((move, index) => `${index}:${move}`)
}

// buildMazeActionState snapshots the live maze state together with the latest agent replay result.
export function buildMazeActionState(
  state: State,
  playerName = runtime.interactivePlayerName,
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

// isMoveAction reports whether one semantic command is a move that currently supports feedback.
function isMoveAction(
  action: MazeAction,
): action is Extract<MazeAction, { type: MoveAction }> {
  return action.type in MOVE_DELTAS
}

// buildReplayState records the result of one replay step using the shared agent payload shape.
function buildReplayState(
  state: State,
  playerName: string,
  command: MoveAction,
  status: MoveStatus,
  visitedBefore?: boolean,
): MazeActionState {
  const lastValidMoveIndex =
    status === "applied" || status === "reached-target" ? 0 : null
  const visitedBeforeState =
    visitedBefore === undefined ? {} : { visitedBefore }

  return buildMazeActionState(state, playerName, {
    lastMoveStatus: status,
    submittedMoves: normalizeSubmittedMoves([command]),
    lastValidMoveIndex,
    ...visitedBeforeState,
  })
}

// buildMoveCommandState validates one move and returns the normalized agent result.
function buildMoveCommandState(
  command: Extract<MazeAction, { type: MoveAction }>,
  context: CommandFeedbackContext,
): MazeActionState {
  const { state, handleMove, playerName } = context
  const move = command.type

  if (
    !isRunningStatus(state.status) ||
    !state.maze ||
    !state.dims ||
    !state.playerPosition
  ) {
    return buildReplayState(state, playerName, move, "invalid-move")
  }

  const [rowDelta, columnDelta] = MOVE_DELTAS[move]
  const x = state.playerPosition.x
  const y = state.playerPosition.y
  const nextY = y + rowDelta * maze.moveStep
  const nextX = x + columnDelta * maze.moveStep
  const probeY = y + rowDelta
  const probeX = x + columnDelta
  const nextCell = cellCoordinateFromGridPoint({ x: nextX, y: nextY })

  if (nextY <= 0 || nextY > state.dims.width * maze.cellSpan) {
    return buildReplayState(state, playerName, move, "invalid-move")
  }

  if (nextX <= 0 || nextX > state.dims.length * maze.cellSpan) {
    return buildReplayState(state, playerName, move, "invalid-move")
  }

  if (!isSpaceFound(state.maze[probeY][probeX])) {
    return buildReplayState(state, playerName, move, "invalid-move")
  }

  const visitedBefore = traversalHistoryIncludes(state.traversalHistory, nextCell)
  handleMove(move, playerName)

  if (isWonStatus(state.status)) {
    return buildReplayState(state, playerName, move, "reached-target", visitedBefore)
  }

  return buildReplayState(state, playerName, move, "applied", visitedBefore)
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

  return buildMoveCommandState(action, context)
}
