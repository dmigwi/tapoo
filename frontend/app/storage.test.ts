import { beforeEach, describe, expect, it, vi } from "vitest"

import { CONFIG, STORE_ENCODING_PREFIX } from "./config"
import {
  agentForCurrentRound,
  clearPersistedRound,
  clearPersistedSnapshot,
  clearStaleStorageVersions,
  disableAgentApiConfigForNetworkError,
  loadAgentApiSeatConfigs,
  loadPersistedAgentApiConfigs,
  loadPersistedSnapshot,
  recordAgentTurnStats,
  resetAgentSessionAvailability,
  resetAgentRoundStats,
  saveActiveRoundSnapshot,
  saveGameProgress,
  savePersistedAgentApiConfigs,
  staleStorageSummary,
} from "./storage"
// The real guard rather than a local copy: loadPersistedSnapshot takes it from its caller, so a copy
// here would let these tests keep accepting weights production had already stopped accepting.
import { isWallWeight } from "./traversal"
import type { State, TraversalHistoryEntry } from "./types"

const MODE = CONFIG.runtime.controlModes.interactive
const AGENT_MODE = CONFIG.runtime.controlModes.agentApi
const { agentConfigs, gameSetup, winMetrics } = CONFIG.runtime.storage.suffixes

function selfVisit(row: number, col: number): TraversalHistoryEntry {
  return { playerName: CONFIG.runtime.interactivePlayerName, row, col, openMoves: [], visitCount: 1 }
}

// storageKey mirrors the production per-mode browser storage naming.
function storageKey(suffix: string): string {
  return `tapoo.v${CONFIG.runtime.storage.version}.${MODE}.${suffix}`
}

// agentStorageKey mirrors the separate agent-api storage namespace.
function agentStorageKey(suffix: string): string {
  return `tapoo.v${CONFIG.runtime.storage.version}.${AGENT_MODE}.${suffix}`
}

function endpoint(path: string): URL {
  return new URL(path, "https://agents.example")
}

// versionedStorageKey builds explicit namespaces for storage-version cleanup tests.
function versionedStorageKey(
  version: number,
  mode: string,
  suffix: string,
): string {
  return `tapoo.v${version}.${mode}.${suffix}`
}

// createMemoryStorage provides a minimal Storage implementation for browser persistence tests.
function createMemoryStorage(): Storage {
  const values = new Map<string, string>()

  return {
    get length() {
      return values.size
    },
    clear() {
      values.clear()
    },
    getItem(key) {
      return values.get(key) ?? null
    },
    key(index) {
      return Array.from(values.keys())[index] ?? null
    },
    removeItem(key) {
      values.delete(key)
    },
    setItem(key, value) {
      values.set(key, value)
    },
  }
}

// createState builds a restorable runtime state for storage-oriented scenarios.
function createState(overrides: Partial<State> = {}): State {
  return {
    controlMode: CONFIG.runtime.controlModes.interactive,
    level: 4,
    restartLevel: 1,
    mazeDimensions: { numCols: 5, numRows: 5, area: 25 },
    maze: [
      ["|", "---", "|"],
      ["|", "   ", "|"],
      ["|", "---", "|"],
    ],
    startPosition: { x: 1, y: 1 },
    playerPosition: { x: 1, y: 1 },
    traversalHistory: [selfVisit(0, 0)],
    finalPosition: { x: 1, y: 1 },
    status: "running",
    score: 1200,
    lastRoundScore: 700,
    lastAttemptRetentionUnits: 700000,
    bestWinRetentionUnits: 820000,
    lastWinTraversalSpeedUnits: null,
    bestWinTraversalSpeedUnits: null,
    winSummary: "",
    wallWeight: 2,
    scoreDecayUnits: 0,
    turnCount: 0,
    cumulativeRoundCount: 0,
    clock: null,
    ...overrides,
  }
}

