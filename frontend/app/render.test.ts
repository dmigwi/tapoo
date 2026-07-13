import { beforeEach, describe, expect, it, vi } from "vitest"

import { GameClock } from "./clock"
import { CONFIG } from "./config"
import { render } from "./render"
import type { Elements, State } from "./types"

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
    controlMode: "keyboard",
    level: 1,
    dims: { length: 2, width: 2 },
    maze: [
      ["|", "---", "|", "---", "|"],
      ["|", "   ", " ", "   ", "|"],
      ["|", "---", "|", "---", "|"],
      ["|", "   ", "|", "   ", "|"],
      ["|", "---", "|", "---", "|"],
    ],
    playerPosition: [1, 1],
    finalPosition: [1, 2],
    status: "running",
    score: 900,
    lastRoundScore: 0,
    lastAttemptRetention: null,
    bestWinRetention: null,
    winSummary: "",
    canResume: false,
    wallWeight: 1,
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
        dims: null,
        maze: null,
        playerPosition: null,
        finalPosition: null,
        status: "too-small",
      }),
    )

    const text = normalizeScreenText(elements.screen.textContent)

    expect(text).toContain(CONFIG.navigationCompact)
    expect(text).toContain("Level 1 needs more screen room!")
    expect(text).toContain(CONFIG.tooSmallActionMessage)
  })

  it("renders the maze, markers, and running status line", () => {
    const elements = createElements()

    render(elements, createState())

    const text = normalizeScreenText(elements.screen.textContent)

    expect(text).toContain(CONFIG.navigation)
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

  it("hides touch controls when the agents control mode is active", () => {
    const elements = createElements()

    render(
      elements,
      createState({
        controlMode: "agents",
      }),
    )

    expect(elements.touchControls.hidden).toBe(true)
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

  it("shows paused overlay messaging and walls plus proceed touch controls", () => {
    const elements = createElements()

    render(
      elements,
      createState({
        status: "paused",
        canResume: true,
      }),
    )

    const text = normalizeScreenText(elements.screen.textContent)

    expect(text).toContain(CONFIG.pauseMessage)
    expect(text).toContain(CONFIG.proceedMessage)

    const visibleLabels = elements.touchButtons
      .filter((button) => !button.hidden)
      .map((button) => button.dataset.action ?? button.dataset.move)

    expect(visibleLabels).toEqual(["walls", "proceed"])
    expect(
      elements.touchControls.classList.contains("touch-controls--action-pair"),
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

    expect(text).toContain(CONFIG.touchProceedMessage)
    expect(text).not.toContain(CONFIG.proceedMessage)
  })

  it("shows walls plus proceed touch controls after a win", () => {
    const elements = createElements()

    render(
      elements,
      createState({
        dims: { length: 3, width: 3 },
        level: 3,
        status: "won",
        lastRoundScore: 900,
        winSummary: "1.20s faster than previous (new record)",
      }),
    )

    const text = normalizeScreenText(elements.screen.textContent)

    expect(text).toContain(CONFIG.successMessage)
    expect(text).toContain(CONFIG.proceedMessage)
    expect(text).toContain("Final Level 3 Scores:  900 (100% retention)")
    expect(text).toContain("1.20s faster than previous (new record)")

    const visibleLabels = elements.touchButtons
      .filter((button) => !button.hidden)
      .map((button) => button.dataset.action ?? button.dataset.move)

    expect(visibleLabels).toEqual(["walls", "proceed"])
    expect(
      elements.touchControls.classList.contains("touch-controls--action-pair"),
    ).toBe(true)
  })

  it("shows a Level 1 win summary when prior metrics exist", () => {
    const elements = createElements()

    render(
      elements,
      createState({
        dims: { length: 3, width: 3 },
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

    expect(text).toContain(CONFIG.failedMessage)
    expect(text).toContain(CONFIG.proceedMessage)
    expect(text).not.toContain("Final Level 3 Scores:")
  })

  it("shows the too-small message without proceed touch controls", () => {
    const elements = createElements()

    render(
      elements,
      createState({
        dims: null,
        maze: null,
        playerPosition: null,
        finalPosition: null,
        status: "too-small",
      }),
    )

    const text = normalizeScreenText(elements.screen.textContent)

    expect(text).toContain("Level 1 needs more screen room!")
    expect(text).toContain(CONFIG.tooSmallActionMessage)

    const visibleLabels = elements.touchButtons
      .filter((button) => !button.hidden)
      .map((button) => button.dataset.action ?? button.dataset.move)

    expect(visibleLabels).toEqual([])
    expect(
      elements.touchControls.classList.contains("touch-controls--action-pair"),
    ).toBe(false)
    expect(
      elements.touchControls.classList.contains(
        "touch-controls--single-action",
      ),
    ).toBe(false)
    expect(elements.touchControls.hidden).toBe(true)
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
        dims: null,
        maze: null,
        playerPosition: null,
        finalPosition: null,
        status: "too-small",
      }),
    )

    const text = normalizeScreenText(elements.screen.textContent)

    expect(text).toContain(CONFIG.navigationCompact)
    expect(text).toContain("Level 1 needs more screen room!")
    expect(text).toContain(CONFIG.tooSmallActionMessage)
    expect(elements.touchControls.hidden).toBe(true)
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

    expect(text).toContain(CONFIG.navigationCompact)
    expect(text).not.toContain(CONFIG.navigation)
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

    expect(text).toContain(CONFIG.navigation)
    expect(text).not.toContain(CONFIG.navigationCompact)
  })
})
