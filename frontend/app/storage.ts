import {
  BEST_WIN_RETENTION_STORAGE_KEY,
  LEVEL_STORAGE_KEY,
  LAST_ATTEMPT_RETENTION_STORAGE_KEY,
  ROUND_STORAGE_KEY,
  ROUND_STORAGE_VERSION,
  STORE_BLEND_KEY,
  STORE_ENCODING_PREFIX,
  WALL_WEIGHT_STORAGE_KEY,
} from "./config"
import { canPersistRoundStatus } from "./status"
import type {
  PersistedPreferences,
  PersistedRound,
  PersistedSnapshot,
  State,
  WallWeight,
} from "./types"

function toBase64(payloadBytes: Uint8Array): string {
  let binaryPayload = ""

  for (const payloadByte of payloadBytes) {
    binaryPayload += String.fromCharCode(payloadByte)
  }

  return window.btoa(binaryPayload)
}

function fromBase64(encodedPayload: string): Uint8Array | null {
  try {
    const binaryPayload = window.atob(encodedPayload)
    return Uint8Array.from(binaryPayload, (character) =>
      character.charCodeAt(0),
    )
  } catch {
    return null
  }
}

function xorStoredPayload(payloadBytes: Uint8Array): Uint8Array {
  const passphraseBytes = new TextEncoder().encode(STORE_BLEND_KEY)
  const encodedBytes = new Uint8Array(payloadBytes.length)

  for (let index = 0; index < payloadBytes.length; index += 1) {
    encodedBytes[index] =
      payloadBytes[index] ^ passphraseBytes[index % passphraseBytes.length]
  }

  return encodedBytes
}

function encodeStoredPayload(value: unknown): string {
  const jsonPayload = JSON.stringify(value)
  const payloadBytes = new TextEncoder().encode(jsonPayload)
  return `${STORE_ENCODING_PREFIX}${toBase64(xorStoredPayload(payloadBytes))}`
}

function decodeStoredPayload<T>(encodedPayload: string): T | null {
  const payloadBytes = encodedPayload.startsWith(STORE_ENCODING_PREFIX)
    ? (() => {
        const encodedCipherText = encodedPayload.slice(
          STORE_ENCODING_PREFIX.length,
        )
        const cipherText = fromBase64(encodedCipherText)
        if (!cipherText) {
          return null
        }

        return xorStoredPayload(cipherText)
      })()
    : fromBase64(encodedPayload)

  if (!payloadBytes) {
    return null
  }

  try {
    const jsonPayload = new TextDecoder().decode(payloadBytes)
    return JSON.parse(jsonPayload) as T
  } catch {
    return null
  }
}

function buildRoundSnapshot(state: State): PersistedRound | null {
  if (
    !state.dims ||
    !state.maze ||
    !state.playerPosition ||
    !state.finalPosition ||
    !canPersistRoundStatus(state.status)
  ) {
    return null
  }

  const totalCells = state.dims.length * state.dims.width
  const remainingMs = state.clock ? state.clock.remaining() : totalCells * 1000

  return {
    version: ROUND_STORAGE_VERSION,
    level: state.level,
    dims: { length: state.dims.length, width: state.dims.width },
    maze: state.maze.map((row) => [...row]),
    playerPosition: [state.playerPosition[0], state.playerPosition[1]],
    finalPosition: [state.finalPosition[0], state.finalPosition[1]],
    wallWeight: state.wallWeight,
    status: state.status,
    score: state.score,
    lastRoundScore: state.lastRoundScore,
    remainingMs,
    winSummary: state.winSummary,
  }
}

function savePreferences(preferences: PersistedPreferences): void {
  try {
    window.localStorage.setItem(
      WALL_WEIGHT_STORAGE_KEY,
      encodeStoredPayload(preferences.wallWeight),
    )
    window.localStorage.setItem(
      LEVEL_STORAGE_KEY,
      encodeStoredPayload(preferences.level),
    )
    window.localStorage.setItem(
      LAST_ATTEMPT_RETENTION_STORAGE_KEY,
      encodeStoredPayload(preferences.lastAttemptRetention ?? null),
    )
    window.localStorage.setItem(
      BEST_WIN_RETENTION_STORAGE_KEY,
      encodeStoredPayload(preferences.bestWinRetention ?? null),
    )
  } catch {
    // Ignore storage failures so durable browser preferences remain best-effort only.
  }
}

