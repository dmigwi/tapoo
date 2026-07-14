import { CONFIG } from "./config"
import { isRunningStatus, isWonStatus } from "./status"
import { isSpaceFound } from "./traversal"
import type {
  CellCoordinate,
  CommandStatus,
  MazeAction,
  MazeAgentExpectedResponseType,
  MazeActionState,
  MoveAction,
  RenderGridPoint,
  State,
} from "./types"

// MOVE_DELTAS mirrors runtime movement so feedback can validate moves before dispatching them.
const MOVE_DELTAS: Record<MoveAction, readonly [number, number]> = {
  MoveLeft: [0, -1],
  MoveRight: [0, 1],
  MoveUp: [-1, 0],
  MoveDown: [1, 0],
}

// COMMAND_FEEDBACK_MESSAGES keeps agent-focused command outcomes short and cheap to send repeatedly.
const COMMAND_FEEDBACK_MESSAGES = {
  moveUnavailable: (action: MoveAction): string =>
    `${action} unavailable.`,
  moveOutOfBounds: (action: MoveAction): string =>
    `${action} out of bounds.`,
  moveBlocked: (action: MoveAction): string =>
    `${action} blocked.`,
  moveReachedDestination: (action: MoveAction): string =>
    `${action} reached target.`,
  moveSuccess: (action: MoveAction): string =>
    `${action} applied.`,
} as const

// COMMAND_STATE_INSTRUCTIONS tells the agent what to do next after applying the latest command state.
const COMMAND_STATE_INSTRUCTIONS = {
  chooseNextMove: "Choose the next MoveAction.",
  chooseDifferentMove: "Choose a different MoveAction.",
} as const

const EXPECTED_AGENT_RESPONSE_TYPE: MazeAgentExpectedResponseType = "MoveAction"

// cellCoordinateFromGridPoint converts one rendered maze-grid point into a logical cell position.
function cellCoordinateFromGridPoint(position: RenderGridPoint): CellCoordinate {
  return {
    row: Math.floor((position.y - 1) / CONFIG.cellSpan),
    col: Math.floor((position.x - 1) / CONFIG.cellSpan),
  }
}

// traversalHistoryIncludes reports whether the chronological visit history already contains a cell.
function traversalHistoryIncludes(
  traversalHistory: CellCoordinate[],
  cell: CellCoordinate,
): boolean {
  return traversalHistory.some(
    (visitedCell) =>
      visitedCell.row === cell.row && visitedCell.col === cell.col,
  )
}

type CommandFeedbackContext = {
  executeCommand: (action: MazeAction) => void
  state: State
  handleMove: (action: MoveAction) => void
}

// isMoveAction reports whether one semantic command is a move that currently supports feedback.
function isMoveAction(action: MazeAction): action is Extract<MazeAction, { type: MoveAction }> {
  return action.type in MOVE_DELTAS
}

// buildCommandState snapshots the runtime state immediately after one command resolves.
function buildCommandState(
  command: MazeAction,
  lastCommandStatus: CommandStatus,
  lastCommandMessage: string,
  instruction: string,
  visitedBefore?: boolean,
): MazeActionState {
  return {
    lastCommand: command,
    lastCommandStatus,
    lastCommandMessage,
    instruction,
    expectedResponseType: EXPECTED_AGENT_RESPONSE_TYPE,
    visitedBefore,
  }
}

// buildMoveCommandState validates a move and returns a compact outcome for agent callers.
function buildMoveCommandState(
  command: Extract<MazeAction, { type: MoveAction }>,
  context: CommandFeedbackContext,
): MazeActionState {
  const { state, handleMove } = context
  const move = command.type

  if (
    !isRunningStatus(state.status) ||
    !state.maze ||
    !state.dims ||
    !state.playerPosition
  ) {
    return buildCommandState(
      command,
      "invalid",
      COMMAND_FEEDBACK_MESSAGES.moveUnavailable(move),
      COMMAND_STATE_INSTRUCTIONS.chooseDifferentMove,
    )
  }

  const [rowDelta, columnDelta] = MOVE_DELTAS[move]
  const x = state.playerPosition.x
  const y = state.playerPosition.y
  const nextY = y + rowDelta * CONFIG.moveStep
  const nextX = x + columnDelta * CONFIG.moveStep
  const probeY = y + rowDelta
  const probeX = x + columnDelta
  const nextCell = cellCoordinateFromGridPoint({ x: nextX, y: nextY })

  if (nextY <= 0 || nextY > state.dims.width * CONFIG.cellSpan) {
    return buildCommandState(
      command,
      "invalid",
      COMMAND_FEEDBACK_MESSAGES.moveOutOfBounds(move),
      COMMAND_STATE_INSTRUCTIONS.chooseDifferentMove,
    )
  }

  if (nextX <= 0 || nextX > state.dims.length * CONFIG.cellSpan) {
    return buildCommandState(
      command,
      "invalid",
      COMMAND_FEEDBACK_MESSAGES.moveOutOfBounds(move),
      COMMAND_STATE_INSTRUCTIONS.chooseDifferentMove,
    )
  }

  if (!isSpaceFound(state.maze[probeY][probeX])) {
    return buildCommandState(
      command,
      "invalid",
      COMMAND_FEEDBACK_MESSAGES.moveBlocked(move),
      COMMAND_STATE_INSTRUCTIONS.chooseDifferentMove,
    )
  }

  const visitedBefore = traversalHistoryIncludes(
    state.traversalHistory,
    nextCell,
  )
  handleMove(move)

  if (isWonStatus(state.status)) {
    return buildCommandState(
      command,
      "reached-target",
      COMMAND_FEEDBACK_MESSAGES.moveReachedDestination(move),
      COMMAND_STATE_INSTRUCTIONS.chooseNextMove,
      visitedBefore,
    )
  }

  return buildCommandState(
    command,
    "applied",
    COMMAND_FEEDBACK_MESSAGES.moveSuccess(move),
    COMMAND_STATE_INSTRUCTIONS.chooseNextMove,
    visitedBefore,
  )
}

// executeActionWithFeedback classifies a requested command and returns feedback when supported.
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