// These tests keep browser persistence resilient to corrupt and partial storage payloads.
describe("storage", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createMemoryStorage(),
    })
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: createMemoryStorage(),
    })

    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it("saves and reloads obfuscated frontend preferences", () => {
    saveGameProgress(MODE, {
      level: 8,
      wallWeight: 3,
      lastAttemptRetentionUnits: 710000,
      bestWinRetentionUnits: 840000,
      lastWinTraversalSpeedUnits: null,
      bestWinTraversalSpeedUnits: null,
    })

    const storedGameSetup = window.localStorage.getItem(storageKey(gameSetup))
    const storedWinMetrics = window.localStorage.getItem(storageKey(winMetrics))

    expect(storedGameSetup).toContain(STORE_ENCODING_PREFIX)
    expect(storedWinMetrics).toContain(STORE_ENCODING_PREFIX)
    expect(storedGameSetup).not.toBe(JSON.stringify({ level: 8, wallWeight: 3 }))

    const snapshot = loadPersistedSnapshot(MODE, 1, 1, isWallWeight)

    expect(snapshot.preferences).toEqual({
      level: 8,
      wallWeight: 3,
      lastAttemptRetentionUnits: 710000,
      bestWinRetentionUnits: 840000,
      lastWinTraversalSpeedUnits: null,
      bestWinTraversalSpeedUnits: null,
    })
  })

  it("saves and reloads configured agent api details separately from game progress", () => {
    savePersistedAgentApiConfigs([
      {
        seatId: 1,
        sessionId: 1_700_000_000_001,
        playerName: "Agent A",
        model: "llama3.2",
        endpoint: endpoint("/api/agents/a/move"),
        api: "ollama",
        requestIntervalSeconds: 45,
      },
      {
        seatId: 2,
        sessionId: 1_700_000_000_002,
        playerName: "Agent B",
        model: "gemma4",
        endpoint: endpoint("/api/agents/b/move"),
        api: "ollama",
      },
    ])

    const storedConfigs = window.localStorage.getItem(
      agentStorageKey(agentConfigs),
    )

    expect(storedConfigs).toContain(STORE_ENCODING_PREFIX)
    expect(storedConfigs).not.toContain("/api/agents/a/move")
    expect(loadPersistedAgentApiConfigs()).toEqual([
      {
        seatId: 1,
        sessionId: 1_700_000_000_001,
        playerName: "Agent A",
        model: "llama3.2",
        endpoint: endpoint("/api/agents/a/move"),
        api: "ollama",
        reasoningEffort: "none",
        requestIntervalSeconds: 45,
      },
      {
        seatId: 2,
        sessionId: 1_700_000_000_002,
        playerName: "Agent B",
        model: "gemma4",
        endpoint: endpoint("/api/agents/b/move"),
        api: "ollama",
        reasoningEffort: "none",
        requestIntervalSeconds: CONFIG.timing.defaultAgentApiRequestIntervalSeconds,
      },
    ])
    expect(loadAgentApiSeatConfigs()).toEqual([
      expect.objectContaining({ seatId: 1, enabled: false }),
      expect.objectContaining({ seatId: 2, enabled: false }),
    ])

    clearPersistedSnapshot(AGENT_MODE)
    expect(loadPersistedAgentApiConfigs()).toHaveLength(2)

    savePersistedAgentApiConfigs([])
    expect(loadPersistedAgentApiConfigs()).toEqual([])
  })

  it("never lets a refilled seat inherit the previous occupant's session metrics", () => {
    // The cross-tab case sessionId exists for. Another tab deletes seat 1 and creates a new agent
    // in it; this tab never saw either event, so its sessionStorage still holds a row filed under
    // seat 1 by the agent that is now gone.
    const previousOccupant = {
      seatId: 1,
      sessionId: 1_700_000_000_001,
      playerName: "Blue",
      model: "llama3.2",
      endpoint: endpoint("/api/agents/blue/move"),
      api: "ollama" as const,
    }
    savePersistedAgentApiConfigs([previousOccupant])
    resetAgentSessionAvailability(previousOccupant, true)
    recordAgentTurnStats(loadAgentApiSeatConfigs()[0], 3, 7, 4, 1)
    expect(loadAgentApiSeatConfigs()[0]).toMatchObject({
      enabled: true,
      decayUnitsCharged: 4,
    })

    // The other tab's delete-then-create, seen from here as nothing but a changed localStorage
    // record: same seat, new stamp.
    savePersistedAgentApiConfigs([
      { ...previousOccupant, sessionId: 1_700_000_000_999, playerName: "Red" },
    ])

    const [refilledSeat] = loadAgentApiSeatConfigs()
    expect(refilledSeat.playerName).toBe("Red")
    // Enabled would mean this tab starts predicting against Red's endpoint and credential without
    // anyone ever switching it on here; the counters would score Red on Blue's spend.
    expect(refilledSeat.enabled).toBe(false)
    expect(refilledSeat.decayUnitsCharged).toBeUndefined()
    expect(refilledSeat.turnCount).toBeUndefined()
  })

  it("keeps volatile session fields out of the durable localStorage record", () => {
    // Seat configs are saved straight from the merged runtime view at every call site in
    // control/agent.ts, so normalizeAgentApiConfig's explicit field list is the only thing keeping
    // per-tab state out of the bucket every tab shares. Assert it rather than assume it.
    savePersistedAgentApiConfigs([
      {
        seatId: 1,
        sessionId: 1_700_000_000_001,
        playerName: "Blue",
        model: "llama3.2",
        endpoint: endpoint("/api/agents/blue/move"),
        api: "ollama",
      },
    ])
    resetAgentSessionAvailability({ seatId: 1, sessionId: 1_700_000_000_001 }, true)
    recordAgentTurnStats(loadAgentApiSeatConfigs()[0], 3, 7, 4, 1)

    savePersistedAgentApiConfigs(loadAgentApiSeatConfigs())

    const durableRecord = loadPersistedAgentApiConfigs()[0] as Record<string, unknown>
    for (const volatileField of [
      "enabled",
      "disabledReason",
      "lastErrorAt",
      "gameLevel",
      "cumulativeRoundCount",
      "levelTurnCount",
      "turnCount",
      "decayUnitsCharged",
    ]) {
      expect(durableRecord).not.toHaveProperty(volatileField)
    }
  })

  it("backfills a pre-multi-provider agent record with the ollama default on load", () => {
    // Simulates a record saved by a build that predates the api field. Written directly to the
    // storage key as plain base64 JSON (no XOR layer, no AgentApiConfig typing) rather than through
    // savePersistedAgentApiConfigs, because that function normalizes on save — it would backfill
    // api before the payload ever reached storage, defeating the point of this test. Plain base64
    // is a real, currently-supported format: decodeStoredPayload falls back to it whenever a stored
    // value lacks the STORE_ENCODING_PREFIX.
    // Keyed id, not seatId, and carrying no sessionId: both fields postdate this record, so it also
    // exercises the legacy-name fallback and the sessionId backfill.
    const legacyRecord = {
      id: 1,
      playerName: "Legacy",
      model: "llama3.2",
      endpoint: endpoint("/api/agents/legacy/move").href,
      enabled: true,
    }
    const storedKey = agentStorageKey(agentConfigs)
    window.localStorage.setItem(storedKey, window.btoa(JSON.stringify([legacyRecord])))

    const loaded = loadPersistedAgentApiConfigs()
    expect(loaded).toEqual([
      {
        seatId: legacyRecord.id,
        // Stamped at load time, so only its presence and shape can be asserted here.
        sessionId: expect.any(Number) as number,
        playerName: legacyRecord.playerName,
        model: legacyRecord.model,
        endpoint: endpoint("/api/agents/legacy/move"),
        api: "ollama",
        reasoningEffort: "none",
        requestIntervalSeconds: CONFIG.timing.defaultAgentApiRequestIntervalSeconds,
      },
    ])

    // The self-healing rewrite (loadPersistedAgentApiConfigs's JSON.stringify diff check) must have
    // backfilled storage, not just the in-memory return value, so a second load is unaffected by a
    // pre-api record no longer being present at all.
    const storedAfterLoad = window.localStorage.getItem(storedKey)
    expect(storedAfterLoad).not.toBeNull()
    expect(storedAfterLoad).toContain(STORE_ENCODING_PREFIX)
    expect(loadPersistedAgentApiConfigs()).toEqual(loaded)
  })

  it("drops an agent record with an explicitly invalid request interval instead of rewriting it", () => {
    const invalidRecord = {
      seatId: 1,
      sessionId: 1_700_000_000_001,
      playerName: "Broken",
      model: "llama3.2",
      endpoint: endpoint("/api/agents/broken/move").href,
      api: "ollama",
      requestIntervalSeconds: CONFIG.agentConfig.requestIntervalMaxSeconds + 1,
      enabled: true,
    }
    window.localStorage.setItem(
      agentStorageKey(agentConfigs),
      window.btoa(JSON.stringify([invalidRecord])),
    )

    expect(loadPersistedAgentApiConfigs()).toEqual([])
  })

  it("normalizes fixed agent seats without reassigning occupied slots", () => {
    // One config beyond maxSeats, so the excess (highest id) has to be dropped rather than
    // reassigned into an earlier gap — the behavior this test's name asserts.
    const models = ["llama3.2", "gemma4", "qwen3", "mistral", "deepseek", "phi4"]
    const oversizedConfigs = Array.from(
      { length: CONFIG.agentConfig.maxSeats + 1 },
      (_, index) => {
        const seatId = index + 1
        return {
          seatId,
          sessionId: 1_700_000_000_000 + seatId,
          playerName: `Aseat${seatId}`,
          model: models[index % models.length],
          endpoint: endpoint(`/api/agents/${seatId}/move`),
          api: "ollama" as const,
        }
      },
    )

    savePersistedAgentApiConfigs(oversizedConfigs)

    const survivingConfigs = oversizedConfigs.slice(0, CONFIG.agentConfig.maxSeats)
    expect(loadPersistedAgentApiConfigs().map((agent) => agent.playerName)).toEqual(
      survivingConfigs.map((config) => config.playerName),
    )
    expect(loadPersistedAgentApiConfigs().map((agent) => agent.seatId)).toEqual(
      survivingConfigs.map((config) => config.seatId),
    )
  })

  it("normalizes oversized enabled agents by removing the highest excess seats", () => {
    const oversizedConfigs = Array.from(
      { length: CONFIG.agentConfig.maxSeats + 1 },
      (_, index) => ({
        seatId: index + 1,
        sessionId: 1_700_000_000_000 + index + 1,
        playerName: `A${index + 1}bot`,
        model: "llama3.2",
        endpoint: endpoint(`/api/agents/${index + 1}/move`),
        api: "ollama" as const,
      }),
    )

    savePersistedAgentApiConfigs(oversizedConfigs)

    expect(loadPersistedAgentApiConfigs().map((agent) => agent.playerName)).toEqual(
      oversizedConfigs
        .slice(0, CONFIG.agentConfig.maxSeats)
        .map((config) => config.playerName),
    )
  })

  it("saves and reloads agent api progress in the agent storage namespace", () => {
    saveGameProgress(AGENT_MODE, {
      level: 6,
      wallWeight: 2,
      lastAttemptRetentionUnits: 640000,
      bestWinRetentionUnits: 760000,
      lastWinTraversalSpeedUnits: 8,
      bestWinTraversalSpeedUnits: 5,
    })

    expect(window.localStorage.getItem(agentStorageKey(gameSetup))).toContain(
      STORE_ENCODING_PREFIX,
    )
    expect(window.localStorage.getItem(storageKey(gameSetup))).toBeNull()

    const snapshot = loadPersistedSnapshot(AGENT_MODE, 1, 1, isWallWeight)

    expect(snapshot.preferences).toEqual({
      level: 6,
      wallWeight: 2,
      lastAttemptRetentionUnits: 640000,
      bestWinRetentionUnits: 760000,
      lastWinTraversalSpeedUnits: 8,
      bestWinTraversalSpeedUnits: 5,
    })
  })

  it("disables one network-failed agent without touching the others", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_725_000_000_001)
    savePersistedAgentApiConfigs([
      {
        seatId: 1,
        sessionId: 1_700_000_000_001,
        playerName: "Agent A",
        model: "llama3.2",
        endpoint: endpoint("/api/agents/a/move"),
        api: "ollama",
      },
      {
        seatId: 2,
        sessionId: 1_700_000_000_002,
        playerName: "Agent B",
        model: "gemma4",
        endpoint: endpoint("/api/agents/b/move"),
        api: "ollama",
      },
    ])
    resetAgentSessionAvailability({ seatId: 1, sessionId: 1_700_000_000_001 }, true)
    resetAgentSessionAvailability({ seatId: 2, sessionId: 1_700_000_000_002 }, true)

    disableAgentApiConfigForNetworkError({ seatId: 2, sessionId: 1_700_000_000_002 })

    expect(loadAgentApiSeatConfigs()).toEqual([
      {
        seatId: 1,
        sessionId: 1_700_000_000_001,
        playerName: "Agent A",
        model: "llama3.2",
        endpoint: endpoint("/api/agents/a/move"),
        api: "ollama",
        reasoningEffort: "none",
        requestIntervalSeconds: CONFIG.timing.defaultAgentApiRequestIntervalSeconds,
        enabled: true,
      },
      {
        seatId: 2,
        sessionId: 1_700_000_000_002,
        playerName: "Agent B",
        model: "gemma4",
        endpoint: endpoint("/api/agents/b/move"),
        api: "ollama",
        reasoningEffort: "none",
        requestIntervalSeconds: CONFIG.timing.defaultAgentApiRequestIntervalSeconds,
        enabled: false,
        disabledReason: "network-error",
        lastErrorAt: 1_725_000_000_001,
      },
    ])
    const stableConfigs = loadPersistedAgentApiConfigs()
    expect(stableConfigs).toHaveLength(2)
    for (const stableConfig of stableConfigs) {
      expect(stableConfig).not.toHaveProperty("enabled")
    }
  })

  it("syncs round levelTurnCount for every seat while turnCount and decayUnitsCharged only accumulate for the playing agent", () => {
    savePersistedAgentApiConfigs([
      {
        seatId: 1,
        sessionId: 1_700_000_000_001,
        playerName: "Blue",
        model: "llama3.2",
        endpoint: endpoint("/api/agents/blue/move"),
        api: "ollama",
      },
      {
        seatId: 2,
        sessionId: 1_700_000_000_002,
        playerName: "Red",
        model: "llama3.2",
        endpoint: endpoint("/api/agents/red/move"),
        api: "ollama",
      },
    ])

    // A clean turn costs 1 decay unit; a turn that hit an invalid move costs 3. Requests count
    // one per turn either way, so the two counters deliberately diverge.
    const storedConfigsBeforeTurns = window.localStorage.getItem(agentStorageKey(agentConfigs))
    const firstTurnAgent = recordAgentTurnStats(loadAgentApiSeatConfigs()[0], 3, 7, 1, 1)
    expect(firstTurnAgent).toMatchObject({
      gameLevel: 3, cumulativeRoundCount: 7, levelTurnCount: 1, turnCount: 1, decayUnitsCharged: 1,
    })
    // Red never played: its own turnCount and decayUnitsCharged stay at zero, but levelTurnCount
    // still syncs to the round's shared total — that field is a staleness signal, not a per-agent count.
    expect(loadAgentApiSeatConfigs()[1]).toMatchObject({
      gameLevel: 3, cumulativeRoundCount: 7, levelTurnCount: 1, turnCount: 0, decayUnitsCharged: 0,
    })

    const secondTurnAgent = recordAgentTurnStats(loadAgentApiSeatConfigs()[0], 3, 7, 3, 2)
    expect(secondTurnAgent).toMatchObject({
      gameLevel: 3, cumulativeRoundCount: 7, levelTurnCount: 2, turnCount: 2, decayUnitsCharged: 4,
    })
    expect(loadAgentApiSeatConfigs()[0]).toMatchObject({ levelTurnCount: 2, turnCount: 2, decayUnitsCharged: 4 })
    expect(loadAgentApiSeatConfigs()[1]).toMatchObject({ levelTurnCount: 2, turnCount: 0, decayUnitsCharged: 0 })
    expect(window.localStorage.getItem(agentStorageKey(agentConfigs))).toBe(storedConfigsBeforeTurns)
  })

  it("resets stale counters before using an agent in a different current round", () => {
    const staleRoundAgent = {
      seatId: 1,
      sessionId: 1_700_000_000_001,
      playerName: "Blue",
      model: "llama3.2",
      endpoint: endpoint("/api/agents/blue/move"),
      api: "ollama" as const,
      enabled: true,
      gameLevel: 3,
      cumulativeRoundCount: 7,
      levelTurnCount: 4,
      turnCount: 4,
      decayUnitsCharged: 9,
    }

    const currentRoundAgent = agentForCurrentRound(staleRoundAgent, 3, 8, 2)

    expect(currentRoundAgent).toMatchObject({
      gameLevel: 3,
      cumulativeRoundCount: 8,
      levelTurnCount: 2,
      turnCount: 0,
      decayUnitsCharged: 0,
    })
  })

  it("resets both counters when the level changes", () => {
    savePersistedAgentApiConfigs([
      {
        seatId: 1,
        sessionId: 1_700_000_000_001,
        playerName: "Blue",
        model: "llama3.2",
        endpoint: endpoint("/api/agents/blue/move"),
        api: "ollama",
      },
    ])
    recordAgentTurnStats(loadAgentApiSeatConfigs()[0], 3, 7, 12, 5)

    const nextLevelAgent = recordAgentTurnStats(loadAgentApiSeatConfigs()[0], 4, 7, 1, 1)

    expect(nextLevelAgent).toMatchObject({
      gameLevel: 4, cumulativeRoundCount: 7, turnCount: 1, decayUnitsCharged: 1,
    })
  })

  it("resets both counters when the level is retried in a new round (level unchanged, cumulativeRoundCount changed)", () => {
    savePersistedAgentApiConfigs([
      {
        seatId: 1,
        sessionId: 1_700_000_000_001,
        playerName: "Blue",
        model: "llama3.2",
        endpoint: endpoint("/api/agents/blue/move"),
        api: "ollama",
      },
    ])
    recordAgentTurnStats(loadAgentApiSeatConfigs()[0], 3, 7, 12, 5)

    const retryAgent = recordAgentTurnStats(loadAgentApiSeatConfigs()[0], 3, 8, 1, 1)

    expect(retryAgent).toMatchObject({
      gameLevel: 3, cumulativeRoundCount: 8, turnCount: 1, decayUnitsCharged: 1,
    })
  })

  it("resets both counters when a post-reset cumulativeRoundCount collides with a stale pre-reset value", () => {
    // "Reset Progress" (clearPersistedSnapshot) never touches the agentConfigs storage
    // namespace, so this agent's record survives untouched from a prior session where it
    // last played level 5. state.cumulativeRoundCount restarts from 0 after the reset, so a
    // later session can legitimately reach cumulativeRoundCount 12 again — the same value
    // this stale record already holds, purely by coincidence.
    savePersistedAgentApiConfigs([
      {
        seatId: 1,
        sessionId: 1_700_000_000_001,
        playerName: "Blue",
        model: "llama3.2",
        endpoint: endpoint("/api/agents/blue/move"),
        api: "ollama",
      },
    ])
    recordAgentTurnStats(loadAgentApiSeatConfigs()[0], 5, 12, 25, 9)

    // New session, different level, but the round counter happens to collide.
    const postResetAgent = recordAgentTurnStats(loadAgentApiSeatConfigs()[0], 1, 12, 1, 1)

    // Must NOT inherit the stale turnCount: 9 or decayUnitsCharged: 25 — gameLevel differing
    // (1 vs 5) is what catches this. If recordAgentTurnStats is ever "simplified" to compare only
    // cumulativeRoundCount, these assertions will fail.
    expect(postResetAgent).toMatchObject({
      gameLevel: 1, cumulativeRoundCount: 12, turnCount: 1, decayUnitsCharged: 1,
    })
  })

  it("clears all agent round counters when a fresh round starts", () => {
    savePersistedAgentApiConfigs([
      {
        seatId: 1,
        sessionId: 1_700_000_000_001,
        playerName: "Blue",
        model: "llama3.2",
        endpoint: endpoint("/api/agents/blue/move"),
        api: "ollama",
      },
      {
        seatId: 2,
        sessionId: 1_700_000_000_002,
        playerName: "Red",
        model: "llama3.2",
        endpoint: endpoint("/api/agents/red/move"),
        api: "ollama",
      },
    ])
    recordAgentTurnStats(loadAgentApiSeatConfigs()[0], 2, 8, 9, 4)
    recordAgentTurnStats(loadAgentApiSeatConfigs()[1], 2, 8, 2, 4)
    const storedConfigsBeforeReset = window.localStorage.getItem(agentStorageKey(agentConfigs))

    const nextConfigs = resetAgentRoundStats(3, 9)

    expect(nextConfigs).toEqual([
      expect.objectContaining({
        seatId: 1,
        sessionId: 1_700_000_000_001,
        gameLevel: 3,
        cumulativeRoundCount: 9,
        levelTurnCount: 0,
        turnCount: 0,
        decayUnitsCharged: 0,
      }),
      expect.objectContaining({
        seatId: 2,
        sessionId: 1_700_000_000_002,
        gameLevel: 3,
        cumulativeRoundCount: 9,
        levelTurnCount: 0,
        turnCount: 0,
        decayUnitsCharged: 0,
      }),
    ])
    expect(loadAgentApiSeatConfigs()).toEqual(nextConfigs)
    expect(window.localStorage.getItem(agentStorageKey(agentConfigs))).toBe(storedConfigsBeforeReset)
  })

  it("saves and reloads the active round state", () => {
    const state = createState({
      playerPosition: { x: 1, y: 1 },
      finalPosition: { x: 1, y: 1 },
    })

    saveActiveRoundSnapshot(MODE, state)

    const snapshot = loadPersistedSnapshot(MODE, 1, 1, isWallWeight)

    expect(snapshot.round).toEqual({
      level: 4,
      mazeDimensions: { numCols: 5, numRows: 5, area: 25 },
      maze: state.maze,
      startCell: { row: 0, col: 0 },
      traversalHistory: [selfVisit(0, 0)],
      startPosition: { x: 1, y: 1 },
      playerPosition: { x: 1, y: 1 },
      finalPosition: { x: 1, y: 1 },
      wallWeight: 2,
      status: "running",
      score: 1200,
      lastRoundScore: 700,
      winSummary: "",
      // The floor travels inside the round snapshot rather than under a key of its own.
      restartLevel: 1,
      remainingMs: 25_000,
      scoreDecayUnits: 0,
      turnCount: 0,
      cumulativeRoundCount: 0,
    })
  })

  it("falls back to defaults and clears unreadable stored state", () => {
    window.localStorage.setItem(storageKey(gameSetup), "not-base64")
    window.localStorage.setItem(storageKey(winMetrics), "not-base64")
    window.sessionStorage.setItem(storageKey("round"), "not-base64")

    const snapshot = loadPersistedSnapshot(MODE, 2, 1, isWallWeight)

    expect(snapshot.preferences).toEqual({
      level: 2,
      wallWeight: 1,
      lastAttemptRetentionUnits: null,
      bestWinRetentionUnits: null,
      lastWinTraversalSpeedUnits: null,
      bestWinTraversalSpeedUnits: null,
    })
    expect(snapshot.round).toBeNull()
    expect(window.sessionStorage.getItem(storageKey("round"))).toBeNull()
  })

  it("drops a win metric pair when only one half survives validation", () => {
    // Gameplay never produces a half-set pair: resolveWinScore writes both, a reset clears both.
    // A pair can only arrive split from corrupted storage, and restoring it split would resurrect
    // the impossible "no previous attempt, but a stored best" state the win summary has no wording
    // for — with no previous record, any result is by definition a new record.
    // Written through the real encoder so the test exercises production decoding; the values are
    // out of range rather than the wrong type, which is what a tampered record looks like.
    saveGameProgress(MODE, {
      level: 2,
      wallWeight: 1,
      lastAttemptRetentionUnits: -1, // below zero, so it fails validation
      bestWinRetentionUnits: 840000, // valid on its own
      lastWinTraversalSpeedUnits: 2_000, // valid on its own
      bestWinTraversalSpeedUnits: -5, // below zero, so it fails validation
    })

    const snapshot = loadPersistedSnapshot(MODE, 1, 1, isWallWeight)

    // Each pair is discarded as a unit: the valid half is dropped alongside the invalid one.
    expect(snapshot.preferences.bestWinRetentionUnits).toBeNull()
    expect(snapshot.preferences.lastAttemptRetentionUnits).toBeNull()
    expect(snapshot.preferences.lastWinTraversalSpeedUnits).toBeNull()
    expect(snapshot.preferences.bestWinTraversalSpeedUnits).toBeNull()
  })

  it("restores a win metric pair when both halves are valid", () => {
    saveGameProgress(MODE, {
      level: 2,
      wallWeight: 1,
      lastAttemptRetentionUnits: 710000,
      bestWinRetentionUnits: 840000,
      lastWinTraversalSpeedUnits: 1_500,
      bestWinTraversalSpeedUnits: 2_500,
    })

    const snapshot = loadPersistedSnapshot(MODE, 1, 1, isWallWeight)

    expect(snapshot.preferences).toMatchObject({
      lastAttemptRetentionUnits: 710000,
      bestWinRetentionUnits: 840000,
      lastWinTraversalSpeedUnits: 1_500,
      bestWinTraversalSpeedUnits: 2_500,
    })
  })

  it("reports what an older version left behind without reading any of it", () => {
    const currentVersion = CONFIG.runtime.storage.version
    window.localStorage.setItem(versionedStorageKey(currentVersion, MODE, gameSetup), "current")
    window.localStorage.setItem(versionedStorageKey(currentVersion + 1, MODE, gameSetup), "old")
    window.localStorage.setItem(versionedStorageKey(currentVersion + 1, MODE, winMetrics), "old")
    window.sessionStorage.setItem(versionedStorageKey(currentVersion + 2, MODE, "round"), "older")

    // Counts both stores, ignores the current version, and lists each stale version once.
    expect(staleStorageSummary()).toEqual({
      versions: [String(currentVersion + 1), String(currentVersion + 2)].sort(),
      itemCount: 3,
    })
  })

  it("reports nothing stale when only current-version entries exist", () => {
    saveGameProgress(MODE, {
      level: 8,
      wallWeight: 3,
      lastAttemptRetentionUnits: 710000,
      bestWinRetentionUnits: 840000,
      lastWinTraversalSpeedUnits: 6,
      bestWinTraversalSpeedUnits: 4,
    })

    expect(staleStorageSummary()).toEqual({ versions: [], itemCount: 0 })
  })

  // The version segment is itself dotted, so a naive split on "." would report "4" for every key.
  it("reads the whole dotted version out of a stale key", () => {
    window.localStorage.setItem(`tapoo.v4.82.${MODE}.${gameSetup}`, "old")

    expect(staleStorageSummary()).toEqual({ versions: ["4.82"], itemCount: 1 })
  })

  // The regression guard for the whole change: reading persisted data must no longer delete
  // anything an older version wrote. Consent now gates that, and it happens in tapoo.ts.
  it("leaves stale entries in place when current-version data is loaded", () => {
    const staleKey = versionedStorageKey(CONFIG.runtime.storage.version + 1, MODE, gameSetup)
    window.localStorage.setItem(staleKey, "old")

    loadPersistedSnapshot(MODE, 1, 1, isWallWeight)
    loadPersistedAgentApiConfigs()

    expect(window.localStorage.getItem(staleKey)).toBe("old")
    expect(staleStorageSummary().itemCount).toBe(1)
  })

  it("clears stale browser storage versions without touching the current version", () => {
    const currentVersion = CONFIG.runtime.storage.version
    const staleVersion = currentVersion + 1
    const staleGameSetupKey = versionedStorageKey(staleVersion, MODE, gameSetup)
    const staleRoundKey = versionedStorageKey(staleVersion, MODE, "round")

    window.localStorage.setItem(staleGameSetupKey, "old")
    window.sessionStorage.setItem(staleRoundKey, "old")
    saveGameProgress(MODE, {
      level: 8,
      wallWeight: 3,
      lastAttemptRetentionUnits: 710000,
      bestWinRetentionUnits: 840000,
      lastWinTraversalSpeedUnits: 6,
      bestWinTraversalSpeedUnits: 4,
    })
    saveActiveRoundSnapshot(
      MODE,
      createState({
        playerPosition: { x: 1, y: 1 },
        finalPosition: { x: 1, y: 1 },
      }),
    )

    clearStaleStorageVersions()

    expect(window.localStorage.getItem(staleGameSetupKey)).toBeNull()
    expect(window.sessionStorage.getItem(staleRoundKey)).toBeNull()
    expect(window.localStorage.getItem(storageKey(gameSetup))).not.toBeNull()
    expect(window.localStorage.getItem(storageKey(winMetrics))).not.toBeNull()
    expect(window.sessionStorage.getItem(storageKey("round"))).not.toBeNull()
  })

  it("removes the stored round when the current state cannot be persisted", () => {
    const persistedState = createState({
      playerPosition: { x: 1, y: 1 },
      finalPosition: { x: 1, y: 1 },
    })

    saveActiveRoundSnapshot(MODE, persistedState)
    expect(window.sessionStorage.getItem(storageKey("round"))).not.toBeNull()

    saveActiveRoundSnapshot(
      MODE,
      createState({
        mazeDimensions: null,
        maze: null,
        playerPosition: null,
        finalPosition: null,
        status: "boot",
      }),
    )

    expect(window.sessionStorage.getItem(storageKey("round"))).toBeNull()
  })

  it("still saves a round whose clock disagrees with its status", () => {
    // Reporting an inconsistent status belongs to game.ts, which owns the state and can log it.
    // Storage must not refuse the write: remainingMs falls back to the full round duration when
    // the clock is missing, so the snapshot still restores, and dropping it would lose real
    // progress over a discrepancy that is recoverable.
    saveActiveRoundSnapshot(MODE, createState({ status: "paused", clock: null }))

    expect(window.sessionStorage.getItem(storageKey("round"))).not.toBeNull()
  })

  it("refuses to save a round missing the data needed to restore it", () => {
    // buildRoundSnapshot is the real gate: without a maze there is nothing to redraw, so no
    // snapshot is written regardless of status.
    saveActiveRoundSnapshot(MODE, createState({ status: "paused", maze: null }))

    expect(window.sessionStorage.getItem(storageKey("round"))).toBeNull()
  })

  it("clears the persisted round on demand", () => {
    saveActiveRoundSnapshot(
      MODE,
      createState({
        playerPosition: { x: 1, y: 1 },
        finalPosition: { x: 1, y: 1 },
      }),
    )

    clearPersistedRound(MODE)

    expect(window.sessionStorage.getItem(storageKey("round"))).toBeNull()
  })

  it("clears persisted preferences and the active round on demand", () => {
    saveGameProgress(MODE, {
      level: 8,
      wallWeight: 3,
      lastAttemptRetentionUnits: 710000,
      bestWinRetentionUnits: 840000,
      lastWinTraversalSpeedUnits: null,
      bestWinTraversalSpeedUnits: null,
    })
    saveActiveRoundSnapshot(
      MODE,
      createState({
        playerPosition: { x: 1, y: 1 },
        finalPosition: { x: 1, y: 1 },
      }),
    )

    clearPersistedSnapshot(MODE)

    expect(window.localStorage.getItem(storageKey(gameSetup))).toBeNull()
    expect(window.localStorage.getItem(storageKey(winMetrics))).toBeNull()
    expect(window.sessionStorage.getItem(storageKey("round"))).toBeNull()
  })
})
