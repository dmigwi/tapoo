import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

function setupTerminalDom(): void {
  document.body.innerHTML = `
    <div id="terminal-app"></div>
    <div id="terminal-body"></div>
    <div id="terminal-screen"></div>
    <div id="terminal-measure"></div>
    <div id="touch-controls"></div>
  `
}

describe("dom", () => {
  beforeEach(() => {
    vi.resetModules()
    setupTerminalDom()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("detects touch mode when touch capabilities are available", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query === "(pointer: coarse)",
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    )
    Object.defineProperty(navigator, "maxTouchPoints", {
      configurable: true,
      value: 1,
    })

    const { detectInputMode } = await import("./dom")

    expect(detectInputMode()).toBe("touch")
  })

  it("applies touch mode styling and visibility to the terminal shell", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation(() => ({
        matches: false,
        media: "",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    )

    const { applyInputMode, elements } = await import("./dom")

    applyInputMode("touch")
    expect(elements.app.classList.contains("terminal-app--touch")).toBe(true)
    expect(elements.touchControls.hidden).toBe(false)

    applyInputMode("keyboard")
    expect(elements.app.classList.contains("terminal-app--touch")).toBe(false)
    expect(elements.touchControls.hidden).toBe(true)
  })

  it("computes maze dimensions from the measured terminal size", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation(() => ({
        matches: false,
        media: "",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    )

    const { elements, getTerminalSize } = await import("./dom")

    elements.body.getBoundingClientRect = vi.fn(() => ({
      width: 960,
      height: 640,
      top: 0,
      right: 960,
      bottom: 640,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }))
    elements.measure.getBoundingClientRect = vi.fn(() => ({
      width: 100,
      height: 20,
      top: 0,
      right: 100,
      bottom: 20,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }))
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      lineHeight: "20px",
      fontSize: "16px",
    } as CSSStyleDeclaration)

    expect(getTerminalSize()).toEqual({ length: 22, width: 11 })
  })
})
