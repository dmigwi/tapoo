import {
  CONFIG,
  STORE_BLEND_KEY,
  STORE_ENCODING_PREFIX,
} from "./config"
import { isAgentSeatId } from "./agent/seats"
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

const { agentConfig, runtime, timing } = CONFIG
const storageConfig = runtime.storage
const { agentApi: agentApiModeName, interactive: interactiveModeName } =
  runtime.controlModes

type PersistableProgressState = Pick<
  State,
  | "level"
  | "wallWeight"
  | "lastAttemptRetention"
  | "bestWinRetention"
  | "lastWinRequestCount"
  | "bestWinRequestCount"
>

type PersistedGameSetup = Pick<PersistedPreferences, "level" | "wallWeight">
type PersistedWinMetrics = Required<
  Pick<
    PersistedPreferences,
    | "lastAttemptRetention"
    | "bestWinRetention"
    | "lastWinRequestCount"
    | "bestWinRequestCount"
  >
>

// Shared storage helpers.

// storageKey namespaces browser persistence by mode and schema version so stale payloads are ignored.
function storageKey(
  modeName: MazeControlModeName,
  suffix: string,
): string {
  return `tapoo.v${storageConfig.version}.${modeName}.${suffix}`
}

// removeStaleStorageEntries clears old versioned Tapoo keys without touching current-version data.
function removeStaleStorageEntries(storage: Storage): void {
  const currentPrefix = `tapoo.v${storageConfig.version}.`

  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index)
    if (key?.startsWith("tapoo.v") && !key.startsWith(currentPrefix)) {
      storage.removeItem(key)
    }
  }
}

