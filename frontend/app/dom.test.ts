import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// setupTerminalDom recreates the minimal browser terminal shell used by DOM tests.
function setupTerminalDom(): void {
  document.body.innerHTML = `
    <div id="terminal-app"></div>
    <div id="terminal-body"></div>
    <div id="terminal-screen"></div>
    <div id="terminal-measure"></div>
    <div id="touch-controls"></div>
    <form id="agent-config-form"></form>
    <input id="agent-config-player-name" />
    <input id="agent-config-model" />
    <input id="agent-config-endpoint" />
    <input id="agent-config-enabled" />
    <button id="agent-config-close"></button>
    <p id="agent-config-status"></p>
  `
}

// These tests lock down DOM discovery and viewport-based terminal measurements.
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

    const { getGameElements, getTerminalSize } = await import("./dom")
    const elements = getGameElements()
    if (!elements) {
      throw new Error("expected terminal elements")
    }

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

    expect(getTerminalSize(elements)).toEqual({ length: 22, width: 11 })
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

    const { getGameElements, getTerminalSize } = await import("./dom")
    const elements = getGameElements()
    if (!elements) {
      throw new Error("expected terminal elements")
    }

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

    expect(getTerminalSize(elements)).toEqual({ length: 22, width: 11 })
    expect(touchControlsRect).not.toHaveBeenCalled()
  })

  it("returns null when the page does not include a terminal game host", async () => {
    document.body.innerHTML = `<main></main>`

    const { getGameElements } = await import("./dom")

    expect(getGameElements()).toBeNull()
  })
})
