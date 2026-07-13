import { CONFIG } from "./config"
import { isLostStatus, isPausedStatus, isRunningStatus, isWonStatus } from "./status"
import { isSpaceFound } from "./traversal"
import type {
  MazeControlCommand,
  MazeControlFeedback,
  MoveAction,
  State,
  WallWeight,
} from "./types"

// MOVE_DELTAS mirrors runtime movement so feedback can validate moves before dispatching them.
const MOVE_DELTAS: Record<MoveAction, readonly [number, number]> = {
  MoveLeft: [0, -1],
  MoveRight: [0, 1],
  MoveUp: [-1, 0],
  MoveDown: [1, 0],
}

// COMMAND_FEEDBACK_MESSAGES keeps agent-focused feedback short and cheap to send repeatedly.
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
  pauseUnavailable: "Pause unavailable.",
  pauseSuccess: "Paused.",
  proceedResumed: "Resumed.",
  proceedUnavailable: "Proceed unavailable.",
  wallWeightUnchanged: "Walls unchanged.",
  restartSuccess: "Progress reset.",
} as const

// proceedStartedLevel reports that proceed advanced into a fresh level.
export function proceedStartedLevel(level: number): string {
  return `Level ${level} started.`
}

// proceedRestartedLevel reports that proceed retried the current level after a loss.
export function proceedRestartedLevel(level: number): string {
  return `Level ${level} restarted.`
}

// changedWallWeight reports the wall style currently applied to the maze.
export function changedWallWeight(weight: WallWeight): string {
  return `Walls ${weight}.`
}

type CommandFeedbackContext = {
  state: State
  handleMove: (action: MoveAction) => void
  pauseGame: () => void
  resumeOrProceed: () => void
  cycleWallWeight: () => void
  restartGame: () => void
}

// currentCommandFeedback snapshots the runtime state immediately after one command resolves.
function currentCommandFeedback(
  state: State,
  command: MazeControlCommand["type"],
  ok: boolean,
  message: string,
): MazeControlFeedback {
  return {
    command,
    level: state.level,
    message,
    ok,
    score: state.score,
    status: state.status,
    wallWeight: state.wallWeight,
  }
}

// moveWithFeedback validates a move and returns a compact outcome for agent callers.
function moveWithFeedback(
  action: MoveAction,
  context: CommandFeedbackContext,
): MazeControlFeedback {
  const { state, handleMove } = context

  if (
    !isRunningStatus(state.status) ||
    !state.maze ||
    !state.dims ||
    !state.playerPosition
  ) {
    return currentCommandFeedback(
      state,
      "move",
      false,
      COMMAND_FEEDBACK_MESSAGES.moveUnavailable(action),
    )
  }

  const [rowDelta, columnDelta] = MOVE_DELTAS[action]
  const row = state.playerPosition[0]
  const column = state.playerPosition[1]
  const nextRow = row + rowDelta * CONFIG.moveStep
  const nextColumn = column + columnDelta * CONFIG.moveStep
  const probeRow = row + rowDelta
  const probeColumn = column + columnDelta

  if (nextRow <= 0 || nextRow > state.dims.width * CONFIG.cellSpan) {
    return currentCommandFeedback(
      state,
      "move",
      false,
      COMMAND_FEEDBACK_MESSAGES.moveOutOfBounds(action),
    )
  }

  if (nextColumn <= 0 || nextColumn > state.dims.length * CONFIG.cellSpan) {
    return currentCommandFeedback(
      state,
      "move",
      false,
      COMMAND_FEEDBACK_MESSAGES.moveOutOfBounds(action),
    )
  }

  if (!isSpaceFound(state.maze[probeRow][probeColumn])) {
    return currentCommandFeedback(
      state,
      "move",
      false,
      COMMAND_FEEDBACK_MESSAGES.moveBlocked(action),
    )
  }

  handleMove(action)

  if (isWonStatus(state.status)) {
    return currentCommandFeedback(
      state,
      "move",
      true,
      COMMAND_FEEDBACK_MESSAGES.moveReachedDestination(action),
    )
  }

  return currentCommandFeedback(
    state,
    "move",
    true,
    COMMAND_FEEDBACK_MESSAGES.moveSuccess(action),
  )
}

// pauseWithFeedback reports whether pausing was accepted in the current state.
function pauseWithFeedback(context: CommandFeedbackContext): MazeControlFeedback {
  const { state, pauseGame } = context

  if (!isRunningStatus(state.status) || !state.clock) {
    return currentCommandFeedback(
      state,
      "pause",
      false,
      COMMAND_FEEDBACK_MESSAGES.pauseUnavailable,
    )
  }

  pauseGame()
  return currentCommandFeedback(
    state,
    "pause",
    true,
    COMMAND_FEEDBACK_MESSAGES.pauseSuccess,
  )
}

// proceedWithFeedback reports whether proceed resumed, advanced, retried, or failed.
function proceedWithFeedback(
  context: CommandFeedbackContext,
): MazeControlFeedback {
  const { state, resumeOrProceed } = context

  if (isPausedStatus(state.status) && state.canResume && state.clock) {
    resumeOrProceed()
    return currentCommandFeedback(
      state,
      "proceed",
      true,
      COMMAND_FEEDBACK_MESSAGES.proceedResumed,
    )
  }

  if (isWonStatus(state.status)) {
    const nextLevel = state.level + 1
    resumeOrProceed()
    return currentCommandFeedback(
      state,
      "proceed",
      true,
      proceedStartedLevel(nextLevel),
    )
  }

  if (isLostStatus(state.status)) {
    const currentLevel = state.level
    resumeOrProceed()
    return currentCommandFeedback(
      state,
      "proceed",
      true,
      proceedRestartedLevel(currentLevel),
    )
  }

  return currentCommandFeedback(
    state,
    "proceed",
    false,
    COMMAND_FEEDBACK_MESSAGES.proceedUnavailable,
  )
}

// cycleWallsWithFeedback reports whether cycling actually changed the wall style.
function cycleWallsWithFeedback(
  context: CommandFeedbackContext,
): MazeControlFeedback {
  const { state, cycleWallWeight } = context
  const previousWeight = state.wallWeight
  cycleWallWeight()

  if (state.wallWeight === previousWeight) {
    return currentCommandFeedback(
      state,
      "cycle-walls",
      false,
      COMMAND_FEEDBACK_MESSAGES.wallWeightUnchanged,
    )
  }

  return currentCommandFeedback(
    state,
    "cycle-walls",
    true,
    changedWallWeight(state.wallWeight),
  )
}

// restartWithFeedback reports the post-reset state returned to agent callers.
function restartWithFeedback(
  context: CommandFeedbackContext,
): MazeControlFeedback {
  const { state, restartGame } = context
  restartGame()
  return currentCommandFeedback(
    state,
    "restart",
    true,
    COMMAND_FEEDBACK_MESSAGES.restartSuccess,
  )
}

// executeCommandWithFeedback runs one command and packages the resulting agent feedback.
export function executeCommandWithFeedback(
  command: MazeControlCommand,
  context: CommandFeedbackContext,
): MazeControlFeedback {
  switch (command.type) {
    case "move":
      // Movement is the only command that carries extra payload.
      return moveWithFeedback(command.move, context)
    case "pause":
      return pauseWithFeedback(context)
    case "proceed":
      // Proceed covers resume-after-pause as well as post-win/post-loss flow.
      return proceedWithFeedback(context)
    case "cycle-walls":
      return cycleWallsWithFeedback(context)
    case "restart":
      return restartWithFeedback(context)
  }
}
