import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { loadTapooLog } from "./storage"
import { APP_VERSION, CONFIG } from "./config"
import { generateMaze } from "./maze"
import type { PRNGGenerator } from "./maze"
import {
  checksumLoggedDescription,
  encodeMazeForLog,
  fnv1a64Checksum,
  initTapooLogs,
  logTapooRecordEntry,
  subscribeTapooLogs,
  syncTapooLogHeartbeat,
  tapooDownloadLogs,
  tapooLogCount,
  setTapooLogContext,
  tapooResetLogs,
  trimLoggedDescription,
} from "./logs"
import { createMazeDimensions } from "./traversal"
import type * as StorageLogs from "./storage-logs"
import type { EncodedMaze } from "./types"

type StorageLogsModule = typeof StorageLogs

function createXorshift128Generator(seed: number): PRNGGenerator {
  let [x, y, z, w] = [seed || 1, 362436069, 521288629, 88675123]

  return (limit: number): number => {
    if (limit <= 0) {
      return 0
    }

    const t = x ^ (x << 11)
    x = y
    y = z
    z = w
    w = (w ^ (w >>> 19)) ^ (t ^ (t >>> 8))
    return (w >>> 0) % limit
  }
}

// These tests keep the in-memory Tapoo log export/reset behavior intentionally small.
describe("tapoo logs", () => {
  beforeEach(async () => {
    await initTapooLogs()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    await tapooResetLogs("agent-api")
  })

  it("resets in-memory logs before downloading them", async () => {
    // The blob is captured on a holder object rather than in a `let`. TypeScript cannot see the
    // mock body run, so a `let` initialized to null stays narrowed to `null` at every later read
    // and guarding it collapses to `never`; a property read uses its declared type instead.
    const captured: { blob: Blob | null } = { blob: null }
    let downloadedFilename = ""
    const createObjectURL = vi.fn((blob: Blob) => {
      captured.blob = blob
      return "blob:tapoo-logs"
    })
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL,
      revokeObjectURL: vi.fn(),
    })
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloadedFilename = this.download
    })

    logTapooRecordEntry("agent-api", "info", "before reset", { source: "test" })
    await tapooDownloadLogs("agent-api")

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const firstDownload = captured.blob
    if (!firstDownload) {
      throw new Error("expected log download blob")
    }
    expect(downloadedFilename).toMatch(
      new RegExp(
        `^tapoo-v${APP_VERSION.replaceAll(".", "\\.")}-agent-api-logs-\\d+\\.json$`,
      ),
    )
    const downloadedText = await firstDownload.text()
    const downloadedPayload = JSON.parse(downloadedText) as {
      downloadedAt: string
      entries: unknown[]
      mode: string
      name: string
      version: string
    }
    expect(downloadedPayload.name).toBe("tapoo")
    expect(downloadedPayload.version).toBe(APP_VERSION)
    expect(downloadedPayload.mode).toBe("agent-api")
    expect(downloadedPayload.entries).toHaveLength(1)
    expect(downloadedText).toContain("before reset")
    expect(downloadedText).toMatch(/"epochMs": \d+(\.\d+)?/)
    expect(downloadedText).toMatch(
      /"time": "\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}[+-]\d{2}-\d{2}"/,
    )
    expect(downloadedPayload.downloadedAt).toMatch(
      /\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}[+-]\d{2}-\d{2}/,
    )

    await tapooResetLogs("agent-api")
    await tapooDownloadLogs("agent-api")

    expect(createObjectURL).toHaveBeenCalledTimes(2)
    const resetDownload = captured.blob
    if (!resetDownload) {
      throw new Error("expected reset log download blob")
    }
    const resetPayload = JSON.parse(await resetDownload.text()) as {
      entries: unknown[]
      mode: string
      name: string
      version: string
    }
    expect(resetPayload.name).toBe("tapoo")
    expect(resetPayload.version).toBe(APP_VERSION)
    expect(resetPayload.mode).toBe("agent-api")
    expect(resetPayload.entries).toEqual([])
  })

  it("persists log entries to sessionStorage and clears them on reset", async () => {
    logTapooRecordEntry("agent-api", "info", "first entry")
    logTapooRecordEntry("agent-api", "warn", "second entry")

    expect(loadTapooLog("agent-api")).toHaveLength(2)

    await tapooResetLogs("agent-api")

    expect(loadTapooLog("agent-api")).toHaveLength(0)
  })

  it("notifies subscribers when log availability changes", async () => {
    const listener = vi.fn()
    const unsubscribe = subscribeTapooLogs(listener)

    expect(listener).toHaveBeenLastCalledWith(0)
    expect(tapooLogCount()).toBe(0)

    logTapooRecordEntry("agent-api", "warn", "something happened")

    expect(listener).toHaveBeenLastCalledWith(1)
    expect(tapooLogCount()).toBe(1)

    await tapooResetLogs("agent-api")

    expect(listener).toHaveBeenLastCalledWith(0)
    expect(tapooLogCount()).toBe(0)

    unsubscribe()
    logTapooRecordEntry("agent-api", "info", "after unsubscribe")

    expect(listener).toHaveBeenCalledTimes(3)
  })

  it("does not write Tapoo Logs under interactive mode", async () => {
    await initTapooLogs()
    logTapooRecordEntry("interactive", "info", "interactive event")

    expect(loadTapooLog("interactive")).toHaveLength(0)
    expect(tapooLogCount()).toBe(0)
  })

  it("loads existing agent-api log state while running on an interactive page", async () => {
    logTapooRecordEntry("agent-api", "info", "agent-api event")

    await initTapooLogs()
    logTapooRecordEntry("interactive", "info", "interactive event")

    expect(loadTapooLog("agent-api")).toHaveLength(1)
    expect(loadTapooLog("interactive")).toHaveLength(0)
    expect(tapooLogCount()).toBe(1)
  })

  it("heartbeats existing agent logs while the current page is not running agent-api play", () => {
    vi.useFakeTimers()
    const setInterval = vi.spyOn(window, "setInterval")
    const clearInterval = vi.spyOn(window, "clearInterval")

    syncTapooLogHeartbeat({ controlMode: "agent-api", status: "paused" })

    expect(setInterval).not.toHaveBeenCalled()

    logTapooRecordEntry("agent-api", "info", "stored log")
    syncTapooLogHeartbeat({ controlMode: "agent-api", status: "paused" })

    expect(setInterval).toHaveBeenCalledTimes(1)

    syncTapooLogHeartbeat({ controlMode: "agent-api", status: "running" })

    expect(clearInterval).toHaveBeenCalledTimes(1)

    syncTapooLogHeartbeat({ controlMode: "agent-api", status: "paused" })

    expect(setInterval).toHaveBeenCalledTimes(2)

    syncTapooLogHeartbeat({ controlMode: "interactive", status: "running" })

    expect(setInterval).toHaveBeenCalledTimes(2)
  })

  it("uses an interactive page heartbeat to keep existing agent-api logs fresh", async () => {
    vi.useFakeTimers()

    logTapooRecordEntry("agent-api", "info", "agent-api event")
    await initTapooLogs()

    syncTapooLogHeartbeat({ controlMode: "interactive", status: "running" })
    await vi.advanceTimersByTimeAsync(CONFIG.runtime.storage.log.heartbeatIntervalMs)

    expect(tapooLogCount()).toBe(1)
  })
})

