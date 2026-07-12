import type { GameStatus, PersistedGameStatus } from "./types"

export function isRunningStatus(
  status: GameStatus | PersistedGameStatus,
): status is "running" {
  return status === "running"
}

export function isPausedStatus(
  status: GameStatus | PersistedGameStatus,
): status is "paused" {
  return status === "paused"
}

export function isWonStatus(
  status: GameStatus | PersistedGameStatus,
): status is "won" {
  return status === "won"
}

export function isLostStatus(
  status: GameStatus | PersistedGameStatus,
): status is "lost" {
  return status === "lost"
}

export function isTooSmallStatus(status: GameStatus): status is "too-small" {
  return status === "too-small"
}

export function isFinishedStatus(
  status: GameStatus | PersistedGameStatus,
): status is "won" | "lost" {
  return isWonStatus(status) || isLostStatus(status)
}

export function canPersistRoundStatus(
  status: GameStatus,
): status is PersistedGameStatus {
  return (
    isRunningStatus(status) ||
    isPausedStatus(status) ||
    isWonStatus(status) ||
    isLostStatus(status)
  )
}

export function canProceedStatus(status: GameStatus): boolean {
  return isPausedStatus(status) || isFinishedStatus(status)
}

export function canShowWallsStatus(status: GameStatus): boolean {
  return isPausedStatus(status) || isFinishedStatus(status)
}
