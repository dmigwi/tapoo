import { beforeEach, describe, expect, it, vi } from "vitest"

import { GameClock } from "./clock"
import { CONFIG } from "./config"
import { render } from "./render"
import type { Elements, State, TraversalHistoryEntry } from "./types"

const { messages } = CONFIG

function visit(row: number, col: number): TraversalHistoryEntry {
  return { playerName: "Blue", row, col }
}

// normalizeScreenText keeps DOM assertions readable by collapsing non-breaking spaces.
function normalizeScreenText(value: string | null): string {
  return (value ?? "").replaceAll("\u00a0", " ")
}

// createButton reproduces the control-button dataset contract expected by the renderer.
function createButton({
  action,
  move,
}: {
  action?: string
  move?: string
}): HTMLButtonElement {
  const button = document.createElement("button")

  if (action) {
    button.dataset.action = action
  }

  if (move) {
    button.dataset.move = move
    button.dataset.touchControl = "true"
  }

  return button
}

// createElements assembles the DOM shell consumed by the renderer during tests.
function createElements(): Elements {
  const screen = document.createElement("div")
  const touchControls = document.createElement("div")
  const touchButtons = [
    createButton({ action: "walls" }),
    createButton({ move: "MoveUp" }),
    createButton({ action: "proceed" }),
    createButton({ move: "MoveLeft" }),
    createButton({ move: "MoveRight" }),
    createButton({ move: "MoveDown" }),
    createButton({ action: "pause" }),
    createButton({ action: "restart" }),
  ]

  return {
    app: document.createElement("div"),
    body: document.createElement("div"),
    screen,
    measure: document.createElement("div"),
    controls: [],
    touchControls,
    touchButtons,
  }
}

// createState builds a representative runtime state for render scenarios.
function createState(overrides: Partial<State> = {}): State {
  return {
    controlMode: CONFIG.runtime.controlModes.interactive,
    level: 1,
    mazeDimensions: { length: 2, width: 2 },
    maze: [
      ["|", "---", "|", "---", "|"],
      ["|", "   ", " ", "   ", "|"],
      ["|", "---", "|", "---", "|"],
      ["|", "   ", "|", "   ", "|"],
      ["|", "---", "|", "---", "|"],
    ],
    playerPosition: { x: 1, y: 1 },
    traversalHistory: [visit(0, 0)],
    finalPosition: { x: 2, y: 1 },
    status: "running",
    score: 900,
    lastRoundScore: 0,
    lastAttemptRetention: null,
    bestWinRetention: null,
    lastWinRequestCount: null,
    bestWinRequestCount: null,
    winSummary: "",
    canResume: false,
    wallWeight: 1,
    scoreDecayUnits: 0,
    agentRequestCount: 0,
    clock: null,
    ...overrides,
  }
}

