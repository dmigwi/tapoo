import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { loadTapooLog } from "./storage"
import { APP_VERSION } from "./config"
import {
  initTapooLogs,
  logTapooDiagnostic,
  subscribeTapooLogs,
  tapooDownloadLogs,
  tapooLogCount,
  setTapooLogContext,
  tapooResetLogs,
  trimLoggedDescription,
} from "./logs"

// These tests keep the in-memory Tapoo log export/reset behavior intentionally small.
describe("tapoo logs", () => {
  beforeEach(() => {
    initTapooLogs("interactive")
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    tapooResetLogs("interactive")
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

    logTapooDiagnostic("interactive", "info", "before reset", { source: "test" })
    tapooDownloadLogs("interactive")

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const firstDownload = captured.blob
    if (!firstDownload) {
      throw new Error("expected log download blob")
    }
    expect(downloadedFilename).toMatch(
      new RegExp(
        `^tapoo-v${APP_VERSION.replaceAll(".", "\\.")}-interactive-logs-\\d+\\.json$`,
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
    expect(downloadedPayload.mode).toBe("interactive")
    expect(downloadedPayload.entries).toHaveLength(1)
    expect(downloadedText).toContain("before reset")
    expect(downloadedText).toMatch(/"timestamp": \d+(\.\d+)?/)
    expect(downloadedText).toMatch(
      /"time": "\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}[+-]\d{2}-\d{2}"/,
    )
    expect(downloadedPayload.downloadedAt).toMatch(
      /\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}[+-]\d{2}-\d{2}/,
    )

    tapooResetLogs("interactive")
    tapooDownloadLogs("interactive")

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
    expect(resetPayload.mode).toBe("interactive")
    expect(resetPayload.entries).toEqual([])
  })

  it("persists log entries to sessionStorage and clears them on reset", () => {
    logTapooDiagnostic("interactive", "info", "first entry")
    logTapooDiagnostic("interactive", "warn", "second entry")

    expect(loadTapooLog("interactive")).toHaveLength(2)

    tapooResetLogs("interactive")

    expect(loadTapooLog("interactive")).toHaveLength(0)
  })

  it("notifies subscribers when log availability changes", () => {
    const listener = vi.fn()
    const unsubscribe = subscribeTapooLogs(listener)

    expect(listener).toHaveBeenLastCalledWith(0)
    expect(tapooLogCount()).toBe(0)

    logTapooDiagnostic("interactive", "warn", "something happened")

    expect(listener).toHaveBeenLastCalledWith(1)
    expect(tapooLogCount()).toBe(1)

    tapooResetLogs("interactive")

    expect(listener).toHaveBeenLastCalledWith(0)
    expect(tapooLogCount()).toBe(0)

    unsubscribe()
    logTapooDiagnostic("interactive", "info", "after unsubscribe")

    expect(listener).toHaveBeenCalledTimes(3)
  })
})

describe("log context stamping", () => {
  afterEach(() => {
    setTapooLogContext({ turnCount: 0, level: 0 })
    tapooResetLogs("interactive")
  })

  it("stamps every entry with the turn and level set when it was written", () => {
    initTapooLogs("interactive")

    setTapooLogContext({ turnCount: 4, level: 2 })
    logTapooDiagnostic("interactive", "info", "Agent request.")
    logTapooDiagnostic("interactive", "info", "Agent response.")
    setTapooLogContext({ turnCount: 5, level: 2 })
    logTapooDiagnostic("interactive", "info", "Agent request.")

    // One turn issues several requests, and a level issues several turns, so entries group by
    // both rather than mapping 1:1 to either — without level, a downloaded log has no way to tell
    // which level a given request belongs to, since turn alone resets every level.
    const entries = loadTapooLog<{ turn: number; level: number; payload: string }>("interactive")
    expect(entries.map((entry) => [entry.turn, entry.level])).toEqual([
      [4, 2],
      [4, 2],
      [5, 2],
    ])
  })

  it("resets both the turn and level when logs are cleared", () => {
    initTapooLogs("interactive")

    setTapooLogContext({ turnCount: 7, level: 3 })
    tapooResetLogs("interactive")
    logTapooDiagnostic("interactive", "info", "after reset")

    const entries = loadTapooLog<{ turn: number; level: number }>("interactive")
    expect(entries).toHaveLength(1)
    expect(entries[0].turn).toBe(0)
    expect(entries[0].level).toBe(0)
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
