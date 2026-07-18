import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { BaseDimensions, LevelDimensions } from "./types"

function highestContinuousDrawableLevel(
  getMazeDimensions: (
    level: number,
    terminalSize: BaseDimensions,
  ) => LevelDimensions | null,
  terminalSize: BaseDimensions,
  maxLevel: number,
): LevelDimensions | null {
  let highestLevel: LevelDimensions | null = null

  for (let level = 1; level <= maxLevel; level += 1) {
    const dimensions = getMazeDimensions(level, terminalSize)
    if (!dimensions) {
      return highestLevel
    }

    if (dimensions) {
      highestLevel = dimensions
    }
  }

  return highestLevel
}

// setupTerminalDom recreates the minimal browser terminal shell used by DOM tests.
function setupTerminalDom(): void {
  document.body.innerHTML = `
    <div id="terminal-app"></div>
    <div id="terminal-body"></div>
    <div id="terminal-screen"></div>
    <div id="terminal-measure"></div>
    <div id="touch-controls"></div>
    <div id="agent-seat-roster"></div>
    <form id="agent-config-form"></form>
    <input id="agent-config-player-name" />
    <input id="agent-config-model" />
    <input id="agent-config-endpoint" />
    <input id="agent-config-enabled" />
    <span id="agent-config-enabled-label"></span>
    <button id="agent-config-close"></button>
    <p id="agent-config-status"></p>
    <section id="agent-delete-dialog"></section>
    <p id="agent-delete-target"></p>
    <input id="agent-delete-enabled" />
    <span id="agent-delete-enabled-label"></span>
    <button id="agent-delete-apply"></button>
    <input id="agent-delete-confirm" />
    <button id="agent-delete-close"></button>
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

  it("documents the maximum level for the observed 14-inch CSS viewport", async () => {
    const { getMazeDimensions } = await import("./maze")
    const { getGameElements, getTerminalSize } = await import("./dom")
    const elements = getGameElements()
    if (!elements) {
      throw new Error("expected terminal elements")
    }

    elements.body.getBoundingClientRect = vi.fn(() => ({
      width: 1_512,
      height: 982,
      top: 0,
      right: 1_512,
      bottom: 982,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }))
    // These measurements approximate a 14-inch MacBook-class display in a normal browser window:
    // physical panel: 3024x1964px, browser CSS viewport: about 1512x982px after device scaling.
    // The game converts that CSS viewport into terminal cells by measuring rendered text:
    // 10 sample characters occupy roughly 60 CSS px, and one text row is roughly 11 CSS px tall.
    // After subtracting app chrome/insets, that produces a logical maze room of 61x39 cells.
    // The sampled drawable levels 47, 53, 55, 109, and 150 confirm the modeled room is realistic.
    elements.measure.getBoundingClientRect = vi.fn(() => ({
      width: 60,
      height: 11,
      top: 0,
      right: 60,
      bottom: 11,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }))
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      lineHeight: "20px",
      fontSize: "16px",
    } as CSSStyleDeclaration)

    const terminalSize = getTerminalSize(elements)
    expect(terminalSize).toEqual({ length: 61, width: 39 })
    expect(getMazeDimensions(47, terminalSize)).toEqual({
      level: 47,
      length: 53,
      width: 10,
    })
    expect(getMazeDimensions(53, terminalSize)).toEqual({
      level: 53,
      length: 59,
      width: 10,
    })
    expect(getMazeDimensions(55, terminalSize)).toEqual({
      level: 55,
      length: 61,
      width: 10,
    })
    expect(getMazeDimensions(109, terminalSize)).toEqual({
      level: 109,
      length: 46,
      width: 25,
    })
    expect(highestContinuousDrawableLevel(getMazeDimensions, terminalSize, 500)).toEqual({
      level: 150,
      length: 40,
      width: 39,
    })
    expect(getMazeDimensions(151, terminalSize)).toBeNull()
  })

  it("returns null when the page does not include a terminal game host", async () => {
    document.body.innerHTML = `<main></main>`

    const { getGameElements } = await import("./dom")

    expect(getGameElements()).toBeNull()
  })
})
