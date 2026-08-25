import {
  CONFIG,
  STORE_BLEND_KEY,
  STORE_ENCODING_PREFIX,
} from "./config"
import {
  hasValidAgentPlayerName,
  isAgentApiProvider,
  isAgentReasoningEffort,
  normalizeAgentEndpoint,
} from "./agent/config"
import { isAgentSeatId } from "./agent/seats"
import { canPersistRoundStatus, hasActiveRoundState } from "./status"
import {
  cloneMazeDimensions,
  cloneMazeRows,
  cloneRenderGridPoint,
  cloneTraversalHistory,
  startCellFromTraversalHistory,
} from "./traversal"
import type {
  AgentApiConfig,
  AgentApiSeatConfig,
  AgentApiSessionMetrics,
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

// Agent API localStorage configuration persistence.

// normalizeAgentApiConfig validates persisted data and restores endpoint as a URL object.
function normalizeAgentApiConfig(value: unknown): AgentApiConfig | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("playerName" in value) ||
    !("model" in value) ||
    !("endpoint" in value)
  ) {
    return null
  }

  // api is deliberately not part of the required-key gate above: a record persisted before this
  // field existed must still load, not be dropped. An absent or unrecognized value coerces to
  // "ollama" (validAgentApiProvider), the same self-healing shape validWallWeightPreference uses —
  // the very next savePersistedAgentApiConfigs call then backfills it into storage for free.
  const apiValue = "api" in value ? value.api : undefined
  const api = isAgentApiProvider(apiValue) ? apiValue : "ollama"
  // reasoningEffort follows the same self-healing coercion as api just above, rather than
  // echoBackReasoning's optional-passthrough below: every agent always reasons at some concrete,
  // provider-valid level, so an absent, stale, or now-invalid-for-this-provider value (e.g. a
  // record saved under Anthropic's set, then the provider changed) coerces to that provider's
  // default instead of being dropped or left unvalidated.
  const reasoningEffortValue = "reasoningEffort" in value ? value.reasoningEffort : undefined
  const reasoningEffort = isAgentReasoningEffort(reasoningEffortValue) && agentConfig.reasoningEffortOptions[api].includes(reasoningEffortValue)
      ? reasoningEffortValue
      : agentConfig.reasoningEffortDefaults[api]
  // seatId was called id before agents needed an identity separate from the slot they sit in, and
  // the storage version was deliberately not bumped (that would rotate the key and starve the
  // legacy migration below of the very records it reads). So a record keyed the old way still
  // loads under the old name and is rewritten under the new one by the next save.
  const seatIdValue = "seatId" in value ? value.seatId : "id" in value ? value.id : undefined
  // sessionId self-heals like api above rather than gating the record: a config saved before this
  // field existed still loads, and gets stamped now. The stamp only has to be stable from this
  // point on, which the write-back in loadPersistedAgentApiConfigs guarantees — its normalized
  // output differs from what was decoded, so the backfilled value is persisted immediately.
  const sessionIdValue = "sessionId" in value ? value.sessionId : undefined
  const sessionId =
    typeof sessionIdValue === "number" && Number.isFinite(sessionIdValue) && sessionIdValue > 0
      ? sessionIdValue
      : Date.now()
  const credentialValue = "credential" in value ? value.credential : undefined
  const extraHeadersValue = "extraHeaders" in value ? value.extraHeaders : undefined
  const echoBackReasoningValue = "echoBackReasoning" in value ? value.echoBackReasoning : undefined
  const requestIntervalSecondsValue = "requestIntervalSeconds" in value ? value.requestIntervalSeconds : undefined
  const requestIntervalSeconds: number | null =
    requestIntervalSecondsValue === undefined
      ? timing.defaultAgentApiRequestIntervalSeconds
      : (typeof requestIntervalSecondsValue === "number" && Number.isInteger(requestIntervalSecondsValue) &&
          requestIntervalSecondsValue >= agentConfig.requestIntervalMinSeconds && 
          requestIntervalSecondsValue <= agentConfig.requestIntervalMaxSeconds)
        ? requestIntervalSecondsValue
        : null
  const endpointValue = value.endpoint
  const endpoint =
    endpointValue instanceof URL
      ? normalizeAgentEndpoint(endpointValue.href)
      : typeof endpointValue === "string"
        ? normalizeAgentEndpoint(endpointValue)
        : null

  if (
    typeof seatIdValue === "number" &&
    Number.isInteger(seatIdValue) && seatIdValue >= 1 &&
    typeof value.playerName === "string" &&
    hasValidAgentPlayerName(value.playerName.trim()) &&
    typeof value.model === "string" && value.model.length > 0 &&
    requestIntervalSeconds !== null &&
    endpoint !== null &&
    (credentialValue === undefined || typeof credentialValue === "string") &&
    (extraHeadersValue === undefined || typeof extraHeadersValue === "string") &&
    (echoBackReasoningValue === undefined || typeof echoBackReasoningValue === "boolean")
  ) {
    const credential = typeof credentialValue === "string" && credentialValue.length > 0 ? credentialValue : undefined
    const extraHeaders = typeof extraHeadersValue === "string" && extraHeadersValue.length > 0 ? extraHeadersValue : undefined

    return {
      seatId: seatIdValue,
      sessionId,
      playerName: value.playerName.trim(),
      model: value.model,
      endpoint,
      api,
      reasoningEffort,
      requestIntervalSeconds,
      ...(credential ? { credential } : {}),
      ...(extraHeaders ? { extraHeaders } : {}),
      ...(echoBackReasoningValue === true ? { echoBackReasoning: true } : {}),
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
      !isAgentSeatId(config.seatId) ||
      seenIds.has(config.seatId)
    ) {
      continue
    }

    const playerName = config.playerName.trim()
    const playerNameKey = playerName.toLowerCase()
    if (seenPlayerNames.has(playerNameKey)) {
      continue
    }

    seenIds.add(config.seatId)
    seenPlayerNames.add(playerNameKey)
    normalizedConfigs.push({ ...config, playerName })
  }

  return normalizedConfigs.sort((left, right) => left.seatId - right.seatId)
}

