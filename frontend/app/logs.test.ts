import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { loadTapooLog, saveTapooLog } from "./storage"
import { APP_VERSION, CONFIG } from "./config"
import { generateMaze } from "./maze"
import type { PRNGGenerator } from "./maze"
import {
  checksumLoggedDescription,
  encodeMazeForLog,
  checksumEntries,
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
import { fetchDeviceInfo } from "./environment"
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

// fnv1a64Reference is FNV-1a 64 written straight from the spec with BigInt: slow, but too plain to
// be wrong. The limb implementation in logs.ts is held to it rather than to recorded outputs alone.
function fnv1a64Reference(text: string): string {
  let hash = 0xcbf29ce484222325n
  for (const byte of new TextEncoder().encode(text)) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n)
  }
  return `0x${hash.toString(16).padStart(16, "0")}`
}

describe("fnv1a64Checksum", () => {
  it("matches the spec reference across UTF-8 widths and unpaired surrogates", () => {
    const cases = ["", "a", "tapoo", "é ñ ü", "— “quotes” →", "#Wantam!", "😀🎯", "\uD800", "\uDC00", "x\uD800y",
      "\uDFFF\uD800", "a😀b\uD83Dc", "x".repeat(70_000) + "😀"]
    for (const text of cases) {
      expect(fnv1a64Checksum(text)).toBe(fnv1a64Reference(text))
    }
  })

  it("matches the spec reference on random text across the whole UTF-16 range", () => {
    let seed = 0x5eed
    const next = (): number => {
      seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0
      return seed
    }
    for (let sample = 0; sample < 500; sample++) {
      let text = ""
      const length = next() % 48
      for (let i = 0; i < length; i++) {
        text += String.fromCharCode(next() % 0x10000)
      }
      expect(fnv1a64Checksum(text)).toBe(fnv1a64Reference(text))
    }
  })
})

describe("checksumEntries", () => {
  const entries = [
    { log: "info", payload: "Agent request.", details: { player: "Blue the Trailblazer — 1.3165x" } },
    { log: "warn", payload: "Malformed agent prediction response.", details: { raw: "😀 \uD800 lone" } },
    { log: "info", payload: "Agent level won.", details: { traversalSpeed: "1.0000" } },
  ]

  it("equals the checksum of the compact entries JSON without building it", async () => {
    await expect(checksumEntries(entries, async () => {})).resolves.toBe(fnv1a64Checksum(JSON.stringify(entries)))
    await expect(checksumEntries([], async () => {})).resolves.toBe(fnv1a64Checksum("[]"))
  })

  it("yields to the page once a slice runs past a frame, and not before", async () => {
    let clock = 0
    const yieldToPage = vi.fn(async () => {})

    // A clock that never moves: a log small enough to finish in one slice never yields.
    await checksumEntries(entries, yieldToPage, () => clock)
    expect(yieldToPage).not.toHaveBeenCalled()

    // Every clock read lands 20 ms after the last. A slice starts on one read and is checked on the
    // next, so each check sees 20 ms - past the 16 ms budget - and every entry ends its slice.
    const slow = await checksumEntries(entries, yieldToPage, () => (clock += 20))
    expect(yieldToPage).toHaveBeenCalledTimes(entries.length)
    // Yielding changes when the work runs, never the result.
    expect(slow).toBe(fnv1a64Checksum(JSON.stringify(entries)))
  })
})

