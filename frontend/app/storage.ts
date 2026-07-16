import {
  CONFIG,
  STORE_BLEND_KEY,
  STORE_ENCODING_PREFIX,
} from "./config"
import { canPersistRoundStatus, isAgentApiMode } from "./status"
import { currentTotalCells } from "./traversal"
import type {
  AgentApiConfig,
  MazeControlModeName,
  PersistedPreferences,
  PersistedRound,
  PersistedSnapshot,
  State,
  WallWeight,
} from "./types"

const { runtime, timing } = CONFIG

// storageKey namespaces browser persistence per control mode so interactive and agent-api do not collide.
function storageKey(
  modeName: MazeControlModeName,
  suffix: string,
): string {
  return `tapoo.${modeName}.${suffix}`
}

// toBase64 converts raw bytes into a storage-safe browser string.
function toBase64(payloadBytes: Uint8Array): string {
  let binaryPayload = ""

  for (const payloadByte of payloadBytes) {
    binaryPayload += String.fromCharCode(payloadByte)
  }

  return window.btoa(binaryPayload)
}

// fromBase64 decodes stored browser payloads back into raw bytes.
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

// xorStoredPayload applies the lightweight reversible obfuscation used for browser storage.
function xorStoredPayload(payloadBytes: Uint8Array): Uint8Array {
  const passphraseBytes = new TextEncoder().encode(STORE_BLEND_KEY)
  const encodedBytes = new Uint8Array(payloadBytes.length)

  for (let index = 0; index < payloadBytes.length; index += 1) {
    encodedBytes[index] =
      payloadBytes[index] ^ passphraseBytes[index % passphraseBytes.length]
  }

  return encodedBytes
}

// encodeStoredPayload serializes and obfuscates values before persistence.
function encodeStoredPayload(value: unknown): string {
  const jsonPayload = JSON.stringify(value)
  const payloadBytes = new TextEncoder().encode(jsonPayload)
  return `${STORE_ENCODING_PREFIX}${toBase64(xorStoredPayload(payloadBytes))}`
}