// migrateLegacyAgentSessionMetrics lifts the volatile counters older builds kept inside each
// localStorage agent config into this tab's sessionStorage. Those records predate sessionId, so
// each is stamped with the one normalizeAgentApiConfig just assigned to the same seat, keeping the
// migrated row valid against the config it came from. A record carrying no legacy `enabled` key was
// written by a current build and is skipped: without that gate every new tab would rewrite rows
// holding exactly what mergeAgentSessionMetrics already defaults to.
function migrateLegacyAgentSessionMetrics(
  decodedConfigs: unknown,
  normalizedConfigs: AgentApiConfig[],
): AgentApiSessionMetrics[] {
  if (!Array.isArray(decodedConfigs)) {
    return []
  }

  const sessionIdBySeatId = new Map(normalizedConfigs.map((config) => [config.seatId, config.sessionId] as const))

  return normalizeAgentSessionMetrics(
    decodedConfigs
      .filter((record): record is Record<string, unknown> =>
        typeof record === "object" && record !== null && "enabled" in record)
      .map((record) => {
        const seatId = (record.seatId ?? record.id) as number
        return { ...record, seatId, sessionId: sessionIdBySeatId.get(seatId) }
      }),
  )
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
    if (loadPersistedAgentSessionMetrics().length === 0) {
      const migratedStats = migrateLegacyAgentSessionMetrics(decodedConfigs, normalizedConfigs)
      if (migratedStats.length > 0) {
        savePersistedAgentSessionMetrics(migratedStats)
      }
    }

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

// AgentSessionIdentity is the pair that names one concrete agent instance: which seat it sits in,
// and which occupant of that seat it is. Every write into sessionStorage is keyed by both.
type AgentSessionIdentity = Pick<AgentApiConfig, "seatId" | "sessionId">

// disableAgentApiConfigForNetworkError marks one transport-failing agent ineligible for this session.
export function disableAgentApiConfigForNetworkError(failedAgent: AgentSessionIdentity): void {
  savePersistedAgentSessionMetrics(
    upsertAgentSessionMetric(loadPersistedAgentSessionMetrics(), failedAgent, (stat) => ({
      ...stat,
      enabled: false,
      disabledReason: "network-error" as const,
      lastErrorAt: Date.now(),
    })),
  )
}

// Agent API sessionStorage metric persistence.

// upsertAgentSessionMetric applies edit to this seat's row, creating one if the seat has none.
// Rows filed under the same seat id by a previous occupant are dropped rather than edited: they
// describe an agent that no longer exists, and inheriting them is exactly the cross-tab leak
// sessionId was added to close.
function upsertAgentSessionMetric(
  stats: AgentApiSessionMetrics[],
  agent: AgentSessionIdentity,
  edit: (stat: AgentApiSessionMetrics) => AgentApiSessionMetrics,
): AgentApiSessionMetrics[] {
  const ownStats = stats.filter((stat) => stat.seatId !== agent.seatId || stat.sessionId === agent.sessionId)
  if (!ownStats.some((stat) => stat.seatId === agent.seatId)) {
    return [...ownStats, edit({ seatId: agent.seatId, sessionId: agent.sessionId, enabled: false })]
  }

  return ownStats.map((stat) => (stat.seatId === agent.seatId ? edit(stat) : stat))
}

function normalizeAgentSessionMetric(value: unknown): AgentApiSessionMetrics | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("seatId" in value)
  ) {
    return null
  }

  const sessionIdValue = "sessionId" in value ? value.sessionId : undefined
  const enabledValue = "enabled" in value ? value.enabled : false
  const disabledReasonValue = "disabledReason" in value ? value.disabledReason : undefined
  const lastErrorAt = "lastErrorAt" in value ? value.lastErrorAt : undefined
  const gameLevel = "gameLevel" in value ? value.gameLevel : undefined
  const cumulativeRoundCount = "cumulativeRoundCount" in value ? value.cumulativeRoundCount : undefined
  const levelTurnCount = "levelTurnCount" in value ? value.levelTurnCount : undefined
  const turnCount = "turnCount" in value ? value.turnCount : undefined
  const decayUnitsCharged = "decayUnitsCharged" in value ? value.decayUnitsCharged : undefined

  if (
    typeof value.seatId === "number" &&
    isAgentSeatId(value.seatId) &&
    typeof sessionIdValue === "number" && Number.isFinite(sessionIdValue) && sessionIdValue > 0 &&
    typeof enabledValue === "boolean" &&
    (disabledReasonValue === undefined || disabledReasonValue === "network-error") &&
    (lastErrorAt === undefined || (typeof lastErrorAt === "number" && Number.isFinite(lastErrorAt))) &&
    (gameLevel === undefined || (typeof gameLevel === "number" && Number.isInteger(gameLevel) && gameLevel >= 0)) &&
    (cumulativeRoundCount === undefined || (typeof cumulativeRoundCount === "number" && Number.isInteger(cumulativeRoundCount) && cumulativeRoundCount >= 0)) &&
    (levelTurnCount === undefined || (typeof levelTurnCount === "number" && Number.isInteger(levelTurnCount) && levelTurnCount >= 0)) &&
    (turnCount === undefined || (typeof turnCount === "number" && Number.isInteger(turnCount) && turnCount >= 0)) &&
    (decayUnitsCharged === undefined || (typeof decayUnitsCharged === "number" && Number.isInteger(decayUnitsCharged) && decayUnitsCharged >= 0))
  ) {
    const disabledReason =
      !enabledValue && disabledReasonValue === "network-error"
        ? disabledReasonValue
        : undefined
    return {
      seatId: value.seatId,
      sessionId: sessionIdValue,
      enabled: enabledValue,
      ...(disabledReason ? { disabledReason } : {}),
      ...(disabledReason && typeof lastErrorAt === "number" ? { lastErrorAt } : {}),
      ...(typeof gameLevel === "number" ? { gameLevel } : {}),
      ...(typeof cumulativeRoundCount === "number" ? { cumulativeRoundCount } : {}),
      ...(typeof levelTurnCount === "number" ? { levelTurnCount } : {}),
      ...(typeof turnCount === "number" ? { turnCount } : {}),
      ...(typeof decayUnitsCharged === "number" ? { decayUnitsCharged } : {}),
    }
  }

  return null
}

