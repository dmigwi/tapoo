import type {
  BaseDimensions,
  GameStatus,
  MazeControlModeName,
  PersistedGameStatus,
} from "./types"

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
  return modeName === "agent-api"
}

// isInteractiveMode identifies the human-controlled browser mode.
export function isInteractiveMode(
  modeName: MazeControlModeName,
): modeName is "interactive" {
  return modeName === "interactive"
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

  const lengthTooSmall = dimensions.length > terminalSize.length
  const widthTooSmall = dimensions.width > terminalSize.width

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

// canPersistRoundStatus limits persistence to round states that can be restored later.
export function canPersistRoundStatus(
  status: GameStatus,
): status is PersistedGameStatus {
  return (
    isRunningStatus(status) ||
    isPausedStatus(status) ||
    isWonStatus(status) ||
    isLostStatus(status) ||
    isAwaitAgentStatus(status)
  )
}

// canProceedStatus marks states that accept the proceed action.
export function canProceedStatus(status: GameStatus): boolean {
  return (
    isAwaitAgentStatus(status) ||
    isPausedStatus(status) ||
    isFinishedStatus(status)
  )
}

// canShowWallsStatus marks states where wall reweighting remains safe to expose.
export function canShowWallsStatus(status: GameStatus): boolean {
  return isPausedStatus(status) || isFinishedStatus(status)
}
