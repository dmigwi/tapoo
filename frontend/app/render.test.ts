import { beforeEach, describe, expect, it, vi } from "vitest"

import { GameClock } from "./clock"
import { CONFIG } from "./config"
import { render } from "./render"
import type { AgentElements, Elements, State, TraversalHistoryEntry } from "./types"

const { messages } = CONFIG

function selfVisit(row: number, col: number): TraversalHistoryEntry {
  return { playerName: CONFIG.runtime.interactivePlayerName, row, col, openMoves: [] }
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
// RenderElements narrows Elements to the two agent overlays these render tests toggle; the rest
// of AgentElements stays optional because the renderer never reads it.
type RenderElements = Elements &
  Required<Pick<AgentElements, "agentConfigForm" | "agentDeleteDialog">>

function createElements(): RenderElements {
  const screen = document.createElement("div")
  const touchControls = document.createElement("div")
  const agentConfigForm = document.createElement("form")
  const agentDeleteDialog = document.createElement("section")
  agentConfigForm.hidden = true
  agentDeleteDialog.hidden = true
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
    agentConfigForm,
    agentDeleteDialog,
  }
}

// createState builds a representative runtime state for render scenarios.
function createState(overrides: Partial<State> = {}): State {
  return {
    controlMode: CONFIG.runtime.controlModes.interactive,
    level: 1,
    mazeDimensions: { numCols: 2, numRows: 2, area: 4 },
    maze: [
      ["|", "---", "|", "---", "|"],
      ["|", "   ", " ", "   ", "|"],
      ["|", "---", "|", "---", "|"],
      ["|", "   ", "|", "   ", "|"],
      ["|", "---", "|", "---", "|"],
    ],
    startPosition: { x: 1, y: 1 },
    playerPosition: { x: 1, y: 1 },
    traversalHistory: [selfVisit(0, 0)],
    finalPosition: { x: 2, y: 1 },
    status: "running",
    score: 900,
    lastRoundScore: 0,
    lastAttemptRetentionUnits: null,
    bestWinRetentionUnits: null,
    lastWinTraversalSpeedUnits: null,
    bestWinTraversalSpeedUnits: null,
    winSummary: "",
    wallWeight: 1,
    scoreDecayUnits: 0,
    turnCount: 0,
    cumulativeRoundCount: 0,
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
    document.documentElement.style.setProperty("--touch-action-button-min-width", "132px")
    document.documentElement.style.setProperty("--touch-controls-gap", "20px")
    document.documentElement.style.setProperty("--touch-controls-padding", "14px")
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

    expect(text).toContain(messages.navigation.interactive.compact)
    expect(text).toContain("Level 1 needs more screen room!")
    expect(text).toContain(messages.tooSmallActionMessage)
  })

  it("renders the maze, markers, and running status line", () => {
    const elements = createElements()

    render(elements, createState())

    const text = normalizeScreenText(elements.screen.textContent)

    expect(text).toContain(messages.navigation.interactive.wide)
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

  it("renders a visited-cell trail for history entries other than the current position", () => {
    const elements = createElements()

    render(
      elements,
      createState({
        traversalHistory: [selfVisit(0, 0), selfVisit(0, 1)],
      }),
    )

    // selfVisit(0, 1) maps to a different rendered point than the default playerPosition
    // {x: 1, y: 1}, so it should be drawn as a visited-trail cell, not overwritten by the
    // player marker.
    expect(elements.screen.innerHTML).toContain('class="maze-cell visited"')
    expect(elements.screen.innerHTML).toContain('class="maze-cell player"')
  })

  it("does not draw a visited marker over the player's own current cell", () => {
    const elements = createElements()

    render(
      elements,
      createState({
        traversalHistory: [selfVisit(0, 0)],
      }),
    )

    // selfVisit(0, 0) maps to the same rendered point as the default playerPosition
    // {x: 1, y: 1}, so the player marker must win there instead of a visited marker.
    expect(elements.screen.innerHTML).not.toContain('class="maze-cell visited"')
    expect(elements.screen.innerHTML).toContain('class="maze-cell player"')
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
    const text = normalizeScreenText(elements.screen.textContent)

    expect(visibleLabels).toEqual(["pause"])
    expect(text).toContain(messages.navigation.agentApi.wide)
    expect(text).not.toContain(messages.navigation.interactive.wide)
    expect(elements.touchControls.hidden).toBe(false)
    expect(
      elements.touchControls.classList.contains("touch-controls--single-action"),
    ).toBe(true)
    expect(elements.agentConfigForm?.hidden).toBe(true)
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
    expect(normalizeScreenText(elements.screen.textContent)).toContain(
      messages.agentAwaitAction.wide,
    )
    expect(elements.agentConfigForm?.hidden).toBe(true)
    expect(elements.touchControls.hidden).toBe(false)
    expect(
      elements.touchControls.classList.contains("touch-controls--action-row"),
    ).toBe(true)
    expect(
      elements.touchControls.style.getPropertyValue("--touch-action-columns"),
    ).toBe("3")
  })

  it("reduces action-row touch columns when the viewport cannot fit three buttons", () => {
    const elements = createElements()
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 320,
    })
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: 320,
    })

    render(
      elements,
      createState({
        controlMode: CONFIG.runtime.controlModes.agentApi,
        status: "await-agent",
      }),
    )

    expect(
      elements.touchControls.classList.contains("touch-controls--action-row"),
    ).toBe(true)
    expect(
      elements.touchControls.style.getPropertyValue("--touch-action-columns"),
    ).toBe("2")
  })

  it("uses compact right-side seat guidance while agent-api waits on small displays", () => {
    const elements = createElements()
    vi.spyOn(elements.body, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 412,
      bottom: 915,
      width: 412,
      height: 915,
      toJSON: () => ({}),
    })
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 412,
    })

    render(
      elements,
      createState({
        controlMode: CONFIG.runtime.controlModes.agentApi,
        status: "await-agent",
      }),
    )

    const text = normalizeScreenText(elements.screen.textContent)

    expect(text).toContain(messages.agentAwaitAction.compact)
    expect(text).not.toContain(messages.proceed.wide)
  })

  it("hides an open agent configuration form when agent-api play starts", () => {
    const elements = createElements()
    elements.agentConfigForm.hidden = false
    elements.agentDeleteDialog.hidden = false
    elements.body.classList.add("terminal-body--agent-form-active")

    render(
      elements,
      createState({
        controlMode: CONFIG.runtime.controlModes.agentApi,
        status: "running",
      }),
    )

    expect(elements.agentConfigForm.hidden).toBe(true)
    expect(elements.agentDeleteDialog?.hidden).toBe(true)
    expect(
      elements.body.classList.contains("terminal-body--agent-form-active"),
    ).toBe(false)
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
      }),
    )

    const text = normalizeScreenText(elements.screen.textContent)

    expect(text).toContain(messages.pauseMessage)
    expect(text).toContain(messages.proceed.wide)

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
      }),
    )

    const text = normalizeScreenText(elements.screen.textContent)

    expect(text).toContain(messages.proceed.compact)
    expect(text).not.toContain(messages.proceed.wide)
  })

  it("shows walls plus proceed touch controls after a win", () => {
    const elements = createElements()

    render(
      elements,
      createState({
        mazeDimensions: { numCols: 3, numRows: 3, area: 9 },
        level: 3,
        status: "won",
        lastRoundScore: 900,
        lastAttemptRetentionUnits: 1_000_000,
        winSummary: "1.20s faster than previous (new record)",
      }),
    )

    const text = normalizeScreenText(elements.screen.textContent)

    expect(text).toContain(messages.success.wide)
    expect(text).toContain(messages.proceed.wide)
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
        mazeDimensions: { numCols: 3, numRows: 3, area: 9 },
        level: 1,
        status: "won",
        lastRoundScore: 900,
        lastAttemptRetentionUnits: 1_000_000,
        winSummary: "1.20s faster than previous (new record)",
      }),
    )

    const text = normalizeScreenText(elements.screen.textContent)

    expect(text).toContain("Final Level 1 Scores:  900 (100% retention)")
    expect(text).toContain("1.20s faster than previous (new record)")
  })

  it("uses stored retention units for the final displayed percentage", () => {
    const elements = createElements()

    render(
      elements,
      createState({
        mazeDimensions: { numCols: 3, numRows: 3, area: 9 },
        status: "won",
        lastRoundScore: 1,
        lastAttemptRetentionUnits: 500_000,
      }),
    )

    const text = normalizeScreenText(elements.screen.textContent)

    expect(text).toContain("Final Level 1 Scores:  1 (50% retention)")
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

    expect(text).toContain(messages.failed.wide)
    expect(text).toContain(messages.proceed.wide)
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
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 360,
    })
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 420,
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

    expect(text).toContain(messages.navigation.interactive.compact)
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

    expect(text).toContain(messages.navigation.interactive.compact)
    expect(text).not.toContain(messages.navigation.interactive.wide)
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

    expect(text).toContain(messages.navigation.interactive.wide)
    expect(text).not.toContain(messages.navigation.interactive.compact)
  })
})