// clearStaleStorageVersions runs once during startup to discard obsolete browser storage versions.
export function clearStaleStorageVersions(): void {
  try {
    removeStaleStorageEntries(window.localStorage)
  } catch {
    // Ignore storage failures so startup can continue without browser persistence.
  }

  try {
    removeStaleStorageEntries(window.sessionStorage)
  } catch {
    // Ignore storage failures so startup can continue without browser persistence.
  }
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

// Agent API configuration persistence.

// hasValidAgentPlayerName enforces the compact label range used by the roster.
function hasValidAgentPlayerName(playerName: string): boolean {
  return (
    playerName.length >= agentConfig.playerNameMinLength &&
    playerName.length <= agentConfig.playerNameMaxLength
  )
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

  const disabledReason = "disabledReason" in value ? value.disabledReason : undefined
  const lastErrorAt = "lastErrorAt" in value ? value.lastErrorAt : undefined

  return (
    typeof value.id === "number" &&
    Number.isInteger(value.id) && value.id >= 1 &&
    typeof value.playerName === "string" &&
    hasValidAgentPlayerName(value.playerName.trim()) &&
    typeof value.model === "string" && value.model.length > 0 &&
    typeof value.endpoint === "string" && value.endpoint.length > 0 &&
    typeof value.enabled === "boolean" &&
    (disabledReason === undefined || disabledReason === "network-error") &&
    (lastErrorAt === undefined ||
      (typeof lastErrorAt === "number" && Number.isFinite(lastErrorAt)))
  )
}

// normalizeAgentApiConfigs keeps valid fixed-seat occupants without reassigning seat ids.
function normalizeAgentApiConfigs(configs: unknown): AgentApiConfig[] {
  if (!Array.isArray(configs)) {
    return []
  }

  const seenIds = new Set<number>()
  const seenPlayerNames = new Set<string>()
  const normalizedConfigs: AgentApiConfig[] = []

  for (const config of configs) {
    if (
      !isAgentApiConfig(config) ||
      !isAgentSeatId(config.id) ||
      seenIds.has(config.id)
    ) {
      continue
    }

    const playerName = config.playerName.trim()
    const playerNameKey = playerName.toLowerCase()
    if (seenPlayerNames.has(playerNameKey)) {
      continue
    }

    seenIds.add(config.id)
    seenPlayerNames.add(playerNameKey)
    normalizedConfigs.push({ ...config, playerName })
  }

  return normalizedConfigs.sort((left, right) => left.id - right.id)
}

// loadPersistedAgentApiConfigs restores the configurable HTTP agents for agent-api mode.
export function loadPersistedAgentApiConfigs(): AgentApiConfig[] {
  try {
    const storedConfigs = window.localStorage.getItem(
      storageKey(agentApiModeName, storageConfig.suffixes.agentConfigs),
    )
    if (!storedConfigs) {
      return []
    }

    const decodedConfigs = decodeStoredPayload<unknown>(storedConfigs)
    const normalizedConfigs = normalizeAgentApiConfigs(decodedConfigs)

    if (JSON.stringify(decodedConfigs) !== JSON.stringify(normalizedConfigs)) {
      savePersistedAgentApiConfigs(normalizedConfigs)
    }

    return normalizedConfigs
  } catch {
    return []
  }
}

// savePersistedAgentApiConfigs stores configured HTTP agents separately from game progress.
export function savePersistedAgentApiConfigs(configs: AgentApiConfig[]): void {
  try {
    window.localStorage.setItem(
      storageKey(agentApiModeName, storageConfig.suffixes.agentConfigs),
      encodeStoredPayload(normalizeAgentApiConfigs(configs)),
    )
  } catch {
    // Ignore storage failures so agent configuration remains best-effort only.
  }
}

// disableAgentApiConfigForNetworkError marks one transport-failing agent ineligible for later turns.
export function disableAgentApiConfigForNetworkError(
  failedAgent: AgentApiConfig,
): AgentApiConfig[] {
  const nextConfigs = loadPersistedAgentApiConfigs().map((agent) => {
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

  savePersistedAgentApiConfigs(nextConfigs)
  return nextConfigs
}

// clearPersistedAgentApiConfigs removes agent setup without touching game progress.
export function clearPersistedAgentApiConfigs(): void {
  try {
    window.localStorage.removeItem(
      storageKey(agentApiModeName, storageConfig.suffixes.agentConfigs),
    )
  } catch {
    // Ignore storage failures so clearing remains best-effort only.
  }
}

// Game progress preference persistence.

// validLevelPreference keeps invalid or stale setup data from escaping storage.
function validLevelPreference(value: unknown, defaultLevel: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : defaultLevel
}

// validWallWeightPreference keeps wall weights inside the currently supported set.
function validWallWeightPreference(
  value: unknown,
  defaultWeight: WallWeight,
  isWallWeight: (value: number) => value is WallWeight,
): WallWeight {
  return typeof value === "number" && isWallWeight(value) ? value : defaultWeight
}

// validRetentionPreference restores normalized retention values stored in millionths.
function validRetentionPreference(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1_000_000
    ? value
    : null
}

// validRequestCountPreference restores positive agent request counters.
function validRequestCountPreference(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : null
}

// savePreferences persists the long-lived browser preferences in local storage.
function savePreferences(
  modeName: MazeControlModeName,
  preferences: PersistedPreferences,
): void {
  const gameSetup: PersistedGameSetup = {
    level: preferences.level,
    wallWeight: preferences.wallWeight,
  }
  const winMetrics: PersistedWinMetrics = {
    lastAttemptRetention: preferences.lastAttemptRetention ?? null,
    bestWinRetention: preferences.bestWinRetention ?? null,
    lastWinRequestCount: preferences.lastWinRequestCount ?? null,
    bestWinRequestCount: preferences.bestWinRequestCount ?? null,
  }

  try {
    window.localStorage.setItem(
      storageKey(modeName, storageConfig.suffixes.gameSetup),
      encodeStoredPayload(gameSetup),
    )
    window.localStorage.setItem(
      storageKey(modeName, storageConfig.suffixes.winMetrics),
      encodeStoredPayload(winMetrics),
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
    const storedGameSetup = window.localStorage.getItem(
      storageKey(modeName, storageConfig.suffixes.gameSetup),
    )
    const storedWinMetrics = window.localStorage.getItem(
      storageKey(modeName, storageConfig.suffixes.winMetrics),
    )
    const parsedGameSetup =
      storedGameSetup === null
        ? null
        : decodeStoredPayload<Partial<PersistedGameSetup>>(storedGameSetup)
    const parsedWinMetrics =
      storedWinMetrics === null
        ? null
        : decodeStoredPayload<Partial<PersistedWinMetrics>>(storedWinMetrics)

    return {
      level: validLevelPreference(parsedGameSetup?.level, defaultLevel),
      wallWeight: validWallWeightPreference(
        parsedGameSetup?.wallWeight,
        defaultWeight,
        isWallWeight,
      ),
      lastAttemptRetention: validRetentionPreference(
        parsedWinMetrics?.lastAttemptRetention,
      ),
      bestWinRetention: validRetentionPreference(
        parsedWinMetrics?.bestWinRetention,
      ),
      lastWinRequestCount: validRequestCountPreference(
        parsedWinMetrics?.lastWinRequestCount,
      ),
      bestWinRequestCount: validRequestCountPreference(
        parsedWinMetrics?.bestWinRequestCount,
      ),
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

// saveGameProgress writes long-lived localStorage progress from the live game state.
export function saveGameProgress(
  modeName: MazeControlModeName,
  state: PersistableProgressState,
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

// saveInteractiveGameProgress writes long-lived localStorage progress for interactive mode.
export function saveInteractiveGameProgress(
  state: PersistableProgressState,
): void {
  saveGameProgress(interactiveModeName, state)
}

// saveAgentApiGameProgress writes long-lived localStorage progress for agent-api mode.
export function saveAgentApiGameProgress(state: PersistableProgressState): void {
  saveGameProgress(agentApiModeName, state)
}

// Active round persistence.

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
      playerName,
      row,
      col,
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

  return snapshot
}

// saveActiveRoundSnapshot writes the short-lived sessionStorage round snapshot.
export function saveActiveRoundSnapshot(
  modeName: MazeControlModeName,
  state: State,
): void {
  saveRound(modeName, buildRoundSnapshot(state))
}

// saveActiveInteractiveRoundSnapshot writes the short-lived interactive round snapshot.
export function saveActiveInteractiveRoundSnapshot(state: State): void {
  saveActiveRoundSnapshot(interactiveModeName, state)
}

// saveActiveAgentApiRoundSnapshot writes the short-lived agent-api round snapshot.
export function saveActiveAgentApiRoundSnapshot(state: State): void {
  saveActiveRoundSnapshot(agentApiModeName, state)
}

// clearPersistedRound drops only the short-lived active round snapshot.
export function clearPersistedRound(modeName: MazeControlModeName): void {
  saveRound(modeName, null)
}

// clearPersistedInteractiveRound drops only the interactive active round snapshot.
export function clearPersistedInteractiveRound(): void {
  clearPersistedRound(interactiveModeName)
}

// clearPersistedAgentApiRound drops only the agent-api active round snapshot.
export function clearPersistedAgentApiRound(): void {
  clearPersistedRound(agentApiModeName)
}

// Combined progress and round persistence.

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

// loadPersistedInteractiveSnapshot restores the interactive-mode preferences and active round.
export function loadPersistedInteractiveSnapshot(
  defaultLevel: number,
  defaultWeight: WallWeight,
  isWallWeight: (value: number) => value is WallWeight,
): PersistedSnapshot {
  return loadPersistedSnapshot(
    interactiveModeName,
    defaultLevel,
    defaultWeight,
    isWallWeight,
  )
}

// loadPersistedAgentApiSnapshot restores the agent-api preferences and active round.
export function loadPersistedAgentApiSnapshot(
  defaultLevel: number,
  defaultWeight: WallWeight,
  isWallWeight: (value: number) => value is WallWeight,
): PersistedSnapshot {
  return loadPersistedSnapshot(
    agentApiModeName,
    defaultLevel,
    defaultWeight,
    isWallWeight,
  )
}

// clearPersistedSnapshot clears both long-lived preferences and the active round.
export function clearPersistedSnapshot(modeName: MazeControlModeName): void {
  try {
    window.localStorage.removeItem(
      storageKey(modeName, storageConfig.suffixes.gameSetup),
    )
    window.localStorage.removeItem(
      storageKey(modeName, storageConfig.suffixes.winMetrics),
    )
  } catch {
    // Ignore storage failures so reset remains best-effort only.
  }

  clearPersistedRound(modeName)
}

// clearPersistedInteractiveSnapshot clears interactive preferences and the active round.
export function clearPersistedInteractiveSnapshot(): void {
  clearPersistedSnapshot(interactiveModeName)
}

// clearPersistedAgentApiSnapshot clears agent-api preferences and the active round.
export function clearPersistedAgentApiSnapshot(): void {
  clearPersistedSnapshot(agentApiModeName)
}