function normalizeAgentSessionMetrics(stats: unknown): AgentApiSessionMetrics[] {
  if (!Array.isArray(stats)) {
    return []
  }

  const seenIds = new Set<number>()
  const normalizedStats: AgentApiSessionMetrics[] = []
  for (const rawStat of stats) {
    const stat = normalizeAgentSessionMetric(rawStat)
    if (!stat || seenIds.has(stat.seatId)) {
      continue
    }

    seenIds.add(stat.seatId)
    normalizedStats.push(stat)
  }

  return normalizedStats.sort((left, right) => left.seatId - right.seatId)
}

function loadPersistedAgentSessionMetrics(): AgentApiSessionMetrics[] {
  try {
    const storedStats = window.sessionStorage.getItem(
      storageKey(agentApiModeName, storageConfig.suffixes.sessionMetrics),
    )
    if (!storedStats) {
      return []
    }

    return normalizeAgentSessionMetrics(decodeStoredPayload<unknown>(storedStats))
  } catch {
    return []
  }
}

function savePersistedAgentSessionMetrics(stats: AgentApiSessionMetrics[]): void {
  try {
    window.sessionStorage.setItem(
      storageKey(agentApiModeName, storageConfig.suffixes.sessionMetrics),
      encodeStoredPayload(normalizeAgentSessionMetrics(stats)),
    )
  } catch {
    // Ignore storage failures so live agent stats remain best-effort only.
  }
}

