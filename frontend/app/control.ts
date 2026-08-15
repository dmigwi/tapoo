import { hasReachedDestination } from "./control/turn-resolution"
import { isSuccessfulMoveStatus } from "./status"
import {
  isMoveAction,
  resolvePlayerMove,
} from "./traversal"
import {
  SUBMITTED_MOVES_SCHEMA,
} from "./agent/context"
import type {
  MazeAction,
  MazeActionDispatchOptions,
  MazeActionResult,
  MoveAction,
  MoveStatus,
  State,
} from "./types"

// normalizeSubmittedMoves formats replayed commands into the stable stepNumber:MoveAction shape.
function normalizeSubmittedMoves(moves: MoveAction[]): string[] {
  return moves.map((move, index) => `${index}:${move}`)
}

// buildMazeActionResult stores only the replay details that are not already available on State.
export function buildMazeActionResult(
  playerName: string,
  overrides: Partial<MazeActionResult> = {},
): MazeActionResult {
  return {
    lastPlayerName: playerName,
    ...overrides,
  }
}

// mergeMazeActionResult reapplies replay details while preserving cloned submitted move arrays.
export function mergeMazeActionResult(
  actionResult: MazeActionResult | null,
  overrides: Partial<MazeActionResult> = {},
): MazeActionResult {
  return {
    ...(actionResult ?? {}),
    ...(actionResult?.lastSubmittedMovesSchema
      ? { lastSubmittedMovesSchema: actionResult.lastSubmittedMovesSchema }
      : {}),
    ...(actionResult?.lastSubmittedMoves
      ? { lastSubmittedMoves: [...actionResult.lastSubmittedMoves] }
      : {}),
    ...overrides,
  }
}

type MazeActionHandlers = {
  state: State
  pauseGame: () => void
  awaitAgent: () => void
  restartGame: () => void
  resumeOrProceed: () => void
  cycleWallWeight: () => void
  movePlayer: (action: MoveAction, playerName: string) => void
  recordActionResult: (actionResult: MazeActionResult) => void
}

// buildReplayState records the result of one replay step without duplicating live State fields.
function buildReplayState(
  playerName: string,
  command: MoveAction,
  status: MoveStatus,
  visitedBefore?: boolean,
): MazeActionResult {
  const lastAppliedMoveIndex = isSuccessfulMoveStatus(status) ? 0 : null
  const visitedBeforeState = visitedBefore === undefined ? {} : { visitedBefore }

  return buildMazeActionResult(playerName, {
    lastMoveStatus: status,
    lastReplayStartIndex: 0,
    lastSubmittedMovesSchema: SUBMITTED_MOVES_SCHEMA,
    lastSubmittedMoves: normalizeSubmittedMoves([command]),
    lastAppliedMoveIndex,
    chargedMovesCount: 0,
    ...visitedBeforeState,
  })
}

// executeActionWithFeedback classifies one requested command and returns feedback when supported.
export function executeActionWithFeedback(
  action: MazeAction,
  playerName: string,
  handlers: MazeActionHandlers,
): MazeActionResult | null {
  if (!isMoveAction(action)) {
    executeMazeAction(action, playerName, handlers)
    return null
  }

  const move = action.type
  const moveEvaluation = resolvePlayerMove(handlers.state, move)
  if (!moveEvaluation.canMove) {
    const actionResult = buildReplayState(playerName, move, "invalid-move")
    handlers.recordActionResult(actionResult)
    return actionResult
  }

  handlers.movePlayer(move, playerName)
  const finalStatus: MoveStatus = hasReachedDestination(handlers.state) ? "reached-target" : "applied"

  const actionResult = buildReplayState(playerName, move, finalStatus, moveEvaluation.visitedBefore)
  handlers.recordActionResult(actionResult)
  return actionResult
}

// executeMazeAction maps one semantic action to the runtime effect owned by game.ts.
export function executeMazeAction(
  action: MazeAction,
  playerName: string,
  handlers: MazeActionHandlers,
): void {
  switch (action.type) {
    case "MoveLeft":
    case "MoveRight":
    case "MoveUp":
    case "MoveDown":
      handlers.movePlayer(action.type, playerName)
      return
    case "pause":
      handlers.pauseGame()
      return
    case "proceed":
      handlers.resumeOrProceed()
      return
    case "cycle-walls":
      handlers.cycleWallWeight()
      return
    case "restart":
      handlers.restartGame()
      return
    case "await-agent":
      handlers.awaitAgent()
      return
  }
}

// dispatchMazeAction keeps feedback decisions in the shared control layer.
export function dispatchMazeAction(
  action: MazeAction,
  options: MazeActionDispatchOptions,
  handlers: MazeActionHandlers,
): MazeActionResult | null {
  if (!options.wantFeedback) {
    executeMazeAction(action, options.playerName, handlers)
    return null
  }

  return executeActionWithFeedback(action, options.playerName, handlers)
}
