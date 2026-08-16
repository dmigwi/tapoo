import { CONFIG } from "./config"
import type {
  BaseDimensions,
  GameStatus,
  MazeControlModeName,
  MazeDimensions,
  MoveStatus,
  PersistedGameStatus,
  RenderGridPoint,
  State,
} from "./types"

const { controlModes } = CONFIG.runtime

// ViewportFitStatus classifies whether the maze fits or which viewport axis blocks it.
export type ViewportFitStatus =
  | "fits"
  | "too-small-length"
  | "too-small-width"
  | "too-small-all"

export type TooSmallStatus = "too-small" | Exclude<ViewportFitStatus, "fits">

// isAgentApiMode identifies the browser mode where maze traversal comes from configured agents.
export function isAgentApiMode(
  modeName: MazeControlModeName,
): modeName is "agent-api" {
  return modeName === controlModes.agentApi
}

// isInteractiveMode identifies the human-controlled browser mode.
export function isInteractiveMode(
  modeName: MazeControlModeName,
): modeName is "interactive" {
  return modeName === controlModes.interactive
}

// viewportFitStatus classifies which axis blocks the current maze from fitting.
export function viewportFitStatus(
  dimensions: BaseDimensions | null,
  terminalSize: BaseDimensions | null,
): ViewportFitStatus {
  if (!dimensions) {
    return "fits"
  }

  if (!terminalSize) {
    return "too-small-all"
  }

  const lengthTooSmall = dimensions.numCols > terminalSize.numCols
  const widthTooSmall = dimensions.numRows > terminalSize.numRows

  if (lengthTooSmall && widthTooSmall) {
    return "too-small-all"
  }

  if (lengthTooSmall) {
    return "too-small-length"
  }

  if (widthTooSmall) {
    return "too-small-width"
  }

  return "fits"
}

// isAwaitAgentStatus identifies agent-api play before any enabled agent exists.
export function isAwaitAgentStatus(
  status: GameStatus,
): status is "await-agent" {
  return status === "await-agent"
}

// isRunningStatus narrows a status value to the active gameplay state.
export function isRunningStatus(
  status: GameStatus,
): status is "running" {
  return status === "running"
}

// isPausedStatus narrows a status value to the resumable pause state.
export function isPausedStatus(
  status: GameStatus,
): status is "paused" {
  return status === "paused"
}

// isWonStatus narrows a status value to the successful end-of-round state.
export function isWonStatus(status: GameStatus): status is "won" {
  return status === "won"
}

// isLostStatus narrows a status value to the failed end-of-round state.
export function isLostStatus(status: GameStatus): status is "lost" {
  return status === "lost"
}

// isSuccessfulMoveStatus identifies replay outcomes where a move actually advanced into a cell.
export function isSuccessfulMoveStatus(
  status: MoveStatus | undefined,
): status is "applied" | "reached-target" {
  return status === "applied" || status === "reached-target"
}

// isValidGridPointEqual returns true only when both positions exist and point to the same grid cell.
export function isValidGridPointEqual(
  player: RenderGridPoint | null,
  target: RenderGridPoint | null,
): boolean {
  if (!player || !target) {
    return false
  }

  return player.x === target.x && player.y === target.y
}

// hasReachedTarget reads the live maze position without mutating status, so move replay and
// turn finalization can answer the same question without depending on commit timing.
export function hasReachedTarget(state: State): boolean {
  return isValidGridPointEqual(state.playerPosition, state.finalPosition)
}

// canTrackDestinationVisibility identifies active rounds whose clock can drive target visibility.
export function canTrackDestinationVisibility(
  state: State,
): state is State & { clock: NonNullable<State["clock"]> } {
  return isRunningStatus(state.status) && state.clock !== null
}

// isTooSmallStatus identifies both rendered and internal viewport-too-small states.
export function isTooSmallStatus(
  status: GameStatus | ViewportFitStatus,
): status is TooSmallStatus {
  return (
    status === "too-small" ||
    status === "too-small-length" ||
    status === "too-small-width" ||
    status === "too-small-all"
  )
}