// decodeStoredPayload reverses the browser storage encoding back into JSON.
function decodeStoredPayload<T>(encodedPayload: string): T | null {
  const payloadBytes = encodedPayload.startsWith(STORE_ENCODING_PREFIX)
    ? (() => {
        const encodedCipherText = encodedPayload.slice(STORE_ENCODING_PREFIX.length)
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

// isAgentApiConfig validates one persisted HTTP agent configuration.
function isAgentApiConfig(value: unknown): value is AgentApiConfig {
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    !("playerName" in value) ||
    !("model" in value) ||
    !("endpoint" in value) ||
    !("enabled" in value)
  ) {
    return false
  }

  const disabledReason =  "disabledReason" in value ? value.disabledReason : undefined
  const lastErrorAt = "lastErrorAt" in value ? value.lastErrorAt : undefined

  return (
    typeof value.id === "string" && value.id.length > 0 &&
    typeof value.playerName === "string" && value.playerName.length > 0 &&
    typeof value.model === "string" && value.model.length > 0 &&
    typeof value.endpoint === "string" && value.endpoint.length > 0 &&
    typeof value.enabled === "boolean" &&
    (disabledReason === undefined || disabledReason === "network-error") &&
    (
      lastErrorAt === undefined ||
      (typeof lastErrorAt === "number" && Number.isFinite(lastErrorAt))
    )
  )
}

// normalizeAgentApiConfigs keeps only valid configs and de-duplicates by stable id.
function normalizeAgentApiConfigs(configs: unknown): AgentApiConfig[] {
  if (!Array.isArray(configs)) {
    return []
  }

  const seenIds = new Set<string>()
  const normalizedConfigs: AgentApiConfig[] = []

  for (const config of configs) {
    if (!isAgentApiConfig(config) || seenIds.has(config.id)) {
      continue
    }

    seenIds.add(config.id)
    normalizedConfigs.push({ ...config })
  }

  return normalizedConfigs
}

// buildRoundSnapshot extracts the restorable round state from the live runtime.
function buildRoundSnapshot(state: State): PersistedRound | null {
  if (
    !state.mazeDimensions ||
    !state.maze ||
    !state.playerPosition ||
    state.traversalHistory.length === 0 ||
    !state.finalPosition ||
    !canPersistRoundStatus(state.status)
  ) {
    return null
  }

  const totalCells = currentTotalCells(state.mazeDimensions)
  const decayIntervalPerCellMs = isAgentApiMode(state.controlMode)
    ? timing.agentApiCoreDecayIntervalPerCellMs
    : timing.interactiveCoreDecayIntervalPerCellMs
  const remainingMs = state.clock
    ? state.clock.remaining()
    : totalCells * decayIntervalPerCellMs

  return {
    version: runtime.roundStorageVersion,
    level: state.level,
    mazeDimensions: {
      length: state.mazeDimensions.length,
      width: state.mazeDimensions.width,
    },
    maze: state.maze.map((row) => [...row]),
    startCell: {
      row: state.traversalHistory[0].row,
      col: state.traversalHistory[0].col,
    },
    traversalHistory: state.traversalHistory.map(({ playerName, row, col }) => ({
      playerName, row, col,
    })),
    playerPosition: {
      x: state.playerPosition.x,
      y: state.playerPosition.y,
    },
    finalPosition: {
      x: state.finalPosition.x,
      y: state.finalPosition.y,
    },
    wallWeight: state.wallWeight,
    status: state.status,
    score: state.score,
    lastRoundScore: state.lastRoundScore,
    remainingMs,
    winSummary: state.winSummary,
    scoreDecayUnits: state.scoreDecayUnits,
    agentRequestCount: state.agentRequestCount,
  }
}

// loadPersistedAgentConfigs restores the configurable HTTP agents for a control mode.
export function loadPersistedAgentConfigs(
  modeName: MazeControlModeName,
): AgentApiConfig[] {
  try {
    const storedConfigs = window.localStorage.getItem(
      storageKey(modeName, runtime.agentConfigsStorageSuffix),
    )
    if (!storedConfigs) {
      return []
    }

    return normalizeAgentApiConfigs(
      decodeStoredPayload<unknown>(storedConfigs),
    )
  } catch {
    return []
  }
}

// savePersistedAgentConfigs stores the configured HTTP agents separately from game progress.
export function savePersistedAgentConfigs(
  modeName: MazeControlModeName,
  configs: AgentApiConfig[],
): void {
  try {
    window.localStorage.setItem(
      storageKey(modeName, runtime.agentConfigsStorageSuffix),
      encodeStoredPayload(normalizeAgentApiConfigs(configs)),
    )
  } catch {
    // Ignore storage failures so agent configuration remains best-effort only.
  }
}

// disableAgentForNetworkError marks one transport-failing agent ineligible for later turns.
export function disableAgentForNetworkError(
  modeName: MazeControlModeName,
  failedAgent: AgentApiConfig,
): AgentApiConfig[] {
  const nextConfigs = loadPersistedAgentConfigs(modeName).map((agent) => {
    if (agent.id !== failedAgent.id) {
      return agent
    }

    const disabledAgent: AgentApiConfig = {
      ...agent,
      enabled: false,
      disabledReason: "network-error",
      lastErrorAt: Date.now(),
    }

    return disabledAgent
  })

  savePersistedAgentConfigs(modeName, nextConfigs)
  return nextConfigs
}

// clearPersistedAgentConfigs removes agent setup without touching game progress.
export function clearPersistedAgentConfigs(modeName: MazeControlModeName): void {
  try {
    window.localStorage.removeItem(
      storageKey(modeName, runtime.agentConfigsStorageSuffix),
    )
  } catch {
    // Ignore storage failures so clearing remains best-effort only.
  }
}

// savePreferences persists the long-lived browser preferences in local storage.
function savePreferences(
  modeName: MazeControlModeName,
  preferences: PersistedPreferences,
): void {
  try {
    window.localStorage.setItem(
      storageKey(modeName, "wallWeight"),
      encodeStoredPayload(preferences.wallWeight),
    )
    window.localStorage.setItem(
      storageKey(modeName, "level"),
      encodeStoredPayload(preferences.level),
    )
    window.localStorage.setItem(
      storageKey(modeName, "lastAttemptRetention"),
      encodeStoredPayload(preferences.lastAttemptRetention ?? null),
    )
    window.localStorage.setItem(
      storageKey(modeName, "bestWinRetention"),
      encodeStoredPayload(preferences.bestWinRetention ?? null),
    )
    window.localStorage.setItem(
      storageKey(modeName, "lastWinRequestCount"),
      encodeStoredPayload(preferences.lastWinRequestCount ?? null),
    )
    window.localStorage.setItem(
      storageKey(modeName, "bestWinRequestCount"),
      encodeStoredPayload(preferences.bestWinRequestCount ?? null),
    )
  } catch {
    // Ignore storage failures so durable browser preferences remain best-effort only.
  }
}

// loadPreferences restores browser preferences while validating their value ranges.
function loadPreferences(
  modeName: MazeControlModeName,
  defaultLevel: number,
  defaultWeight: WallWeight,
  isWallWeight: (value: number) => value is WallWeight,
): PersistedPreferences {
  try {
    const storedLevel = window.localStorage.getItem(storageKey(modeName, "level"))
    const storedWeight = window.localStorage.getItem(storageKey(modeName, "wallWeight"))
    const storedLastAttemptRetention = window.localStorage.getItem(
      storageKey(modeName, "lastAttemptRetention"),
    )
    const storedBestWinRetention = window.localStorage.getItem(
      storageKey(modeName, "bestWinRetention"),
    )
    const storedLastWinRequestCount = window.localStorage.getItem(
      storageKey(modeName, "lastWinRequestCount"),
    )
    const storedBestWinRequestCount = window.localStorage.getItem(
      storageKey(modeName, "bestWinRequestCount"),
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
    const parsedLastWinRequestCount =
      storedLastWinRequestCount === null
        ? null
        : decodeStoredPayload<number | null>(storedLastWinRequestCount)
    const parsedBestWinRequestCount =
      storedBestWinRequestCount === null
        ? null
        : decodeStoredPayload<number | null>(storedBestWinRequestCount)

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
      lastWinRequestCount:
        Number.isInteger(parsedLastWinRequestCount) &&
        parsedLastWinRequestCount >= 1
          ? parsedLastWinRequestCount
          : null,
      bestWinRequestCount:
        Number.isInteger(parsedBestWinRequestCount) &&
        parsedBestWinRequestCount >= 1
          ? parsedBestWinRequestCount
          : null,
    }
  } catch {
    return {
      level: defaultLevel,
      wallWeight: defaultWeight,
      lastAttemptRetention: null,
      bestWinRetention: null,
      lastWinRequestCount: null,
      bestWinRequestCount: null,
    }
  }
}

// saveRound persists the short-lived active round in session storage.
function saveRound(
  modeName: MazeControlModeName,
  round: PersistedRound | null,
): void {
  try {
    if (!round) {
      window.sessionStorage.removeItem(storageKey(modeName, "round"))
      return
    }

    window.sessionStorage.setItem(
      storageKey(modeName, "round"),
      encodeStoredPayload(round),
    )
  } catch {
    // Ignore storage failures so the active game can continue even without session persistence.
  }
}

// loadRound restores the current round snapshot and clears corrupt or stale payloads.
function loadRound(modeName: MazeControlModeName): PersistedRound | null {
  let rawSnapshot: string | null

  try {
    rawSnapshot = window.sessionStorage.getItem(storageKey(modeName, "round"))
  } catch {
    return null
  }

  if (!rawSnapshot) {
    return null
  }

  const snapshot = decodeStoredPayload<PersistedRound>(rawSnapshot)
  if (!snapshot) {
    clearPersistedRound(modeName)
    return null
  }

  if (snapshot.version !== runtime.roundStorageVersion) {
    clearPersistedSnapshot(modeName)
    return null
  }

  return snapshot
}

// loadPersistedSnapshot restores both browser preferences and the active round.
export function loadPersistedSnapshot(
  modeName: MazeControlModeName,
  defaultLevel: number,
  defaultWeight: WallWeight,
  isWallWeight: (value: number) => value is WallWeight,
): PersistedSnapshot {
  const round = loadRound(modeName)

  return {
    preferences: loadPreferences(
      modeName,
      defaultLevel,
      defaultWeight,
      isWallWeight,
    ),
    round,
  }
}

// saveGameProgress writes long-lived localStorage progress from the live game state.
export function saveGameProgress(
  modeName: MazeControlModeName,
  state: Pick<
    State,
    | "level"
    | "wallWeight"
    | "lastAttemptRetention"
    | "bestWinRetention"
    | "lastWinRequestCount"
    | "bestWinRequestCount"
  >,
): void {
  savePreferences(modeName, {
    level: state.level,
    wallWeight: state.wallWeight,
    lastAttemptRetention: state.lastAttemptRetention,
    bestWinRetention: state.bestWinRetention,
    lastWinRequestCount: state.lastWinRequestCount,
    bestWinRequestCount: state.bestWinRequestCount,
  })
}

// saveActiveRoundSnapshot writes the short-lived sessionStorage round snapshot.
export function saveActiveRoundSnapshot(
  modeName: MazeControlModeName,
  state: State,
): void {
  saveRound(modeName, buildRoundSnapshot(state))
}

// clearPersistedRound drops only the short-lived active round snapshot.
export function clearPersistedRound(modeName: MazeControlModeName): void {
  saveRound(modeName, null)
}

// clearPersistedSnapshot clears both long-lived preferences and the active round.
export function clearPersistedSnapshot(modeName: MazeControlModeName): void {
  try {
    window.localStorage.removeItem(storageKey(modeName, "level"))
    window.localStorage.removeItem(storageKey(modeName, "wallWeight"))
    window.localStorage.removeItem(storageKey(modeName, "lastAttemptRetention"))
    window.localStorage.removeItem(storageKey(modeName, "bestWinRetention"))
    window.localStorage.removeItem(storageKey(modeName, "lastWinRequestCount"))
    window.localStorage.removeItem(storageKey(modeName, "bestWinRequestCount"))
  } catch {
    // Ignore storage failures so reset remains best-effort only.
  }

  clearPersistedRound(modeName)
}
