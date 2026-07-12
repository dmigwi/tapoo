import { beforeEach, describe, expect, it } from "vitest"

import {
  BEST_WIN_RETENTION_STORAGE_KEY,
  LEVEL_STORAGE_KEY,
  LAST_ATTEMPT_RETENTION_STORAGE_KEY,
  ROUND_STORAGE_KEY,
  STORE_ENCODING_PREFIX,
  WALL_WEIGHT_STORAGE_KEY,
} from "./config"
import {
  clearPersistedSnapshot,
  clearPersistedRound,
  loadPersistedSnapshot,
  savePersistedPreferences,
  savePersistedRoundState,
} from "./storage"
import type { State } from "./types"

function isWallWeight(value: number): value is 1 | 2 | 3 {
  return value === 1 || value === 2 || value === 3
}

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

function createState(overrides: Partial<State> = {}): State {
  return {
    level: 4,
    dims: { length: 5, width: 5 },
    maze: [
      ["|", "---", "|"],
      ["|", "   ", "|"],
      ["|", "---", "|"],
    ],
    playerPosition: [1, 1],
    finalPosition: [1, 1 + 0],
    status: "running",
    score: 1200,
    lastRoundScore: 700,
    lastAttemptRetention: 700000,
    bestWinRetention: 820000,
    winSummary: "",
    canResume: false,
    wallWeight: 2,
    clock: null,
    ...overrides,
  }
}

describe("storage", () => {
  beforeEach(() => {
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
    savePersistedPreferences({
      level: 8,
      wallWeight: 3,
      lastAttemptRetention: 710000,
      bestWinRetention: 840000,
    })

    const storedLevel = window.localStorage.getItem(LEVEL_STORAGE_KEY)
    const storedWeight = window.localStorage.getItem(WALL_WEIGHT_STORAGE_KEY)
    const storedLastAttemptRetention = window.localStorage.getItem(
      LAST_ATTEMPT_RETENTION_STORAGE_KEY,
    )
    const storedBestWinRetention = window.localStorage.getItem(
      BEST_WIN_RETENTION_STORAGE_KEY,
    )

    expect(storedLevel).toContain(STORE_ENCODING_PREFIX)
    expect(storedWeight).toContain(STORE_ENCODING_PREFIX)
    expect(storedLastAttemptRetention).toContain(STORE_ENCODING_PREFIX)
    expect(storedBestWinRetention).toContain(STORE_ENCODING_PREFIX)
    expect(storedLevel).not.toBe("8")
    expect(storedWeight).not.toBe("3")

    const snapshot = loadPersistedSnapshot(1, 1, isWallWeight)

    expect(snapshot.preferences).toEqual({
      level: 8,
      wallWeight: 3,
      lastAttemptRetention: 710000,
      bestWinRetention: 840000,
    })
  })

  it("saves and reloads the active round state", () => {
    const state = createState({
      playerPosition: [1, 1],
      finalPosition: [1, 1],
    })

    savePersistedRoundState(state)

    const snapshot = loadPersistedSnapshot(1, 1, isWallWeight)

    expect(snapshot.round).toEqual({
      version: 1,
      level: 4,
      dims: { length: 5, width: 5 },
      maze: state.maze,
      playerPosition: [1, 1],
      finalPosition: [1, 1],
      wallWeight: 2,
      status: "running",
      score: 1200,
      lastRoundScore: 700,
      winSummary: "",
      remainingMs: 25_000,
    })
  })

  it("falls back to defaults and clears unreadable stored state", () => {
    window.localStorage.setItem(LEVEL_STORAGE_KEY, "not-base64")
    window.localStorage.setItem(WALL_WEIGHT_STORAGE_KEY, "not-base64")
    window.sessionStorage.setItem(ROUND_STORAGE_KEY, "not-base64")

    const snapshot = loadPersistedSnapshot(2, 1, isWallWeight)

    expect(snapshot.preferences).toEqual({
      level: 2,
      wallWeight: 1,
      lastAttemptRetention: null,
      bestWinRetention: null,
    })
    expect(snapshot.round).toBeNull()
    expect(window.sessionStorage.getItem(ROUND_STORAGE_KEY)).toBeNull()
  })

  it("removes the stored round when the current state cannot be persisted", () => {
    const persistedState = createState({
      playerPosition: [1, 1],
      finalPosition: [1, 1],
    })

    savePersistedRoundState(persistedState)
    expect(window.sessionStorage.getItem(ROUND_STORAGE_KEY)).not.toBeNull()

    savePersistedRoundState(
      createState({
        dims: null,
        maze: null,
        playerPosition: null,
        finalPosition: null,
        status: "boot",
      }),
    )

    expect(window.sessionStorage.getItem(ROUND_STORAGE_KEY)).toBeNull()
  })

  it("clears the persisted round on demand", () => {
    savePersistedRoundState(
      createState({
        playerPosition: [1, 1],
        finalPosition: [1, 1],
      }),
    )

    clearPersistedRound()

    expect(window.sessionStorage.getItem(ROUND_STORAGE_KEY)).toBeNull()
  })

  it("clears persisted preferences and the active round on demand", () => {
    savePersistedPreferences({
      level: 8,
      wallWeight: 3,
      lastAttemptRetention: 710000,
      bestWinRetention: 840000,
    })
    savePersistedRoundState(
      createState({
        playerPosition: [1, 1],
        finalPosition: [1, 1],
      }),
    )

    clearPersistedSnapshot()

    expect(window.localStorage.getItem(LEVEL_STORAGE_KEY)).toBeNull()
    expect(window.localStorage.getItem(WALL_WEIGHT_STORAGE_KEY)).toBeNull()
    expect(window.localStorage.getItem(LAST_ATTEMPT_RETENTION_STORAGE_KEY)).toBeNull()
    expect(window.localStorage.getItem(BEST_WIN_RETENTION_STORAGE_KEY)).toBeNull()
    expect(window.sessionStorage.getItem(ROUND_STORAGE_KEY)).toBeNull()
  })
})