describe("log context stamping", () => {
  afterEach(async () => {
    setTapooLogContext({ turnCount: 0, level: 0, cumulativeRoundCount: 0 })
    await tapooResetLogs("agent-api")
  })

  it("stamps every entry with the turn, level, and game set when it was written", async () => {
    await initTapooLogs()

    setTapooLogContext({ turnCount: 4, level: 2, cumulativeRoundCount: 9 })
    logTapooRecordEntry("agent-api", "info", "Agent request.")
    logTapooRecordEntry("agent-api", "info", "Agent response.")
    setTapooLogContext({ turnCount: 5, level: 2, cumulativeRoundCount: 9 })
    logTapooRecordEntry("agent-api", "info", "Agent request.")

    // One turn issues several requests, and a level issues several turns, so entries group by
    // all three rather than mapping 1:1 to any one - without level and game, a downloaded log
    // can't tell which level/playthrough a given request belongs to, since turn alone resets every
    // level and level alone can't distinguish a retry from continuing the same level.
    const entries = loadTapooLog<{
      turn: number
      level: number
      game: number
      payload: string
    }>("agent-api")
    expect(entries.map((entry) => [entry.turn, entry.level, entry.game])).toEqual([
      [4, 2, 9],
      [4, 2, 9],
      [5, 2, 9],
    ])
  })

  it("resets the turn, level, and game when logs are cleared", async () => {
    await initTapooLogs()

    setTapooLogContext({ turnCount: 7, level: 3, cumulativeRoundCount: 12 })
    await tapooResetLogs("agent-api")
    logTapooRecordEntry("agent-api", "info", "after reset")

    const entries = loadTapooLog<{ turn: number; level: number; game: number }>("agent-api")
    expect(entries).toHaveLength(1)
    expect(entries[0].turn).toBe(0)
    expect(entries[0].level).toBe(0)
    expect(entries[0].game).toBe(0)
  })
})

