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

  it("ignores the floating touch controls when measuring the terminal", async () => {
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

    const touchControlsRect = vi.fn(() => ({
      width: 2_000,
      height: 2_000,
      top: 0,
      right: 2_000,
      bottom: 2_000,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }))

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
    elements.touchControls.getBoundingClientRect = touchControlsRect
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      lineHeight: "20px",
      fontSize: "16px",
    } as CSSStyleDeclaration)

    expect(getTerminalSize()).toEqual({ length: 22, width: 11 })
    expect(touchControlsRect).not.toHaveBeenCalled()
  })
})