function agentSessionMetricsFromRuntimeConfigs(configs: AgentApiSeatConfig[]): AgentApiSessionMetrics[] {
  return normalizeAgentSessionMetrics(configs)
}

function mergeAgentSessionMetrics(configs: AgentApiConfig[]): AgentApiSeatConfig[] {
  const storedStats = loadPersistedAgentSessionMetrics()
  const statsByAgentId = new Map(storedStats.map((stat) => [stat.seatId, stat] as const))
  const runtimeConfigs = configs.map((config) => {
    // A row applies only if it was filed against this exact occupant. A seat this tab never saw
    // deleted and refilled still holds its predecessor's row under the same id; falling back to
    // enabled: false there is what stops a brand-new agent from starting out live in this tab, or
    // being scored against the turns and decay its predecessor ran up.
    const stat = statsByAgentId.get(config.seatId)
    return stat && stat.sessionId === config.sessionId
      ? { ...config, ...stat }
      : { ...config, enabled: false }
  })

  // Pruning belongs on this read path rather than at the delete: the tab that removed a seat
  // clears only its own sessionStorage, so every other tab either notices the orphan here or
  // carries it forever. The write settles after one pass — every surviving row then matches a
  // live config, so the condition below stops firing.
  const liveAgents = new Set(configs.map((config) => `${config.seatId}:${config.sessionId}`))
  if (storedStats.some((stat) => !liveAgents.has(`${stat.seatId}:${stat.sessionId}`))) {
    savePersistedAgentSessionMetrics(agentSessionMetricsFromRuntimeConfigs(runtimeConfigs))
  }

  return runtimeConfigs
}

// resetAgentSessionAvailability starts or replaces this tab's volatile state for one seat. It is
// used when a user creates a fresh agent in a seat, so stale counters from an earlier occupant do
// not leak into the new runtime view.
export function resetAgentSessionAvailability(
  agent: AgentSessionIdentity,
  enabled: boolean,
): void {
  const existingStats = loadPersistedAgentSessionMetrics().filter((stat) => stat.seatId !== agent.seatId)
  savePersistedAgentSessionMetrics([...existingStats, { seatId: agent.seatId, sessionId: agent.sessionId, enabled }])
}

// updateAgentSessionAvailability edits only this tab's enabled/disabled state while preserving any
// current-round counters that belong to the same seat.
export function updateAgentSessionAvailability(
  agent: AgentSessionIdentity,
  enabled: boolean,
): void {
  savePersistedAgentSessionMetrics(
    upsertAgentSessionMetric(loadPersistedAgentSessionMetrics(), agent, (stat) => {
      // A manual toggle clears any network-error disable, so re-enabling a burnt agent is enough to
      // put it back in rotation without also wiping the round counters it has already earned.
      const nextStat = { ...stat, enabled }
      delete nextStat.disabledReason
      delete nextStat.lastErrorAt
      return nextStat
    }),
  )
}

// clearAgentSessionMetrics removes this tab's volatile state for a deleted seat, preventing a later
// occupant of the same seat id from inheriting stale availability or round counters.
export function clearAgentSessionMetrics(seatId: number): void {
  savePersistedAgentSessionMetrics(
    loadPersistedAgentSessionMetrics().filter((stat) => stat.seatId !== seatId),
  )
}

// loadAgentApiSeatConfigs overlays this tab's session metrics onto durable agent configs.
export function loadAgentApiSeatConfigs(): AgentApiSeatConfig[] {
  return mergeAgentSessionMetrics(loadPersistedAgentApiConfigs())
}

function isSameAgentRoundAttempt(
  agent: AgentApiSeatConfig,
  level: number,
  cumulativeRoundCount: number,
): boolean {
  return agent.gameLevel === level &&
    agent.cumulativeRoundCount === cumulativeRoundCount
}

