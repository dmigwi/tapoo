import { beforeEach, describe, expect, it, vi } from "vitest"

import { CONFIG, INFO_GATE_NOTICES } from "./config"
import { requireStaleDataAcknowledgement } from "./consent-gates"
import type { Elements } from "./types"

// createMemoryStorage mirrors storage.test.ts's stub: this jsdom config exposes no real storage,
// and this module reads both stores to decide whether consent is needed.
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

function gateElements(): Elements {
  return {
    infoGate: document.createElement("div"),
    infoGateTitle: document.createElement("strong"),
    infoGateMessage: document.createElement("p"),
    infoGateDetail: document.createElement("p"),
    infoGateProceed: document.createElement("button"),
  } as unknown as Elements
}

const currentKey = `tapoo.v${CONFIG.runtime.storage.version}.interactive.gameSetup`

describe("requireStaleDataAcknowledgement", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createMemoryStorage(),
    })
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: createMemoryStorage(),
    })
  })

  // An ordinary start has to be indistinguishable from before the gate existed: no deferred
  // callback, and no frame in which the overlay could appear.
  it("proceeds synchronously and shows nothing when no older version left anything", () => {
    const elements = gateElements()
    elements.infoGate.hidden = true
    window.localStorage.setItem(currentKey, "current")
    const onProceed = vi.fn()

    requireStaleDataAcknowledgement(elements, onProceed)

    expect(onProceed).toHaveBeenCalledTimes(1)
    expect(elements.infoGate.hidden).toBe(true)
  })

  it("holds onProceed and leaves stale keys alone until the user agrees", () => {
    const elements = gateElements()
    const staleKey = "tapoo.v0.1.interactive.gameSetup"
    window.localStorage.setItem(staleKey, "old")
    const onProceed = vi.fn()

    requireStaleDataAcknowledgement(elements, onProceed)

    expect(elements.infoGate.hidden).toBe(false)
    expect(onProceed).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(staleKey)).toBe("old")

    elements.infoGateProceed.click()

    expect(window.localStorage.getItem(staleKey)).toBeNull()
    expect(onProceed).toHaveBeenCalledTimes(1)
  })

  // The census reaches the copy intact, including the dotted version a naive split would truncate.
  it("names one leftover entry in the singular", () => {
    const elements = gateElements()
    window.localStorage.setItem("tapoo.v4.82.agent-api.agentConfigs", "old")

    requireStaleDataAcknowledgement(elements, vi.fn())

    expect(elements.infoGateDetail.textContent).toBe(INFO_GATE_NOTICES.staleStorage.detailTemplate
        .replace("{items}", "1 entry")
        .replace("{versions}", "version (4.82)"),
    )
    expect(elements.infoGateDetail.hidden).toBe(false)
    expect(elements.infoGateTitle.textContent).toBe(INFO_GATE_NOTICES.staleStorage.title)
  })

  // Both counts pluralise independently, and both stores are counted together.
  it("pluralises the entry count and the version list separately", () => {
    const elements = gateElements()
    window.localStorage.setItem("tapoo.v0.1.interactive.gameSetup", "old")
    window.localStorage.setItem("tapoo.v0.1.interactive.winMetrics", "old")
    window.sessionStorage.setItem("tapoo.v0.2.agent-api.agentSessionMetrics", "old")

    requireStaleDataAcknowledgement(elements, vi.fn())

    expect(elements.infoGateDetail.textContent).toBe(INFO_GATE_NOTICES.staleStorage.detailTemplate
        .replace("{items}", "3 entries")
        .replace("{versions}", "versions (0.1, 0.2)"),
    )
  })

  // Several entries written by a single old version must not read as plural versions.
  it("keeps the version singular when one version wrote several entries", () => {
    const elements = gateElements()
    window.localStorage.setItem("tapoo.v0.1.interactive.gameSetup", "old")
    window.localStorage.setItem("tapoo.v0.1.interactive.winMetrics", "old")

    requireStaleDataAcknowledgement(elements, vi.fn())

    expect(elements.infoGateDetail.textContent).toBe(INFO_GATE_NOTICES.staleStorage.detailTemplate
        .replace("{items}", "2 entries")
        .replace("{versions}", "version (0.1)"),
    )
  })
})
