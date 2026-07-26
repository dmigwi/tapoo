import {
  CONFIG,
  STORE_BLEND_KEY,
  STORE_ENCODING_PREFIX,
} from "./config"
import { normalizeAgentEndpoint } from "./agent/config"
import { isAgentSeatId } from "./agent/seats"
import { canPersistRoundStatus, isAgentApiMode } from "./status"
import {
  cloneMazeDimensions,
  cloneMazeRows,
  cloneRenderGridPoint,
  cloneTraversalHistory,
  startCellFromTraversalHistory,
} from "./traversal"
import type {
  AgentApiConfig,
  MazeControlModeName,
  PersistedGameSetup,
  PersistedPreferences,
  PersistedRound,
  PersistedSnapshot,
  PersistedWinMetrics,
  State,
  WallWeight,
} from "./types"

const { agentConfig, runtime, scoring, timing } = CONFIG
const storageConfig = runtime.storage
const { agentApi: agentApiModeName } = runtime.controlModes

type PersistableProgressState = PersistedGameSetup & PersistedWinMetrics

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

// normalizeAgentApiConfig validates persisted data and restores endpoint as a URL object.
function normalizeAgentApiConfig(value: unknown): AgentApiConfig | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    !("playerName" in value) ||
    !("model" in value) ||
    !("endpoint" in value) ||
    !("enabled" in value)
  ) {
    return null
  }

  const disabledReasonValue = "disabledReason" in value ? value.disabledReason : undefined
  const lastErrorAt = "lastErrorAt" in value ? value.lastErrorAt : undefined
  const gameLevel = "gameLevel" in value ? value.gameLevel : undefined
  const requestsCount = "requestsCount" in value ? value.requestsCount : undefined
  const cumulativeRoundCount = "cumulativeRoundCount" in value ? value.cumulativeRoundCount : undefined
  const endpointValue = value.endpoint
  const endpoint =
    endpointValue instanceof URL
      ? normalizeAgentEndpoint(endpointValue.href)
      : typeof endpointValue === "string"
        ? normalizeAgentEndpoint(endpointValue)
        : null

  if (
    typeof value.id === "number" &&
    Number.isInteger(value.id) && value.id >= 1 &&
    typeof value.playerName === "string" &&
    hasValidAgentPlayerName(value.playerName.trim()) &&
    typeof value.model === "string" && value.model.length > 0 &&
    endpoint !== null && typeof value.enabled === "boolean" &&
    (disabledReasonValue === undefined || disabledReasonValue === "network-error") &&
    (lastErrorAt === undefined || (typeof lastErrorAt === "number" && Number.isFinite(lastErrorAt))) &&
    (gameLevel === undefined || (typeof gameLevel === "number" && Number.isInteger(gameLevel) && gameLevel >= 0)) &&
    (cumulativeRoundCount === undefined || (typeof cumulativeRoundCount === "number" && Number.isInteger(cumulativeRoundCount) && cumulativeRoundCount >= 0)) &&
    (requestsCount === undefined || (typeof requestsCount === "number" && Number.isInteger(requestsCount) && requestsCount >= 0))
  ) {
    const disabledReason = disabledReasonValue === "network-error" ? disabledReasonValue : undefined

    return {
      id: value.id,
      playerName: value.playerName.trim(),
      model: value.model,
      endpoint,
      enabled: value.enabled,
      ...(disabledReason ? { disabledReason } : {}),
      ...(typeof gameLevel === "number" ? { gameLevel } : {}),
      ...(typeof lastErrorAt === "number" ? { lastErrorAt } : {}),
      ...(typeof requestsCount === "number" ? { requestsCount } : {}),
      ...(typeof cumulativeRoundCount === "number" ? { cumulativeRoundCount } : {}),
    }
  }

  return null
}

