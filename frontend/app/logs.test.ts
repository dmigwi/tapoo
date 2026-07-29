import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { loadTapooLog } from "./storage"
import {
  initTapooLogs,
  logTapooDiagnostic,
  subscribeTapooLogs,
  tapooDownloadLogs,
  tapooLogCount,
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
    let downloadedBlob: Blob | null = null
    let downloadedFilename = ""
    const createObjectURL = vi.fn((blob: Blob) => {
      downloadedBlob = blob
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
    if (!downloadedBlob) {
      throw new Error("expected log download blob")
    }
    expect(downloadedFilename).toMatch(
      /^tapoo-interactive-logs-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/,
    )
    const downloadedText = await downloadedBlob.text()
    expect(downloadedText).toContain("before reset")
    expect(downloadedText).toMatch(/"timestamp": \d+(\.\d+)?/)
    expect(downloadedText).toMatch(
      /"time": "\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}[+-]\d{2}-\d{2}"/,
    )

    tapooResetLogs("interactive")
    tapooDownloadLogs("interactive")

    expect(createObjectURL).toHaveBeenCalledTimes(2)
    if (!downloadedBlob) {
      throw new Error("expected reset log download blob")
    }
    await expect(downloadedBlob.text()).resolves.toBe("[]")
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
