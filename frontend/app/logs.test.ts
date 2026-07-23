import { afterEach, describe, expect, it, vi } from "vitest"

import {
  logTapooDiagnostic,
  subscribeTapooLogs,
  tapooDownloadLogs,
  tapooLogCount,
  tapooResetLogs,
} from "./logs"

// These tests keep the in-memory Tapoo log export/reset behavior intentionally small.
describe("tapoo logs", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    tapooResetLogs()
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

    logTapooDiagnostic("info", "before reset", { source: "test" })
    tapooDownloadLogs()

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    if (!downloadedBlob) {
      throw new Error("expected log download blob")
    }
    expect(downloadedFilename).toMatch(
      /^tapoo-logs-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/,
    )
    const downloadedText = await downloadedBlob.text()
    expect(downloadedText).toContain("before reset")
    expect(downloadedText).toMatch(
      /"timestamp": "\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}[+-]\d{2}-\d{2}"/,
    )

    tapooResetLogs()
    tapooDownloadLogs()

    expect(createObjectURL).toHaveBeenCalledTimes(2)
    if (!downloadedBlob) {
      throw new Error("expected reset log download blob")
    }
    await expect(downloadedBlob.text()).resolves.toBe("[]")
  })

  it("notifies subscribers when log availability changes", () => {
    const listener = vi.fn()
    const unsubscribe = subscribeTapooLogs(listener)

    expect(listener).toHaveBeenLastCalledWith(0)
    expect(tapooLogCount()).toBe(0)

    logTapooDiagnostic("warn", "something happened")

    expect(listener).toHaveBeenLastCalledWith(1)
    expect(tapooLogCount()).toBe(1)

    tapooResetLogs()

    expect(listener).toHaveBeenLastCalledWith(0)
    expect(tapooLogCount()).toBe(0)

    unsubscribe()
    logTapooDiagnostic("info", "after unsubscribe")

    expect(listener).toHaveBeenCalledTimes(3)
  })
})
