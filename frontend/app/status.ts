import type { GameStatus, PersistedGameStatus } from "./types"

// isAwaitAgentStatus identifies agent-api play before any enabled agent exists.
export function isAwaitAgentStatus(
  status: GameStatus | PersistedGameStatus,
): status is "await-agent" {
  return status === "await-agent"
}

// isRunningStatus narrows a status value to the active gameplay state.
export function isRunningStatus(
  status: GameStatus | PersistedGameStatus,
): status is "running" {
  return status === "running"
}

// isPausedStatus narrows a status value to the resumable pause state.
export function isPausedStatus(
  status: GameStatus | PersistedGameStatus,
): status is "paused" {
  return status === "paused"
}

// isWonStatus narrows a status value to the successful end-of-round state.
export function isWonStatus(
  status: GameStatus | PersistedGameStatus,
): status is "won" {
  return status === "won"
}

// isLostStatus narrows a status value to the failed end-of-round state.
export function isLostStatus(
  status: GameStatus | PersistedGameStatus,
): status is "lost" {
  return status === "lost"
}

// isTooSmallStatus identifies the viewport-too-small sentinel state.
export function isTooSmallStatus(status: GameStatus): status is "too-small" {
  return status === "too-small"
}

// isFinishedStatus groups the terminal win/loss states together.
export function isFinishedStatus(
  status: GameStatus | PersistedGameStatus,
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