// These tests keep the Tapoo log export/reset behavior intentionally small.
describe("tapoo logs", () => {
  beforeEach(async () => {
    await initTapooLogs()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    await tapooResetLogs("agent-api")
    // One test puts a query and fragment on the address to pin down what platform records. jsdom
    // keeps the URL for the whole file, so it is reset here rather than at the end of that test,
    // where a failed assertion would skip it and leak the address into every test after it.
    window.history.replaceState({}, "", "/")
  })

  it("resets in-memory logs before downloading them", async () => {
    // A query string and fragment on the page address: platform must carry neither, which is the
    // whole reason it is built from origin + pathname instead of href. Without them on the address
    // the two spellings are indistinguishable in jsdom and the distinction goes untested.
    window.history.replaceState({}, "", "/?run=7#frag")
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
        // The first entry's millisecond epoch last, unbroken, right before .json.
        `^tapoo-logs-schema${String(CONFIG.runtime.storage.version).replaceAll(".", "\\.")}` +
          `-v${APP_VERSION.replaceAll(".", "\\.")}-\\d{13,}\\.json$`,
      ),
    )
    const downloadedText = await firstDownload.text()
    const downloadedPayload = JSON.parse(downloadedText) as {
      device: string
      downloadedAt: string
      entries: unknown[]
      entriesChecksum: string
      mode: string
      name: string
      platform: string
      storageVersion: string
      version: string
    }
    expect(downloadedPayload.name).toBe("tapoo")
    // Verified the way a consumer would, from the downloaded file alone: the file is pretty-printed,
    // so the checksum covers the entries re-serialized compactly, not the file's own text.
    expect(downloadedPayload.entriesChecksum).toMatch(/^0x[0-9a-f]{16}$/)
    expect(downloadedPayload.entriesChecksum).toBe(fnv1a64Checksum(JSON.stringify(downloadedPayload.entries)))
    // Any edit to an entry after download no longer matches.
    const tampered = JSON.parse(downloadedText) as { entries: Array<Record<string, unknown>> }
    tampered.entries[0].payload = "edited after download"
    expect(fnv1a64Checksum(JSON.stringify(tampered.entries))).not.toBe(downloadedPayload.entriesChecksum)
    // Recorded as the identifier it is, not a number: a numeric 5.10 would read back as 5.1.
    expect(downloadedPayload.storageVersion).toBe(String(CONFIG.runtime.storage.version))
    // Only agent-api logs download, so the mode was never informative in the name.
    expect(downloadedFilename).not.toContain("agent-api")
    // Where the run happened, recorded once in the envelope rather than on every entry.
    expect(downloadedPayload.platform).toBe(`${window.location.origin}${window.location.pathname}`)
    expect(downloadedPayload.platform).not.toContain("?")
    expect(downloadedPayload.platform).not.toContain("#")
    // The reduced description, never the raw user-agent string: the engine build and device tokens
    // it carries identify a machine and would be published with any shared log.
    expect(downloadedPayload.device).toBe(fetchDeviceInfo(window.navigator.userAgent))
    expect(downloadedPayload.device).not.toBe(window.navigator.userAgent)
    expect(downloadedPayload.device).not.toContain("AppleWebKit")
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

  it("names the download after the first entry that carries a real timestamp", async () => {
    const anchors: HTMLAnchorElement[] = []
    const createElement = document.createElement.bind(document)
    vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      const element = createElement(tagName)
      if (tagName === "a") {
        anchors.push(element as HTMLAnchorElement)
      }
      return element
    })
    vi.stubGlobal("URL", { createObjectURL: () => "blob:log", revokeObjectURL: () => {} })
    // The save is an anchor click, which jsdom answers with "Not implemented: navigation to another
    // Document" on its virtual console - an unattributed line in every suite run, which would hide
    // the same warning if real navigation ever appeared somewhere else. Mocked here as the sibling
    // download test above already does, and asserted, so the click itself stays covered.
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})

    // A placeholder standing in for a record that would not decode carries out-of-domain -1 values.
    // Reading epochMs straight off entries[0] would name the file after a timestamp of zero.
    logTapooRecordEntry("agent-api", "error", "unreadable log record: stored value did not decode")
    const entries = loadTapooLog<{ epochMs: number }>("agent-api")
    entries[0].epochMs = -1
    saveTapooLog("agent-api", entries)
    logTapooRecordEntry("agent-api", "info", "a real entry")

    await tapooDownloadLogs("agent-api")

    const [, second] = loadTapooLog<{ epochMs: number }>("agent-api")
    expect(anchors[0]?.download).toBe(
      `tapoo-logs-schema${CONFIG.runtime.storage.version}-v${APP_VERSION}-${second.epochMs}.json`,
    )
    expect(anchorClick).toHaveBeenCalledTimes(1)
  })

  it("ends the name with the millisecond epoch, so front-trimmed labels still tell runs apart", async () => {
    const anchors: HTMLAnchorElement[] = []
    const createElement = document.createElement.bind(document)
    vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      const element = createElement(tagName)
      if (tagName === "a") {
        anchors.push(element as HTMLAnchorElement)
      }
      return element
    })
    vi.stubGlobal("URL", { createObjectURL: () => "blob:log", revokeObjectURL: () => {} })
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    const now = vi.spyOn(Date, "now")

    // Two experiments started 342 ms apart - within the same second, on one machine.
    now.mockReturnValue(1_789_378_730_123)
    logTapooRecordEntry("agent-api", "info", "first entry")
    await tapooDownloadLogs("agent-api")
    await tapooResetLogs("agent-api")
    now.mockReturnValue(1_789_378_730_465)
    logTapooRecordEntry("agent-api", "info", "first entry")
    await tapooDownloadLogs("agent-api")

    const [first, second] = anchors.map((anchor) => anchor.download)
    expect(first).toBe(`tapoo-logs-schema${CONFIG.runtime.storage.version}-v${APP_VERSION}-1789378730123.json`)
    // Downstream tabs trim a long name from the front: at a 320px viewport only nine digits and
    // ".json" survive. Those trailing characters are all a reader sees, so they must still differ.
    const visibleAt320px = (name: string) => name.slice(-"789240357.json".length)
    expect(visibleAt320px(first)).toBe("378730123.json")
    expect(visibleAt320px(second)).toBe("378730465.json")
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