// agentForCurrentRound returns an agent view whose volatile counters belong to this tab/round.
// It does not persist by itself; turn commits and fresh-round setup own those writes.
export function agentForCurrentRound(
  agent: AgentApiSeatConfig,
  level: number,
  cumulativeRoundCount: number,
  levelTurnCount: number,
): AgentApiSeatConfig {
  if (isSameAgentRoundAttempt(agent, level, cumulativeRoundCount)) {
    return agent
  }

  return {
    ...agent,
    gameLevel: level,
    cumulativeRoundCount,
    levelTurnCount,
    turnCount: 0,
    decayUnitsCharged: 0,
  }
}

// recordAgentTurnStats persists one agent's post-turn counters. levelTurnCount is synchronized to
// the round's completed turn count for every agent in the current attempt — a staleness signal only,
// not a per-agent count — while turnCount and decayUnitsCharged are each accumulated only for the
// agent that actually played, because neither State.turnCount nor state.scoreDecayUnits is split by
// seat: the former counts every agent's turns together, the latter is shared spend with no
// attribution to any individual agent.
//
// gameLevel and cumulativeRoundCount are required in the isSameAttempt check below — do not
// simplify this to cumulativeRoundCount alone. Reasoning:
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
//     stale decayUnitsCharged from a prior session, corrupting the batchEfficiencyLevel an agent
//     is scored against.
export function recordAgentTurnStats(
  turnAgent: AgentApiSeatConfig,
  level: number,
  cumulativeRoundCount: number,
  chargedDecayUnits: number,
  levelTurnCount: number,
): AgentApiSeatConfig {
  let updatedAgent: AgentApiSeatConfig = turnAgent
  let foundTurnAgent = false

  const nextConfigs = loadAgentApiSeatConfigs().map((agent) => {
    const isSameAttempt = isSameAgentRoundAttempt(agent, level, cumulativeRoundCount)
    const priorDecayUnitsCharged = isSameAttempt ? (agent.decayUnitsCharged ?? 0) : 0
    const priorTurnCount = isSameAttempt ? (agent.turnCount ?? 0) : 0
    const isTurnAgent = agent.seatId === turnAgent.seatId
    const nextAgent = {
      ...agent,
      gameLevel: level,
      cumulativeRoundCount,
      levelTurnCount,
      turnCount: priorTurnCount + (isTurnAgent ? 1 : 0),
      decayUnitsCharged: priorDecayUnitsCharged + (isTurnAgent ? chargedDecayUnits : 0),
    }

    if (isTurnAgent) {
      foundTurnAgent = true
      updatedAgent = nextAgent
    }

    return nextAgent
  })

  if (!foundTurnAgent) {
    const isSameAttempt = isSameAgentRoundAttempt(turnAgent, level, cumulativeRoundCount)
    updatedAgent = {
      ...turnAgent,
      gameLevel: level,
      cumulativeRoundCount,
      levelTurnCount,
      turnCount: (isSameAttempt ? (turnAgent.turnCount ?? 0) : 0) + 1,
      decayUnitsCharged: (isSameAttempt ? (turnAgent.decayUnitsCharged ?? 0) : 0) + chargedDecayUnits,
    }
  }

  // A turn agent missing from the roster was deleted while its request was in flight. Its updated
  // counters are still returned so this turn can finish reporting against them, but nothing is
  // written back: persisting a row for an agent that no longer has a config would recreate the
  // orphan mergeAgentSessionMetrics prunes, and hand it to whoever occupies the seat next.
  savePersistedAgentSessionMetrics(agentSessionMetricsFromRuntimeConfigs(nextConfigs))
  return updatedAgent
}