function loadPreferences(
  defaultLevel: number,
  defaultWeight: WallWeight,
  isWallWeight: (value: number) => value is WallWeight,
): PersistedPreferences {
  try {
    const storedLevel = window.localStorage.getItem(LEVEL_STORAGE_KEY)
    const storedWeight = window.localStorage.getItem(WALL_WEIGHT_STORAGE_KEY)
    const storedLastAttemptRetention = window.localStorage.getItem(
      LAST_ATTEMPT_RETENTION_STORAGE_KEY,
    )
    const storedBestWinRetention = window.localStorage.getItem(
      BEST_WIN_RETENTION_STORAGE_KEY,
    )
    const parsedLevel =
      storedLevel === null ? null : decodeStoredPayload<number>(storedLevel)
    const parsedWeight =
      storedWeight === null ? null : decodeStoredPayload<number>(storedWeight)
    const parsedLastAttemptRetention =
      storedLastAttemptRetention === null
        ? null
        : decodeStoredPayload<number | null>(storedLastAttemptRetention)
    const parsedBestWinRetention =
      storedBestWinRetention === null
        ? null
        : decodeStoredPayload<number | null>(storedBestWinRetention)

    return {
      level:
        Number.isInteger(parsedLevel) && parsedLevel >= 1
          ? parsedLevel
          : defaultLevel,
      wallWeight: isWallWeight(parsedWeight) ? parsedWeight : defaultWeight,
      lastAttemptRetention:
        Number.isFinite(parsedLastAttemptRetention) &&
        parsedLastAttemptRetention >= 0 &&
        parsedLastAttemptRetention <= 1_000_000
          ? parsedLastAttemptRetention
          : null,
      bestWinRetention:
        Number.isFinite(parsedBestWinRetention) &&
        parsedBestWinRetention >= 0 &&
        parsedBestWinRetention <= 1_000_000
          ? parsedBestWinRetention
          : null,
    }
  } catch {
    return {
      level: defaultLevel,
      wallWeight: defaultWeight,
      lastAttemptRetention: null,
      bestWinRetention: null,
    }
  }
}

function saveRound(round: PersistedRound | null): void {
  try {
    if (!round) {
      window.sessionStorage.removeItem(ROUND_STORAGE_KEY)
      return
    }

    window.sessionStorage.setItem(ROUND_STORAGE_KEY, encodeStoredPayload(round))
  } catch {
    // Ignore storage failures so the active game can continue even without session persistence.
  }
}

function loadRound(): PersistedRound | null {
  let rawSnapshot: string | null

  try {
    rawSnapshot = window.sessionStorage.getItem(ROUND_STORAGE_KEY)
  } catch {
    return null
  }

  if (!rawSnapshot) {
    return null
  }

  const snapshot = decodeStoredPayload<PersistedRound>(rawSnapshot)
  if (!snapshot) {
    clearPersistedRound()
  }

  return snapshot
}

export function loadPersistedSnapshot(
  defaultLevel: number,
  defaultWeight: WallWeight,
  isWallWeight: (value: number) => value is WallWeight,
): PersistedSnapshot {
  return {
    preferences: loadPreferences(defaultLevel, defaultWeight, isWallWeight),
    round: loadRound(),
  }
}

export function savePersistedPreferences(
  state: Pick<
    State,
    "level" | "wallWeight" | "lastAttemptRetention" | "bestWinRetention"
  >,
): void {
  savePreferences({
    level: state.level,
    wallWeight: state.wallWeight,
    lastAttemptRetention: state.lastAttemptRetention,
    bestWinRetention: state.bestWinRetention,
  })
}

export function savePersistedRoundState(state: State): void {
  saveRound(buildRoundSnapshot(state))
}

export function clearPersistedRound(): void {
  saveRound(null)
}

export function clearPersistedSnapshot(): void {
  try {
    window.localStorage.removeItem(LEVEL_STORAGE_KEY)
    window.localStorage.removeItem(WALL_WEIGHT_STORAGE_KEY)
    window.localStorage.removeItem(LAST_ATTEMPT_RETENTION_STORAGE_KEY)
    window.localStorage.removeItem(BEST_WIN_RETENTION_STORAGE_KEY)
  } catch {
    // Ignore storage failures so reset remains best-effort only.
  }

  clearPersistedRound()
}