describe("trimLoggedDescription", () => {
  it("returns the full text when keepFull is true, regardless of length", () => {
    const long = "x".repeat(50)
    expect(trimLoggedDescription(long, true)).toBe(long)
  })

  it("returns undefined unchanged", () => {
    expect(trimLoggedDescription(undefined, false)).toBeUndefined()
  })

  it("returns short text unchanged even when keepFull is false", () => {
    expect(trimLoggedDescription("short text", false)).toBe("short text")
  })

  it("truncates text longer than the preview length and appends an ellipsis", () => {
    const long = "This description is definitely longer than the preview length allows."
    expect(trimLoggedDescription(long, false)).toBe(`${long.slice(0, 25)}...`)
  })

  it("leaves text exactly at the preview length untouched", () => {
    const exact = "x".repeat(25)
    expect(trimLoggedDescription(exact, false)).toBe(exact)
  })
})

describe("checksumLoggedDescription", () => {
  it("returns undefined for undefined input", () => {
    expect(checksumLoggedDescription(undefined)).toBeUndefined()
  })

  it("returns a 0x-prefixed 64-bit hex checksum", () => {
    expect(checksumLoggedDescription("some prompt text")).toMatch(/^0x[0-9a-f]{16}$/)
  })

  it("hashes UTF-8 bytes so non-ASCII text (curly quotes, em dash, arrows) checksums consistently", () => {
    const nonAscii = "“curly” quotes - an em dash → an arrow"
    expect(checksumLoggedDescription(nonAscii)).toMatch(/^0x[0-9a-f]{16}$/)
    // Same input still round-trips to the same checksum - not just any hex string.
    expect(checksumLoggedDescription(nonAscii)).toBe(checksumLoggedDescription(nonAscii))
  })

  it("matches independently-known FNV-1a 64-bit test vectors, proving external portability", () => {
    // Empty input never enters the loop, so the result is just the untouched offset basis - a
    // standard published FNV-1a 64-bit test vector, not something only this implementation agrees
    // with itself on.
    expect(checksumLoggedDescription("")).toBe("0xcbf29ce484222325")
    // Single-byte ASCII "a" is another standard published FNV-1a 64-bit test vector.
    expect(checksumLoggedDescription("a")).toBe("0xaf63dc4c8601ec8c")
  })

  it("returns the same checksum for the same input", () => {
    const text = "This description is definitely longer than the preview length allows."
    expect(checksumLoggedDescription(text)).toBe(checksumLoggedDescription(text))
  })

  it("returns a different checksum for different input", () => {
    expect(checksumLoggedDescription("first text")).not.toBe(checksumLoggedDescription("second text"))
  })
})

