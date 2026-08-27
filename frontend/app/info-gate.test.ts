import { describe, expect, it, vi } from "vitest"

import { showInfoGate } from "./info-gate"
import type { InfoGateContent } from "./info-gate"
import type { Elements } from "./types"

// gateElements builds only the nodes showInfoGate touches. The rest of Elements is cast in rather
// than constructed: this module reads five handles and nothing else, and pinning that here means a
// future import of unrelated DOM would fail loudly instead of passing on an accident.
function gateElements(): Elements {
  return {
    infoGate: document.createElement("div"),
    infoGateTitle: document.createElement("strong"),
    infoGateMessage: document.createElement("p"),
    infoGateDetail: document.createElement("p"),
    infoGateProceed: document.createElement("button"),
  } as unknown as Elements
}

const content: InfoGateContent = {
  title: "Stored data from an older version",
  message: "Continuing removes that leftover data.",
  detail: "3 entries stored from version 4.82.",
  proceedLabel: "Proceed",
}

describe("showInfoGate", () => {
  it("renders the caller's copy and shows the overlay", () => {
    const elements = gateElements()
    elements.infoGate.hidden = true

    showInfoGate(elements, content, vi.fn())

    expect(elements.infoGateTitle.textContent).toBe(content.title)
    expect(elements.infoGateMessage.textContent).toBe(content.message)
    expect(elements.infoGateDetail.textContent).toBe(content.detail)
    expect(elements.infoGateDetail.hidden).toBe(false)
    expect(elements.infoGateProceed.textContent).toBe(content.proceedLabel)
    expect(elements.infoGate.hidden).toBe(false)
  })

  it("hides the detail line when the caller has nothing concrete to add", () => {
    const elements = gateElements()

    showInfoGate(elements, { ...content, detail: undefined }, vi.fn())

    expect(elements.infoGateDetail.hidden).toBe(true)
    expect(elements.infoGateDetail.textContent).toBe("")
  })

  // The property the whole gate exists for: proceeding is reachable only through a deliberate act.
  it("does not run onProceed until the button is clicked", () => {
    const elements = gateElements()
    const onProceed = vi.fn()

    showInfoGate(elements, content, onProceed)
    expect(onProceed).not.toHaveBeenCalled()

    elements.infoGateProceed.click()
    expect(onProceed).toHaveBeenCalledTimes(1)
    expect(elements.infoGate.hidden).toBe(true)
  })

  // The handler is unbound *before* onProceed runs, not after, so the continuation cannot be
  // re-entered while it is still executing. Clicking from inside the callback is the direct test of
  // that ordering: were the removal to happen afterwards, this would recurse.
  it("stops listening before running onProceed, so it cannot be re-entered", () => {
    const elements = gateElements()
    const onProceed = vi.fn(() => {
      elements.infoGateProceed.click()
    })

    showInfoGate(elements, content, onProceed)
    elements.infoGateProceed.click()

    expect(onProceed).toHaveBeenCalledTimes(1)
  })

  // A callback that throws does not propagate out of .click() - the browser routes it to
  // window.onerror instead. That is why callers wrap their own continuation (see tapoo.ts) rather
  // than relying on a try/catch around the click, and why the gate is already hidden and unbound
  // by the time the throw happens.
  it("has already hidden and unbound itself when onProceed throws", () => {
    const elements = gateElements()
    let attempts = 0
    const onProceed = vi.fn(() => {
      attempts += 1
      throw new Error("continuation failed")
    })

    const caught: Error[] = []
    const onError = (event: ErrorEvent): void => {
      event.preventDefault()
      caught.push(event.error as Error)
    }

    showInfoGate(elements, content, onProceed)
    window.addEventListener("error", onError)
    elements.infoGateProceed.dispatchEvent(new window.MouseEvent("click"))
    elements.infoGateProceed.dispatchEvent(new window.MouseEvent("click"))
    window.removeEventListener("error", onError)

    // The throw really did happen and really did escape to window.onerror rather than to the
    // caller of dispatchEvent - the whole reason the continuation needs its own try/catch.
    expect(caught.map((error) => error.message)).toEqual(["continuation failed"])
    expect(attempts).toBe(1)
    expect(elements.infoGate.hidden).toBe(true)
  })

  // A second gate must not resurrect the first caller's callback.
  it("routes a later gate's click to only that gate's callback", () => {
    const elements = gateElements()
    const firstProceed = vi.fn()
    const secondProceed = vi.fn()

    showInfoGate(elements, content, firstProceed)
    elements.infoGateProceed.click()

    showInfoGate(elements, content, secondProceed)
    elements.infoGateProceed.click()

    expect(firstProceed).toHaveBeenCalledTimes(1)
    expect(secondProceed).toHaveBeenCalledTimes(1)
  })
})
