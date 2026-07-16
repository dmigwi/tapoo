import { beforeEach, describe, expect, it, vi } from "vitest"

import { CONFIG, STORE_ENCODING_PREFIX } from "./config"
import {
  clearPersistedAgentApiConfigs,
  clearPersistedAgentApiSnapshot,
  clearPersistedInteractiveRound,
  clearPersistedInteractiveSnapshot,
  disableAgentApiConfigForNetworkError,
  loadPersistedAgentApiConfigs,
  loadPersistedAgentApiSnapshot,
  loadPersistedInteractiveSnapshot,
  saveAgentApiGameProgress,
  savePersistedAgentApiConfigs,
  saveActiveInteractiveRoundSnapshot,
  saveInteractiveGameProgress,
} from "./storage"
import type { State, TraversalHistoryEntry } from "./types"

const MODE = CONFIG.runtime.controlModes.interactive
const AGENT_MODE = CONFIG.runtime.controlModes.agentApi

function visit(row: number, col: number): TraversalHistoryEntry {
  return { playerName: "Blue", row, col }
}

// storageKey mirrors the production per-mode browser storage naming.
function storageKey(suffix: string): string {
  return `tapoo.${MODE}.${suffix}`
}

// agentStorageKey mirrors the separate agent-api storage namespace.
function agentStorageKey(suffix: string): string {
  return `tapoo.${AGENT_MODE}.${suffix}`
}