// resetAgentRoundStats rebinds every configured agent to a fresh round with zeroed per-round
// counters. Agent configs live in a separate storage namespace from game progress, so without this
// explicit reset a new level can briefly inherit stale turnCount/decayUnitsCharged until the first
// commit of the round overwrites them.
export function resetAgentRoundStats(
  level: number,
  cumulativeRoundCount: number,
): AgentApiSeatConfig[] {
  const nextConfigs = loadAgentApiSeatConfigs().map((agent) => ({
    ...agent,
    gameLevel: level,
    cumulativeRoundCount,
    levelTurnCount: 0,
    turnCount: 0,
    decayUnitsCharged: 0,
  }))

  savePersistedAgentSessionMetrics(agentSessionMetricsFromRuntimeConfigs(nextConfigs))
  return nextConfigs
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

// validWinMetricPair restores a last/best win metric pair together or not at all. Every writer
// sets both at once — resolveWinScore always returns both, a reset clears both — so a half-restored
// pair is a state gameplay can never produce. Keeping restore atomic means "no previous record"
// always implies "no best record" too, which is what lets the summary treat a first result as a
// new record without needing to describe a last-attempt-missing-but-best-present case.
function validWinMetricPair<LastKey extends string, BestKey extends string>(
  lastKey: LastKey,
  bestKey: BestKey,
  lastValue: unknown,
  bestValue: unknown,
  validate: (value: unknown) => number | null,
): Record<LastKey | BestKey, number | null> {
  const last = validate(lastValue)
  const best = validate(bestValue)
  const bothValid = last !== null && best !== null

  return {
    [lastKey]: bothValid ? last : null,
    [bestKey]: bothValid ? best : null,
  } as Record<LastKey | BestKey, number | null>
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

// validTraversalSpeedPreference restores stored traversal speed records. Zero is a legitimate
// stored value here, unlike the request counter this replaced: a round can finish having covered
// no new ground on its final charged units, so the floor is 0 rather than 1.
function validTraversalSpeedPreference(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
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
    lastWinTraversalSpeedUnits: preferences.lastWinTraversalSpeedUnits ?? null,
    bestWinTraversalSpeedUnits: preferences.bestWinTraversalSpeedUnits ?? null,
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
      ...validWinMetricPair(
        "lastAttemptRetentionUnits",
        "bestWinRetentionUnits",
        parsedWinMetrics?.lastAttemptRetentionUnits,
        parsedWinMetrics?.bestWinRetentionUnits,
        validRetentionUnitsPreference,
      ),
      ...validWinMetricPair(
        "lastWinTraversalSpeedUnits",
        "bestWinTraversalSpeedUnits",
        parsedWinMetrics?.lastWinTraversalSpeedUnits,
        parsedWinMetrics?.bestWinTraversalSpeedUnits,
        validTraversalSpeedPreference,
      ),
    }
  } catch {
    return {
      level: defaultLevel,
      wallWeight: defaultWeight,
      lastAttemptRetentionUnits: null,
      bestWinRetentionUnits: null,
      lastWinTraversalSpeedUnits: null,
      bestWinTraversalSpeedUnits: null,
    }
  }
}

// saveGameProgress writes long-lived localStorage progress from the live game state.
//
// gameSetup and winMetrics stay in localStorage deliberately, and are the one part of a round that
// tabs are meant to share. Agent availability and per-round counters moved to sessionStorage so two
// tabs can run separate games at once (see AgentApiSessionMetrics), but moving progress there too
// would isolate exactly what is worth comparing: the whole point of running a second game is to
// measure it against the first, and a best retention or traversal speed locked inside the tab that
// set it is a score nothing can be judged against.
export function saveGameProgress(
  modeName: MazeControlModeName,
  state: PersistableProgressState,
): void {
  savePreferences(modeName, {
    level: state.level,
    wallWeight: state.wallWeight,
    lastAttemptRetentionUnits: state.lastAttemptRetentionUnits,
    bestWinRetentionUnits: state.bestWinRetentionUnits,
    lastWinTraversalSpeedUnits: state.lastWinTraversalSpeedUnits,
    bestWinTraversalSpeedUnits: state.bestWinTraversalSpeedUnits,
  })
}

// Active round persistence.

// buildRoundSnapshot extracts the restorable round state from the live runtime.
function buildRoundSnapshot(state: State): PersistedRound | null {
  if (!hasActiveRoundState(state) || !canPersistRoundStatus(state.status)) {
    return null
  }

  const totalCells = state.mazeDimensions.area
  const remainingMs = state.clock ? state.clock.remaining() : totalCells * timing.interactiveDecayIntervalPerCellMs
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
    startPosition: cloneRenderGridPoint(state.startPosition),
    playerPosition: cloneRenderGridPoint(state.playerPosition),
    finalPosition: cloneRenderGridPoint(state.finalPosition),
    wallWeight: state.wallWeight,
    status: state.status,
    score: state.score,
    lastRoundScore: state.lastRoundScore,
    remainingMs,
    winSummary: state.winSummary,
    scoreDecayUnits: state.scoreDecayUnits,
    turnCount: state.turnCount,
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
  // No invariant check here: buildRoundSnapshot already refuses a round missing any of the fields
  // hasActiveRoundState requires, and storage cannot report one anyway — logs.ts imports storage,
  // so importing it back would be circular. game.ts owns the state and does the reporting.
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