// decodeMazeForLogInTest stands in for the external, out-of-tool decode step an analysis script
// would perform. It reconstructs the original maze grid, not just printable text, and validates the
// checksum plus row separators before trusting the compact structure string.
function decodeMazeForLogInTest({
  index_chars,
  structure,
  structure_checksum,
}: EncodedMaze): string[][] {
  if (structure_checksum !== fnv1a64Checksum(structure)) {
    throw new Error("encoded maze structure checksum mismatch")
  }

  const rowSeparatorIndex = index_chars.indexOf("\n")
  if (rowSeparatorIndex < 0) {
    throw new Error("encoded maze is missing a row separator token")
  }

  const rowSeparator = String(rowSeparatorIndex)
  return structure.split(rowSeparator).map((encodedRow) =>
    encodedRow.split("").map((digit) => {
      const token = index_chars[Number(digit)]
      if (token === undefined || token === "\n") {
        throw new Error(`encoded maze contains invalid token index: ${digit}`)
      }

      return token
    }),
  )
}

describe("encodeMazeForLog", () => {
  it("round-trips to the exact original maze grid", () => {
    const maze = [
      ["|", "---", "-"],
      ["|", " ", "|"],
      ["|", "---", "-"],
    ]

    expect(decodeMazeForLogInTest(encodeMazeForLog(maze))).toEqual(maze)
  })

  it("round-trips a generated maze grid exactly", () => {
    const dimensions = { ...createMazeDimensions({ numCols: 5, numRows: 5 }), level: 1 }
    const { maze } = generateMaze(
      dimensions,
      1,
      undefined,
      createXorshift128Generator(1),
    )
    const encodedMaze = encodeMazeForLog(maze)

    expect(encodedMaze.structure_checksum).toBe(fnv1a64Checksum(encodedMaze.structure))
    expect(decodeMazeForLogInTest(encodedMaze)).toEqual(maze)
  })

  it("lists only the tokens actually used, in first-seen order, with the row separator last", () => {
    const maze = [
      ["|", "---", "-"],
      ["|", " ", "|"],
    ]

    expect(encodeMazeForLog(maze)).toEqual({
      index_chars: ["|", "---", "-", " ", "\n"],
      structure_checksum: "0x21db7e68faa2be77",
      structure: "012" + "4" + "030",
    })
  })

  it("never emits an index_chars entry unused by the maze that was actually passed in", () => {
    const maze = [
      ["|", "---", "-"],
      ["|", "---", "-"],
    ]

    // Only three distinct tokens ever appear, so index_chars holds exactly those three plus the
    // separator - never a full five-token alphabet padded out for tokens this maze never used.
    expect(encodeMazeForLog(maze).index_chars).toEqual(["|", "---", "-", "\n"])
  })

  it("adds a checksum for the compact structure string", () => {
    const firstMaze = [
      ["|", "---", "-"],
      ["|", " ", "|"],
    ]
    const secondMaze = [
      ["|", "---", "-"],
      ["|", "---", "-"],
    ]

    const firstEncoding = encodeMazeForLog(firstMaze)
    const secondEncoding = encodeMazeForLog(secondMaze)

    expect(firstEncoding.structure_checksum).toBe(fnv1a64Checksum(firstEncoding.structure))
    expect(firstEncoding.structure_checksum).not.toBe(secondEncoding.structure_checksum)
  })

  it("rejects a structure string whose checksum no longer matches", () => {
    const encodedMaze = encodeMazeForLog([
      ["|", "---", "-"],
      ["|", " ", "|"],
    ])

    expect(() => decodeMazeForLogInTest({
      ...encodedMaze,
      structure: `${encodedMaze.structure}0`,
    })).toThrow("encoded maze structure checksum mismatch")
  })

  it("rejects an encoded token index that is not present in index_chars", () => {
    const encodedMaze = encodeMazeForLog([
      ["|", "---", "-"],
      ["|", " ", "|"],
    ])
    const corruptedStructure = `${encodedMaze.structure}9`

    expect(() => decodeMazeForLogInTest({
      ...encodedMaze,
      structure: corruptedStructure,
      structure_checksum: fnv1a64Checksum(corruptedStructure),
    })).toThrow("encoded maze contains invalid token index: 9")
  })
})