// isFinishedStatus groups the terminal win/loss states together.
export function isFinishedStatus(
  status: GameStatus,
): status is "won" | "lost" {
  return isWonStatus(status) || isLostStatus(status)
}

// canProceedStatus marks a settled round: a maze exists but is not advancing, so the player owes
// it a decision. The three compound checks below are each written as this set plus or minus what
// makes them differ, so the shared membership is stated once here — widening this widens them all.
export function canProceedStatus(status: GameStatus): boolean {
  return (
    isAwaitAgentStatus(status) ||
    isPausedStatus(status) ||
    isFinishedStatus(status)
  )
}

// canPersistRoundStatus accepts everything canProceedStatus does, plus running, since a live round
// has to survive a reload too. Its return type claims every status it accepts is a
// PersistedGameStatus, and that claim is only true while canProceedStatus itself stays within that
// union. TypeScript never checks a type predicate's body, so status.test.ts enforces the claim.
export function canPersistRoundStatus(
  status: GameStatus,
): status is PersistedGameStatus {
  return (
    isRunningStatus(status) || canProceedStatus(status)
  )
}

// canShowWallsStatus accepts exactly what canProceedStatus does: reweighting redraws the maze,
// which is only safe while nothing is moving through it.
export function canShowWallsStatus(status: GameStatus): boolean {
  return canProceedStatus(status)
}

// canShowRestart accepts everything canProceedStatus does, plus too-small when there's a lower level
// to fall back to. Reset Progress always restarts at level 1 (restartGame in game.ts), so offering it
// while already too-small at level 1 would just redraw the same maze into the same too-small state —
// there's no smaller level left to make room.
export function canShowRestart(status: GameStatus, level: number): boolean {
  if (isTooSmallStatus(status)) {
    return level > 1
  }

  return canProceedStatus(status)
}

// ActiveRoundState is State with every field a live round needs proven present, so callers guarded by
// hasActiveRoundState can read them without repeating the null checks. traversalHistory stays a plain
// array here: a type cannot express "non-empty", so that half of the guard is a runtime claim only.
export type ActiveRoundState = State & {
  mazeDimensions: MazeDimensions
  maze: string[][]
  startPosition: RenderGridPoint
  playerPosition: RenderGridPoint
  finalPosition: RenderGridPoint
}

// hasActiveRoundState reports whether a round holds enough state to be drawn, moved through, or saved.
export function hasActiveRoundState(state: State): state is ActiveRoundState {
  return (
    state.mazeDimensions !== null &&
    state.maze !== null &&
    state.startPosition !== null &&
    state.playerPosition !== null &&
    state.finalPosition !== null &&
    state.traversalHistory.length > 0
  )
}

// stateInvariantError reports impossible status/state combinations before rendering or persistence.
export function stateInvariantError(state: State): string | null {
  // Paused status must freeze time too; otherwise a paused screen would keep burning score.
  if (isPausedStatus(state.status) && !state.clock?.isPaused) {
    return "invalid game state: paused status requires a paused clock"
  }

  // Running status must not carry a frozen clock, or movement and score display drift apart.
  if (isRunningStatus(state.status) && state.clock?.isPaused) {
    return "invalid game state: running status requires an active clock"
  }

  // Playable or resumable states need enough round data to redraw and persist the same maze.
  if (
    (isRunningStatus(state.status) ||
      isPausedStatus(state.status) ||
      isFinishedStatus(state.status) ||
      isAwaitAgentStatus(state.status)) &&
    !hasActiveRoundState(state)
  ) {
    return `invalid game state: ${state.status} status requires an active round`
  }

  // Boot and too-small are non-round screens, so retaining maze data there risks stale redraws.
  if ((isTooSmallStatus(state.status) || state.status === "boot") && hasActiveRoundState(state)) {
    return `invalid game state: ${state.status} status cannot keep an active round`
  }

  return null
}