// isWallWeight mirrors the production wall-weight guard for persistence tests.
function isWallWeight(value: number): value is 1 | 2 | 3 {
  return value === 1 || value === 2 || value === 3
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
    mazeDimensions: { length: 5, width: 5 },
    maze: [
      ["|", "---", "|"],
      ["|", "   ", "|"],
      ["|", "---", "|"],
    ],
    playerPosition: { x: 1, y: 1 },
    traversalHistory: [visit(0, 0)],
    finalPosition: { x: 1, y: 1 },
    status: "running",
    score: 1200,
    lastRoundScore: 700,
    lastAttemptRetention: 700000,
    bestWinRetention: 820000,
    lastWinRequestCount: null,
    bestWinRequestCount: null,
    winSummary: "",
    canResume: false,
    wallWeight: 2,
    scoreDecayUnits: 0,
    agentRequestCount: 0,
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
    saveInteractiveGameProgress({
      level: 8,
      wallWeight: 3,
      lastAttemptRetention: 710000,
      bestWinRetention: 840000,
      lastWinRequestCount: null,
      bestWinRequestCount: null,
    })

    const storedLevel = window.localStorage.getItem(storageKey("level"))
    const storedWeight = window.localStorage.getItem(storageKey("wallWeight"))
    const storedLastAttemptRetention = window.localStorage.getItem(
      storageKey("lastAttemptRetention"),
    )
    const storedBestWinRetention = window.localStorage.getItem(
      storageKey("bestWinRetention"),
    )

    expect(storedLevel).toContain(STORE_ENCODING_PREFIX)
    expect(storedWeight).toContain(STORE_ENCODING_PREFIX)
    expect(storedLastAttemptRetention).toContain(STORE_ENCODING_PREFIX)
    expect(storedBestWinRetention).toContain(STORE_ENCODING_PREFIX)
    expect(storedLevel).not.toBe("8")
    expect(storedWeight).not.toBe("3")

    const snapshot = loadPersistedInteractiveSnapshot(1, 1, isWallWeight)

    expect(snapshot.preferences).toEqual({
      level: 8,
      wallWeight: 3,
      lastAttemptRetention: 710000,
      bestWinRetention: 840000,
      lastWinRequestCount: null,
      bestWinRequestCount: null,
    })
  })

  it("saves and reloads configured agent api details separately from game progress", () => {
    savePersistedAgentApiConfigs([
      {
        id: "agent-a",
        playerName: "Agent A",
        model: "llama3.2",
        endpoint: "/api/agents/a/move",
        enabled: true,
      },
      {
        id: "agent-b",
        playerName: "Agent B",
        model: "gemma4",
        endpoint: "/api/agents/b/move",
        enabled: false,
        disabledReason: "network-error",
        lastErrorAt: 1_725_000_000_000,
      },
    ])

    const storedConfigs = window.localStorage.getItem(
      agentStorageKey("agentConfigs"),
    )

    expect(storedConfigs).toContain(STORE_ENCODING_PREFIX)
    expect(storedConfigs).not.toContain("/api/agents/a/move")
    expect(loadPersistedAgentApiConfigs()).toEqual([
      {
        id: "agent-a",
        playerName: "Agent A",
        model: "llama3.2",
        endpoint: "/api/agents/a/move",
        enabled: true,
      },
      {
        id: "agent-b",
        playerName: "Agent B",
        model: "gemma4",
        endpoint: "/api/agents/b/move",
        enabled: false,
        disabledReason: "network-error",
        lastErrorAt: 1_725_000_000_000,
      },
    ])

    clearPersistedAgentApiSnapshot()
    expect(loadPersistedAgentApiConfigs()).toHaveLength(2)

    clearPersistedAgentApiConfigs()
    expect(loadPersistedAgentApiConfigs()).toEqual([])
  })

  it("saves and reloads agent api progress in the agent storage namespace", () => {
    saveAgentApiGameProgress({
      level: 6,
      wallWeight: 2,
      lastAttemptRetention: 640000,
      bestWinRetention: 760000,
      lastWinRequestCount: 8,
      bestWinRequestCount: 5,
    })

    expect(window.localStorage.getItem(agentStorageKey("level"))).toContain(
      STORE_ENCODING_PREFIX,
    )
    expect(window.localStorage.getItem(storageKey("level"))).toBeNull()

    const snapshot = loadPersistedAgentApiSnapshot(1, 1, isWallWeight)

    expect(snapshot.preferences).toEqual({
      level: 6,
      wallWeight: 2,
      lastAttemptRetention: 640000,
      bestWinRetention: 760000,
      lastWinRequestCount: 8,
      bestWinRequestCount: 5,
    })
  })

  it("disables one network-failed agent without touching the others", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_725_000_000_001)
    savePersistedAgentApiConfigs([
      {
        id: "agent-a",
        playerName: "Agent A",
        model: "llama3.2",
        endpoint: "/api/agents/a/move",
        enabled: true,
      },
      {
        id: "agent-b",
        playerName: "Agent B",
        model: "gemma4",
        endpoint: "/api/agents/b/move",
        enabled: true,
      },
    ])

    const nextConfigs = disableAgentApiConfigForNetworkError({
      id: "agent-b",
      playerName: "Agent B",
      model: "gemma4",
      endpoint: "/api/agents/b/move",
      enabled: true,
    })

    expect(nextConfigs).toEqual([
      {
        id: "agent-a",
        playerName: "Agent A",
        model: "llama3.2",
        endpoint: "/api/agents/a/move",
        enabled: true,
      },
      {
        id: "agent-b",
        playerName: "Agent B",
        model: "gemma4",
        endpoint: "/api/agents/b/move",
        enabled: false,
        disabledReason: "network-error",
        lastErrorAt: 1_725_000_000_001,
      },
    ])
    expect(loadPersistedAgentApiConfigs()).toEqual(nextConfigs)
  })

  it("saves and reloads the active round state", () => {
    const state = createState({
      playerPosition: { x: 1, y: 1 },
      finalPosition: { x: 1, y: 1 },
    })

    saveActiveInteractiveRoundSnapshot(state)

    const snapshot = loadPersistedInteractiveSnapshot(1, 1, isWallWeight)

    expect(snapshot.round).toEqual({
      version: CONFIG.runtime.roundStorageVersion,
      level: 4,
      mazeDimensions: { length: 5, width: 5 },
      maze: state.maze,
      startCell: { row: 0, col: 0 },
      traversalHistory: [visit(0, 0)],
      playerPosition: { x: 1, y: 1 },
      finalPosition: { x: 1, y: 1 },
      wallWeight: 2,
      status: "running",
      score: 1200,
      lastRoundScore: 700,
      winSummary: "",
      remainingMs: 25_000,
      scoreDecayUnits: 0,
      agentRequestCount: 0,
    })
  })

  it("falls back to defaults and clears unreadable stored state", () => {
    window.localStorage.setItem(storageKey("level"), "not-base64")
    window.localStorage.setItem(storageKey("wallWeight"), "not-base64")
    window.sessionStorage.setItem(storageKey("round"), "not-base64")

    const snapshot = loadPersistedInteractiveSnapshot(2, 1, isWallWeight)

    expect(snapshot.preferences).toEqual({
      level: 2,
      wallWeight: 1,
      lastAttemptRetention: null,
      bestWinRetention: null,
      lastWinRequestCount: null,
      bestWinRequestCount: null,
    })
    expect(snapshot.round).toBeNull()
    expect(window.sessionStorage.getItem(storageKey("round"))).toBeNull()
  })

  it("falls back to defaults and clears stale active rounds after a storage version change", () => {
    const originalStorageVersion = CONFIG.runtime.roundStorageVersion

    try {
      saveInteractiveGameProgress({
        level: 8,
        wallWeight: 3,
        lastAttemptRetention: 710000,
        bestWinRetention: 840000,
        lastWinRequestCount: 6,
        bestWinRequestCount: 4,
      })
      saveActiveInteractiveRoundSnapshot(
        createState({
          playerPosition: { x: 1, y: 1 },
          finalPosition: { x: 1, y: 1 },
        }),
      )
      expect(window.sessionStorage.getItem(storageKey("round"))).not.toBeNull()

      CONFIG.runtime.roundStorageVersion = originalStorageVersion + 1
      const snapshot = loadPersistedInteractiveSnapshot(1, 1, isWallWeight)

      expect(snapshot.preferences).toEqual({
        level: 1,
        wallWeight: 1,
        lastAttemptRetention: null,
        bestWinRetention: null,
        lastWinRequestCount: null,
        bestWinRequestCount: null,
      })
      expect(snapshot.round).toBeNull()
      expect(window.localStorage.getItem(storageKey("level"))).toBeNull()
      expect(window.localStorage.getItem(storageKey("wallWeight"))).toBeNull()
      expect(window.localStorage.getItem(storageKey("lastAttemptRetention"))).toBeNull()
      expect(window.localStorage.getItem(storageKey("bestWinRetention"))).toBeNull()
      expect(window.sessionStorage.getItem(storageKey("round"))).toBeNull()
    } finally {
      CONFIG.runtime.roundStorageVersion = originalStorageVersion
    }
  })

  it("removes the stored round when the current state cannot be persisted", () => {
    const persistedState = createState({
      playerPosition: { x: 1, y: 1 },
      finalPosition: { x: 1, y: 1 },
    })

    saveActiveInteractiveRoundSnapshot(persistedState)
    expect(window.sessionStorage.getItem(storageKey("round"))).not.toBeNull()

    saveActiveInteractiveRoundSnapshot(
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

  it("clears the persisted round on demand", () => {
    saveActiveInteractiveRoundSnapshot(
      createState({
        playerPosition: { x: 1, y: 1 },
        finalPosition: { x: 1, y: 1 },
      }),
    )

    clearPersistedInteractiveRound()

    expect(window.sessionStorage.getItem(storageKey("round"))).toBeNull()
  })

  it("clears persisted preferences and the active round on demand", () => {
    saveInteractiveGameProgress({
      level: 8,
      wallWeight: 3,
      lastAttemptRetention: 710000,
      bestWinRetention: 840000,
      lastWinRequestCount: null,
      bestWinRequestCount: null,
    })
    saveActiveInteractiveRoundSnapshot(
      createState({
        playerPosition: { x: 1, y: 1 },
        finalPosition: { x: 1, y: 1 },
      }),
    )

    clearPersistedInteractiveSnapshot()

    expect(window.localStorage.getItem(storageKey("level"))).toBeNull()
    expect(window.localStorage.getItem(storageKey("wallWeight"))).toBeNull()
    expect(window.localStorage.getItem(storageKey("lastAttemptRetention"))).toBeNull()
    expect(window.localStorage.getItem(storageKey("bestWinRetention"))).toBeNull()
    expect(window.sessionStorage.getItem(storageKey("round"))).toBeNull()
  })
})