// These drive the heartbeat against a lease refresh the test controls, which the rest of the file
// cannot do: it runs against the real store, where a refresh settles immediately and there is no
// window in which a second tick could overlap the first.
describe("heartbeat lease refresh", () => {
  afterEach(() => {
    vi.resetModules()
    vi.doUnmock("./storage-logs")
    vi.useRealTimers()
  })

  // Loads a fresh copy of logs.ts with the lease refresh replaced, and gives it one stored entry so
  // the heartbeat has something to protect.
  async function heartbeatHarness(refresh: () => Promise<unknown>) {
    vi.resetModules()
    vi.doMock("./storage-logs", async () => ({
      ...(await vi.importActual<StorageLogsModule>("./storage-logs")),
      refreshCurrentTapooLogStoreLease: vi.fn(refresh),
    }))

    const logs = await import("./logs")
    const store = await import("./storage-logs")
    vi.useFakeTimers()
    logs.logTapooRecordEntry("agent-api", "info", "something worth protecting")
    logs.syncTapooLogHeartbeat({ controlMode: "agent-api", status: "paused" })

    return { logs, refreshMock: vi.mocked(store.refreshCurrentTapooLogStoreLease) }
  }

  it("drops a tick that lands while the previous lease refresh is still open", async () => {
    let release: () => void = () => {}
    const { refreshMock } = await heartbeatHarness(() => new Promise<unknown>((resolve) => {
      release = (): void => { resolve({ backend: "indexed-db", currentLogCount: 1, staleLogSessionCount: 0 }) }
    }))

    await vi.advanceTimersByTimeAsync(CONFIG.runtime.storage.log.heartbeatIntervalMs)
    expect(refreshMock).toHaveBeenCalledTimes(1)

    // Second tick with the first still open. Queuing it would put two read-modify-writes on the same
    // lease row in flight at once.
    await vi.advanceTimersByTimeAsync(CONFIG.runtime.storage.log.heartbeatIntervalMs)
    expect(refreshMock).toHaveBeenCalledTimes(1)

    release()
    await vi.advanceTimersByTimeAsync(CONFIG.runtime.storage.log.heartbeatIntervalMs)
    expect(refreshMock).toHaveBeenCalledTimes(2)
  })

  it("keeps ticking after a lease refresh fails instead of stalling on it", async () => {
    const { refreshMock } = await heartbeatHarness(() =>
      Promise.reject(new Error("database connection is closing")))

    await vi.advanceTimersByTimeAsync(CONFIG.runtime.storage.log.heartbeatIntervalMs)
    expect(refreshMock).toHaveBeenCalledTimes(1)

    // A pending flag left set would stop the heartbeat for good after one failure.
    await vi.advanceTimersByTimeAsync(CONFIG.runtime.storage.log.heartbeatIntervalMs)
    expect(refreshMock).toHaveBeenCalledTimes(2)
  })

  it("contains a failed lease refresh instead of letting it reach the page error handler", async () => {
    // Reached through globalThis rather than the process global: this project has no @types/node,
    // and the rejection is observable here only because vitest runs on Node.
    const nodeProcess = (globalThis as unknown as {
      process: {
        on: (event: string, listener: (reason: unknown) => void) => void
        off: (event: string, listener: (reason: unknown) => void) => void
      }
    }).process
    const escaped: unknown[] = []
    const onUnhandled = (reason: unknown): void => { escaped.push(reason) }
    nodeProcess.on("unhandledRejection", onUnhandled)

    try {
      await heartbeatHarness(() => Promise.reject(new Error("database connection is closing")))
      await vi.advanceTimersByTimeAsync(CONFIG.runtime.storage.log.heartbeatIntervalMs)

      // Real timers and a macrotask: Node reports an unhandled rejection at the end of the turn it
      // was left in, so the check has to leave the fake-timer turn to see one.
      vi.useRealTimers()
      await new Promise((resolve) => { setTimeout(resolve, 0) })

      // tapoo.ts turns an unhandled rejection into showPlaceholderArt, which replaces the whole
      // game. A lease renewal the next tick would have retried must never cost a round in progress.
      expect(escaped).toEqual([])
    } finally {
      nodeProcess.off("unhandledRejection", onUnhandled)
    }
  })
})