// normalizeAgentApiConfigs keeps valid fixed-seat occupants without reassigning seat ids.
function normalizeAgentApiConfigs(configs: unknown): AgentApiConfig[] {
  if (!Array.isArray(configs)) {
    return []
  }

  const seenIds = new Set<number>()
  const seenPlayerNames = new Set<string>()
  const normalizedConfigs: AgentApiConfig[] = []

  for (const rawConfig of configs) {
    const config = normalizeAgentApiConfig(rawConfig)
    if (
      !config ||
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

// recordAgentTurnStats persists one agent's post-turn request count, resetting it when the
// current level or round no longer matches what requestsCount was last tracked against.
//
// Both gameLevel and cumulativeRoundCount are required in the isSameAttempt check below — do
// not simplify this to cumulativeRoundCount alone. Reasoning:
//   - Level alone can't tell a retry of the same level apart from continuing it, hence
//     cumulativeRoundCount.
//   - cumulativeRoundCount alone looks sufficient (it's a strictly increasing, never-reused
//     counter within one continuous session) but is NOT safe across a "Reset Progress":
//     clearPersistedSnapshot never touches the separate agentConfigs storage namespace, so an
//     agent's stored gameLevel/cumulativeRoundCount survive a reset untouched, while
//     state.cumulativeRoundCount restarts from 0 on the next page load (no persisted round to
//     restore it from). A later session can therefore legitimately reach the same
//     cumulativeRoundCount value an old, unrelated agent record already holds. gameLevel is
//     what catches that collision, since the new round's level will almost never match the
//     stale record's level. Dropping gameLevel would let a post-reset session silently inherit
//     a stale requestsCount from a prior session, corrupting the batchEfficiencyLevel an agent
//     is scored against.
export function recordAgentTurnStats(
  turnAgent: AgentApiConfig,
  level: number,
  cumulativeRoundCount: number,
): AgentApiConfig {
  let updatedAgent: AgentApiConfig = turnAgent

  const nextConfigs = loadPersistedAgentApiConfigs().map((agent) => {
    if (agent.id !== turnAgent.id) {
      return agent
    }

    const isSameAttempt = agent.gameLevel === level && agent.cumulativeRoundCount === cumulativeRoundCount
    const priorRequestsCount = isSameAttempt ? (agent.requestsCount ?? 0) : 0
    updatedAgent = {
      ...agent,
      gameLevel: level,
      cumulativeRoundCount,
      requestsCount: priorRequestsCount + 1,
    }

    return updatedAgent
  })

  savePersistedAgentApiConfigs(nextConfigs)
  return updatedAgent
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

// validRetentionUnitsPreference restores fixed-point retention units within the configured scale.
function validRetentionUnitsPreference(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= scoring.retentionFullScaleUnits
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
    lastAttemptRetentionUnits: preferences.lastAttemptRetentionUnits ?? null,
    bestWinRetentionUnits: preferences.bestWinRetentionUnits ?? null,
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
      lastAttemptRetentionUnits: validRetentionUnitsPreference(
        parsedWinMetrics?.lastAttemptRetentionUnits,
      ),
      bestWinRetentionUnits: validRetentionUnitsPreference(
        parsedWinMetrics?.bestWinRetentionUnits,
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
      lastAttemptRetentionUnits: null,
      bestWinRetentionUnits: null,
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
    lastAttemptRetentionUnits: state.lastAttemptRetentionUnits,
    bestWinRetentionUnits: state.bestWinRetentionUnits,
    lastWinRequestCount: state.lastWinRequestCount,
    bestWinRequestCount: state.bestWinRequestCount,
  })
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

  const totalCells = state.mazeDimensions.area
  const decayIntervalPerCellMs = isAgentApiMode(state.controlMode)
    ? timing.agentApiCoreDecayIntervalPerCellMs
    : timing.interactiveCoreDecayIntervalPerCellMs
  const remainingMs = state.clock
    ? state.clock.remaining()
    : totalCells * decayIntervalPerCellMs

  const startCell = startCellFromTraversalHistory(state.traversalHistory)
  if (!startCell) {
    return null
  }

  return {
    level: state.level,
    mazeDimensions: cloneMazeDimensions(state.mazeDimensions),
    maze: cloneMazeRows(state.maze),
    startCell,
    traversalHistory: cloneTraversalHistory(state.traversalHistory),
    playerPosition: cloneRenderGridPoint(state.playerPosition),
    finalPosition: cloneRenderGridPoint(state.finalPosition),
    wallWeight: state.wallWeight,
    status: state.status,
    score: state.score,
    lastRoundScore: state.lastRoundScore,
    remainingMs,
    winSummary: state.winSummary,
    scoreDecayUnits: state.scoreDecayUnits,
    agentRequestCount: state.agentRequestCount,
    cumulativeRoundCount: state.cumulativeRoundCount,
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

// clearPersistedRound drops only the short-lived active round snapshot.
export function clearPersistedRound(modeName: MazeControlModeName): void {
  saveRound(modeName, null)
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

// Tapoo log persistence. Logs are scoped to the browser tab session: they survive page reloads
// within the same tab but are discarded when the tab closes or tapooResetLogs is called.

// loadTapooLog restores buffered log entries that survived a page reload within the same tab.
export function loadTapooLog<T>(modeName: MazeControlModeName): T[] {
  try {
    const stored = window.sessionStorage.getItem(
      storageKey(modeName, storageConfig.suffixes.tapooLog),
    )
    return stored ? (decodeStoredPayload<T[]>(stored) ?? []) : []
  } catch {
    return []
  }
}

// saveTapooLog writes an arbitrary set of log entries to sessionStorage; used internally and
// when restoring a known snapshot (e.g. after filtering or migration).
export function saveTapooLog(modeName: MazeControlModeName, entries: unknown[]): void {
  try {
    window.sessionStorage.setItem(
      storageKey(modeName, storageConfig.suffixes.tapooLog),
      encodeStoredPayload(entries),
    )
  } catch {
    // Quota exceeded or storage unavailable — the in-memory count is still accurate.
  }
}

// appendTapooLogEntry reads the existing persisted entries, appends one new entry, and writes
// the result back. Only the count is kept in memory; the full payload lives in sessionStorage.
export function appendTapooLogEntry(modeName: MazeControlModeName, entry: unknown): void {
  saveTapooLog(modeName, [...loadTapooLog<unknown>(modeName), entry])
}

// clearTapooLog removes the persisted log snapshot from sessionStorage; called by tapooResetLogs
// so a deliberate reset clears both the in-memory buffer and its sessionStorage copy.
export function clearTapooLog(modeName: MazeControlModeName): void {
  try {
    window.sessionStorage.removeItem(
      storageKey(modeName, storageConfig.suffixes.tapooLog),
    )
  } catch {
    // ignore
  }
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
  clearTapooLog(modeName)
}
