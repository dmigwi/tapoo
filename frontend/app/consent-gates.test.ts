import { beforeEach, describe, expect, it, vi } from "vitest"

import { CONFIG, INFO_GATE_NOTICES, STORE_PRIVACY_ACK } from "./config"
import { requireAcknowledgement } from "./consent-gates"
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
    infoGateLink: document.createElement("a"),
    infoGateProceed: document.createElement("button"),
  } as unknown as Elements
}

const currentKey = `tapoo.v${CONFIG.runtime.storage.version}.interactive.gameSetup`

// Both suites drive requireAcknowledgement, the module's only export, and neutralise the gate they
// are not testing - the privacy one by pre-acknowledging it, the stale one by leaving no stale keys.
// Testing the composition rather than the private halves means these also cover the wiring between
// them, which is where a gate would go missing.
describe("stale data gate", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createMemoryStorage(),
    })
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: createMemoryStorage(),
    })
    // Already acknowledged, so the privacy gate is a pass-through and only the stale gate is
    // exercised by what follows.
    window.localStorage.setItem(STORE_PRIVACY_ACK, "true")
  })

  // An ordinary start has to be indistinguishable from before the gate existed: no deferred
  // callback, and no frame in which the overlay could appear.
  it("proceeds synchronously and shows nothing when no older version left anything", () => {
    const elements = gateElements()
    elements.infoGate.hidden = true
    window.localStorage.setItem(currentKey, "current")
    const onProceed = vi.fn()

    requireAcknowledgement(elements, onProceed)

    expect(onProceed).toHaveBeenCalledTimes(1)
    expect(elements.infoGate.hidden).toBe(true)
  })

  it("holds onProceed and leaves stale keys alone until the user agrees", () => {
    const elements = gateElements()
    const staleKey = "tapoo.v0.1.interactive.gameSetup"
    window.localStorage.setItem(staleKey, "old")
    const onProceed = vi.fn()

    requireAcknowledgement(elements, onProceed)

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

    requireAcknowledgement(elements, vi.fn())

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

    requireAcknowledgement(elements, vi.fn())

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

    requireAcknowledgement(elements, vi.fn())

    expect(elements.infoGateDetail.textContent).toBe(INFO_GATE_NOTICES.staleStorage.detailTemplate
        .replace("{items}", "2 entries")
        .replace("{versions}", "version (0.1)"),
    )
  })
})

describe("requireAcknowledgement", () => {
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

  // Order is load-bearing, not incidental: the stale gate deletes data, and deleting is itself an
  // operation on the user's data. Asking it before the policy that governs it has been accepted
  // would act first and ask afterwards. One gate is shown at a time for a separate reason - two
  // stacked acknowledgements read as one prompt with two buttons.
  it("asks for the privacy policy first, then stale data, and starts only after both", () => {
    const elements = gateElements()
    const onProceed = vi.fn()
    const staleKey = `tapoo.v0.1.interactive.gameSetup`
    window.localStorage.setItem(staleKey, "old")

    requireAcknowledgement(elements, onProceed)

    // First gate: the privacy one. Nothing has been deleted, and nothing has been recorded as
    // acknowledged either - the stale key is exactly as it was.
    expect(elements.infoGateTitle.textContent).toBe(INFO_GATE_NOTICES.privacyPolicy.title)
    expect(window.localStorage.getItem(STORE_PRIVACY_ACK)).toBeNull()
    expect(window.localStorage.getItem(staleKey)).toBe("old")
    expect(onProceed).not.toHaveBeenCalled()

    elements.infoGateProceed.click()

    // Second gate: the stale-data one, raised only now that the policy covering the deletion has
    // been accepted. The key still survives until this gate is answered too.
    expect(window.localStorage.getItem(STORE_PRIVACY_ACK)).toBe("true")
    expect(elements.infoGateTitle.textContent).toBe(INFO_GATE_NOTICES.staleStorage.title)
    expect(window.localStorage.getItem(staleKey)).toBe("old")
    expect(onProceed).not.toHaveBeenCalled()

    elements.infoGateProceed.click()

    expect(window.localStorage.getItem(staleKey)).toBeNull()
    expect(onProceed).toHaveBeenCalledTimes(1)
    expect(elements.infoGate.hidden).toBe(true)
  })

  // The ordinary start: nothing stale, already acknowledged. No overlay frame, no deferred callback.
  it("starts synchronously when neither gate applies", () => {
    const elements = gateElements()
    elements.infoGate.hidden = true
    window.localStorage.setItem(STORE_PRIVACY_ACK, "true")
    const onProceed = vi.fn()

    requireAcknowledgement(elements, onProceed)

    expect(onProceed).toHaveBeenCalledTimes(1)
    expect(elements.infoGate.hidden).toBe(true)
  })
})

describe("privacy policy gate", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createMemoryStorage(),
    })
  })

  it("shows the privacy gate until the user acknowledges it", () => {
    const elements = gateElements()
    elements.infoGate.hidden = true
    const onProceed = vi.fn()

    requireAcknowledgement(elements, onProceed)

    expect(elements.infoGate.hidden).toBe(false)
    expect(elements.infoGateTitle.textContent).toBe(INFO_GATE_NOTICES.privacyPolicy.title)
    expect(elements.infoGateMessage.textContent).toBe(INFO_GATE_NOTICES.privacyPolicy.acknowledgement)
    expect(elements.infoGateDetail.textContent).toBe(INFO_GATE_NOTICES.privacyPolicy.detail)
    expect(onProceed).not.toHaveBeenCalled()

    elements.infoGateProceed.click()

    expect(onProceed).toHaveBeenCalledTimes(1)
    expect(window.localStorage.getItem(STORE_PRIVACY_ACK)).toBe("true")
  })

  it("proceeds synchronously once the IndexedDB logs gate was already acknowledged", () => {
    const elements = gateElements()
    elements.infoGate.hidden = true
    window.localStorage.setItem(STORE_PRIVACY_ACK, "true")
    const onProceed = vi.fn()

    requireAcknowledgement(elements, onProceed)

    expect(onProceed).toHaveBeenCalledTimes(1)
    expect(elements.infoGate.hidden).toBe(true)
  })
})