// These tests keep browser terminal output and touch-control visibility consistent.
describe("render", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    )

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1024,
    })
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 768,
    })
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: 1024,
    })
    Object.defineProperty(document.documentElement, "clientHeight", {
      configurable: true,
      value: 768,
    })
    Object.defineProperty(window.screen, "width", {
      configurable: true,
      value: 1024,
    })
    Object.defineProperty(window.screen, "height", {
      configurable: true,
      value: 768,
    })
    Object.defineProperty(window.screen, "availWidth", {
      configurable: true,
      value: 1024,
    })
    Object.defineProperty(window.screen, "availHeight", {
      configurable: true,
      value: 768,
    })
    Reflect.deleteProperty(window, "visualViewport")
  })

  it("uses shared compact copy when the viewport width is narrow", () => {
    const elements = createElements()
    vi.spyOn(elements.body, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 620,
      bottom: 915,
      width: 620,
      height: 915,
      toJSON: () => ({}),
    })
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 412,
    })
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 915,
    })

    render(
      elements,
      createState({
        mazeDimensions: null,
        maze: null,
        playerPosition: null,
        finalPosition: null,
        status: "too-small",
      }),
    )

    const text = normalizeScreenText(elements.screen.textContent)

    expect(text).toContain(messages.navigation.compact)
    expect(text).toContain("Level 1 needs more screen room!")
    expect(text).toContain(messages.tooSmallActionMessage)
  })

  it("renders the maze, markers, and running status line", () => {
    const elements = createElements()

    render(elements, createState())

    const text = normalizeScreenText(elements.screen.textContent)

    expect(text).toContain(messages.navigation.default)
    expect(text).toContain("Level: 1")
    expect(text).toContain("Scores: 900")
    expect(elements.screen.innerHTML).toContain('class="maze-cell player"')
    expect(elements.screen.innerHTML).toContain('class="maze-cell target"')

    const visibleLabels = elements.touchButtons
      .filter((button) => !button.hidden)
      .map((button) => button.dataset.action ?? button.dataset.move)

    expect(visibleLabels).toEqual([
      "MoveUp",
      "MoveLeft",
      "MoveRight",
      "MoveDown",
      "pause",
    ])
  })

  it("shows only local action touch controls when the agent-api mode is active", () => {
    const elements = createElements()

    render(
      elements,
      createState({
        controlMode: CONFIG.runtime.controlModes.agentApi,
      }),
    )

    const visibleLabels = elements.touchButtons
      .filter((button) => !button.hidden)
      .map((button) => button.dataset.action ?? button.dataset.move)

    expect(visibleLabels).toEqual(["pause"])
    expect(elements.touchControls.hidden).toBe(false)
    expect(
      elements.touchControls.classList.contains("touch-controls--single-action"),
    ).toBe(true)
  })

  it("shows walls, proceed, and reset progress while agent-api waits for configuration", () => {
    const elements = createElements()

    render(
      elements,
      createState({
        controlMode: CONFIG.runtime.controlModes.agentApi,
        status: "await-agent",
      }),
    )

    const visibleLabels = elements.touchButtons
      .filter((button) => !button.hidden)
      .map((button) => button.dataset.action ?? button.dataset.move)

    expect(visibleLabels).toEqual(["walls", "proceed", "restart"])
    expect(elements.touchControls.hidden).toBe(false)
    expect(
      elements.touchControls.classList.contains("touch-controls--action-row"),
    ).toBe(true)
  })

  it("skips drawing the destination while a running round blink phase is off", () => {
    const elements = createElements()
    const clock = new GameClock(10_000)
    clock.blink = () => false

    render(
      elements,
      createState({
        clock,
      }),
    )

    expect(elements.screen.innerHTML).not.toContain('class="maze-cell target"')
  })

  it("keeps drawing the destination when no active blink clock is present", () => {
    const elements = createElements()

    render(
      elements,
      createState({
        clock: null,
      }),
    )

    expect(elements.screen.innerHTML).toContain('class="maze-cell target"')
  })

  it("shows paused overlay messaging and walls, proceed, plus reset touch controls", () => {
    const elements = createElements()

    render(
      elements,
      createState({
        status: "paused",
        canResume: true,
      }),
    )

    const text = normalizeScreenText(elements.screen.textContent)

    expect(text).toContain(messages.pauseMessage)
    expect(text).toContain(messages.proceedMessage)

    const visibleLabels = elements.touchButtons
      .filter((button) => !button.hidden)
      .map((button) => button.dataset.action ?? button.dataset.move)

    expect(visibleLabels).toEqual(["walls", "proceed", "restart"])
    expect(
      elements.touchControls.classList.contains("touch-controls--action-row"),
    ).toBe(true)
    expect(
      elements.touchControls.classList.contains(
        "touch-controls--single-action",
      ),
    ).toBe(false)
  })

  it("uses the touch proceed message when the real viewport is compact", () => {
    const elements = createElements()
    vi.spyOn(elements.body, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 620,
      bottom: 915,
      width: 620,
      height: 915,
      toJSON: () => ({}),
    })
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 980,
    })
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 915,
    })
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: 412,
    })
    Object.defineProperty(document.documentElement, "clientHeight", {
      configurable: true,
      value: 915,
    })
    Object.defineProperty(window.screen, "width", {
      configurable: true,
      value: 412,
    })
    Object.defineProperty(window.screen, "height", {
      configurable: true,
      value: 915,
    })
    Object.defineProperty(window.screen, "availWidth", {
      configurable: true,
      value: 412,
    })
    Object.defineProperty(window.screen, "availHeight", {
      configurable: true,
      value: 915,
    })

    render(
      elements,
      createState({
        status: "paused",
        canResume: true,
      }),
    )

    const text = normalizeScreenText(elements.screen.textContent)

    expect(text).toContain(messages.touchProceedMessage)
    expect(text).not.toContain(messages.proceedMessage)
  })

  it("shows walls plus proceed touch controls after a win", () => {
    const elements = createElements()

    render(
      elements,
      createState({
        mazeDimensions: { length: 3, width: 3 },
        level: 3,
        status: "won",
        lastRoundScore: 900,
        winSummary: "1.20s faster than previous (new record)",
      }),
    )

    const text = normalizeScreenText(elements.screen.textContent)

    expect(text).toContain(messages.successMessage)
    expect(text).toContain(messages.proceedMessage)
    expect(text).toContain("Final Level 3 Scores:  900 (100% retention)")
    expect(text).toContain("1.20s faster than previous (new record)")

    const visibleLabels = elements.touchButtons
      .filter((button) => !button.hidden)
      .map((button) => button.dataset.action ?? button.dataset.move)

    expect(visibleLabels).toEqual(["walls", "proceed", "restart"])
    expect(
      elements.touchControls.classList.contains("touch-controls--action-row"),
    ).toBe(true)
  })

  it("shows a Level 1 win summary when prior metrics exist", () => {
    const elements = createElements()

    render(
      elements,
      createState({
        mazeDimensions: { length: 3, width: 3 },
        level: 1,
        status: "won",
        lastRoundScore: 900,
        winSummary: "1.20s faster than previous (new record)",
      }),
    )

    const text = normalizeScreenText(elements.screen.textContent)

    expect(text).toContain("Final Level 1 Scores:  900 (100% retention)")
    expect(text).toContain("1.20s faster than previous (new record)")
  })

  it("keeps the loss overlay free of the final score summary", () => {
    const elements = createElements()

    render(
      elements,
      createState({
        level: 3,
        status: "lost",
        lastRoundScore: 0,
      }),
    )

    const text = normalizeScreenText(elements.screen.textContent)

    expect(text).toContain(messages.failedMessage)
    expect(text).toContain(messages.proceedMessage)
    expect(text).not.toContain("Final Level 3 Scores:")
  })

  it("shows the too-small message with reset progress as the only touch control", () => {
    const elements = createElements()

    render(
      elements,
      createState({
        mazeDimensions: null,
        maze: null,
        playerPosition: null,
        finalPosition: null,
        status: "too-small",
      }),
    )

    const text = normalizeScreenText(elements.screen.textContent)

    expect(text).toContain("Level 1 needs more screen room!")
    expect(text).toContain(messages.tooSmallActionMessage)

    const visibleLabels = elements.touchButtons
      .filter((button) => !button.hidden)
      .map((button) => button.dataset.action ?? button.dataset.move)

    expect(visibleLabels).toEqual(["restart"])
    expect(
      elements.touchControls.classList.contains("touch-controls--action-row"),
    ).toBe(true)
    expect(
      elements.touchControls.classList.contains(
        "touch-controls--single-action",
      ),
    ).toBe(true)
    expect(elements.touchControls.hidden).toBe(false)
  })

  it("shows compact navigation and too-small messaging on narrow screens", () => {
    const elements = createElements()
    elements.body.getBoundingClientRect = vi.fn(() => ({
      width: 360,
      height: 420,
      top: 0,
      right: 360,
      bottom: 420,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }))

    render(
      elements,
      createState({
        mazeDimensions: null,
        maze: null,
        playerPosition: null,
        finalPosition: null,
        status: "too-small",
      }),
    )

    const text = normalizeScreenText(elements.screen.textContent)

    expect(text).toContain(messages.navigation.compact)
    expect(text).toContain("Level 1 needs more screen room!")
    expect(text).toContain(messages.tooSmallActionMessage)
    expect(elements.touchControls.hidden).toBe(false)
  })

  it("shows compact navigation on a 412px wide phone viewport", () => {
    const elements = createElements()
    elements.body.getBoundingClientRect = vi.fn(() => ({
      width: 620,
      height: 896,
      top: 0,
      right: 620,
      bottom: 896,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }))
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 412,
    })
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 915,
    })
    Object.defineProperty(window.screen, "width", {
      configurable: true,
      value: 412,
    })
    Object.defineProperty(window.screen, "height", {
      configurable: true,
      value: 915,
    })
    Object.defineProperty(window.screen, "availWidth", {
      configurable: true,
      value: 412,
    })
    Object.defineProperty(window.screen, "availHeight", {
      configurable: true,
      value: 915,
    })

    render(elements, createState())

    const text = normalizeScreenText(elements.screen.textContent)

    expect(text).toContain(messages.navigation.compact)
    expect(text).not.toContain(messages.navigation.default)
  })

  it("keeps the full keyboard navigation on medium-width screens", () => {
    const elements = createElements()
    elements.body.getBoundingClientRect = vi.fn(() => ({
      width: 600,
      height: 896,
      top: 0,
      right: 600,
      bottom: 896,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }))

    render(elements, createState())

    const text = normalizeScreenText(elements.screen.textContent)

    expect(text).toContain(messages.navigation.default)
    expect(text).not.toContain(messages.navigation.compact)
  })
})
