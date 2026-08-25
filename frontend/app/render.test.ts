import { beforeEach, describe, expect, it, vi } from "vitest"

import { GameClock } from "./clock"
import { CONFIG } from "./config"
import { formatPlayerStatusLabel } from "./agent/efficiency"
import { fitPlayerSegmentToWidth, render } from "./render"
import type { AgentElements, Elements, State, TraversalHistoryEntry } from "./types"

const { messages } = CONFIG

function selfVisit(row: number, col: number): TraversalHistoryEntry {
  return { playerName: CONFIG.runtime.interactivePlayerName, row, col, openMoves: [], visitCount: 1 }
}

// normalizeScreenText keeps DOM assertions readable by collapsing non-breaking spaces.
function normalizeScreenText(value: string | null): string {
  return (value ?? "").replaceAll("\u00a0", " ")
}

// statusLineText isolates just the running-status row's exact text for precise assertions,
// rather than matching a substring against the whole screen (which also contains the maze and
// navigation hint). Both the navigation hint and the status line share the same
// "screen-text centered" class, but buildScreenLines always appends the status row last.
function statusLineText(elements: { screen: HTMLElement }): string {
  const rows = elements.screen.querySelectorAll<HTMLElement>(".screen-text.centered")
  return normalizeScreenText(rows[rows.length - 1]?.textContent ?? null)
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
  Required<Pick<AgentElements, "agentConfigForm" | "agentManageDialog">>

function createElements(): RenderElements {
  const screen = document.createElement("div")
  const touchControls = document.createElement("div")
  const agentConfigForm = document.createElement("form")
  const agentManageDialog = document.createElement("section")
  agentConfigForm.hidden = true
  agentManageDialog.hidden = true
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
    zoomPlaceholder: document.createElement("div"),
    infoGate: document.createElement("div"),
    infoGateTitle: document.createElement("strong"),
    infoGateMessage: document.createElement("p"),
    infoGateDetail: document.createElement("p"),
    infoGateProceed: document.createElement("button"),
    touchButtons,
    agentConfigForm,
    agentManageDialog,
    agentSeatsBody: document.createElement("div"),
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

    // Too-small has no maze/controls on screen to give navigation instructions about.
    expect(text).not.toContain(messages.navigation.interactive.compact)
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

  it("shows the active agent's name and speed class on the running status line", () => {
    const elements = createElements()
    const currentPlayerLabel = formatPlayerStatusLabel({
      playerName: "Kora",
      uniqueCellsVisited: 12,
      decayUnitsCharged: 10,
    })

    render(
      elements,
      createState({ controlMode: CONFIG.runtime.controlModes.agentApi }),
      currentPlayerLabel,
    )

    const text = normalizeScreenText(elements.screen.textContent)

    expect(text).toContain("Player: Kora the Trailblazer - 1.2000x")
  })

  it("shows - Default instead of a computed rate for a player with no decay units charged yet", () => {
    const elements = createElements()
    const currentPlayerLabel = formatPlayerStatusLabel({
      playerName: "Kora",
      uniqueCellsVisited: 0,
      decayUnitsCharged: 0,
    })

    render(
      elements,
      createState({ controlMode: CONFIG.runtime.controlModes.agentApi }),
      currentPlayerLabel,
    )

    const text = normalizeScreenText(elements.screen.textContent)

    expect(text).toContain("- Default")
  })

  it("omits the player segment entirely when no agent is currently active", () => {
    const elements = createElements()

    render(
      elements,
      createState({ controlMode: CONFIG.runtime.controlModes.agentApi }),
      null,
    )

    const text = normalizeScreenText(elements.screen.textContent)

    expect(text).not.toContain("Player:")
    expect(text).toContain("Level: 1   Turn: 0   Scores: 900")
  })

  it("ellipsis-trims an overlong player label to fit the compact status line's character budget", () => {
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
    Object.defineProperty(window.screen, "width", {
      configurable: true,
      value: 412,
    })
    Object.defineProperty(window.screen, "availWidth", {
      configurable: true,
      value: 412,
    })
    const currentPlayerLabel = formatPlayerStatusLabel({
      playerName: "Kora",
      uniqueCellsVisited: 12,
      decayUnitsCharged: 10,
    })

    render(
      elements,
      createState({ controlMode: CONFIG.runtime.controlModes.agentApi }),
      currentPlayerLabel,
    )

    // Roughly half the available width is kept from the front, half from the back, with the
    // middle dropped — the same middle-truncation compactAgentModelLabel (agent/seats.ts) uses.
    expect(statusLineText(elements)).toBe("Player: Kora the T…r - 1.2000x   Level: 1   Scores: 900")
  })

  it("leaves the wide-viewport label untouched even when it would exceed the compact budget", () => {
    const elements = createElements()
    // 8 characters — CONFIG.agentConfig.playerNameMaxLength, the real cap enforced on agent names,
    // so this exercises the longest name the running app can ever actually produce.
    const currentPlayerLabel = formatPlayerStatusLabel({
      playerName: "AgentOne",
      uniqueCellsVisited: 12,
      decayUnitsCharged: 10,
    })

    render(
      elements,
      createState({ controlMode: CONFIG.runtime.controlModes.agentApi }),
      currentPlayerLabel,
    )

    const text = normalizeScreenText(elements.screen.textContent)

    expect(text).toContain("Player: AgentOne the Trailblazer - 1.2000x")
  })

  it("trims a long player label to fit the compact status line too, dropping its middle", () => {
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
    Object.defineProperty(window.screen, "width", {
      configurable: true,
      value: 412,
    })
    Object.defineProperty(window.screen, "availWidth", {
      configurable: true,
      value: 412,
    })
    // 8 characters — CONFIG.agentConfig.playerNameMaxLength, the real cap enforced on agent names.
    // Even at that maximum, the full "{name} the {Class}({rate})" label still overflows the
    // compact budget once "the Trailblazer" is added, so trimming still has real work to do.
    const currentPlayerLabel = formatPlayerStatusLabel({
      playerName: "AgentOne",
      uniqueCellsVisited: 12,
      decayUnitsCharged: 10,
    })

    render(
      elements,
      createState({ controlMode: CONFIG.runtime.controlModes.agentApi }),
      currentPlayerLabel,
    )

    expect(statusLineText(elements)).toBe("Player: AgentOne t…r - 1.2000x   Level: 1   Scores: 900")
  })

  it("keeps a compact label untouched right at the character-budget boundary", () => {
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
    Object.defineProperty(window.screen, "width", {
      configurable: true,
      value: 412,
    })
    Object.defineProperty(window.screen, "availWidth", {
      configurable: true,
      value: 412,
    })
    // At the default level (1) and score (900), the compact budget leaves exactly 22 characters
    // for the label — a label of exactly that length must render untouched, with no ellipsis.
    const currentPlayerLabel = "A".repeat(22)

    render(
      elements,
      createState({ controlMode: CONFIG.runtime.controlModes.agentApi }),
      currentPlayerLabel,
    )

    expect(statusLineText(elements)).toBe(`Player: ${currentPlayerLabel}   Level: 1   Scores: 900`)
  })

  it("trims a compact label by exactly one character once it's one over the boundary", () => {
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
    Object.defineProperty(window.screen, "width", {
      configurable: true,
      value: 412,
    })
    Object.defineProperty(window.screen, "availWidth", {
      configurable: true,
      value: 412,
    })
    // One character past the 22-character budget: the middle character is dropped in favor of a
    // single "…" (10 kept from the front, 11 from the back), so the rendered label is still
    // exactly 22 characters wide.
    const currentPlayerLabel = "A".repeat(23)

    render(
      elements,
      createState({ controlMode: CONFIG.runtime.controlModes.agentApi }),
      currentPlayerLabel,
    )

    expect(statusLineText(elements)).toBe(
      `Player: ${"A".repeat(10)}…${"A".repeat(11)}   Level: 1   Scores: 900`,
    )
  })

  it("drops the entire player segment when the compact budget leaves no room for it at all", () => {
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
    Object.defineProperty(window.screen, "width", {
      configurable: true,
      value: 412,
    })
    Object.defineProperty(window.screen, "availWidth", {
      configurable: true,
      value: 412,
    })
    const currentPlayerLabel = formatPlayerStatusLabel({
      playerName: "Kora",
      uniqueCellsVisited: 12,
      decayUnitsCharged: 10,
    })

    render(
      elements,
      // An oversized level/score leaves negative room for any label at all — the whole
      // "Player: {player}   " lead-in should disappear rather than leave a bare "Player:".
      createState({
        controlMode: CONFIG.runtime.controlModes.agentApi,
        level: Number.MAX_SAFE_INTEGER,
        score: Number.MAX_SAFE_INTEGER,
      }),
      currentPlayerLabel,
    )

    expect(statusLineText(elements)).toBe(
      "Level: 9007199254740991   Scores: 9007199254740991",
    )
    expect(statusLineText(elements)).not.toContain("Player:")
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
    elements.agentManageDialog.hidden = false
    elements.body.classList.add("terminal-body--agent-form-active")

    render(
      elements,
      createState({
        controlMode: CONFIG.runtime.controlModes.agentApi,
        status: "running",
      }),
    )

    expect(elements.agentConfigForm.hidden).toBe(true)
    expect(elements.agentManageDialog?.hidden).toBe(true)
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

  it("hides every touch control on a too-small level 1, with no lower level to fall back to", () => {
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
    // Level 1 has no lower level to fall back to, so canShowRestart already hides the Reset
    // Progress button here (asserted below) — the text must not promise an action with no button.
    expect(text).toContain(messages.tooSmallActionMessage)
    expect(text).not.toContain(messages.tooSmallActionMessageWithReset)

    const visibleLabels = elements.touchButtons
      .filter((button) => !button.hidden)
      .map((button) => button.dataset.action ?? button.dataset.move)

    expect(visibleLabels).toEqual([])
    expect(elements.touchControls.hidden).toBe(true)
  })

  it("shows reset progress as the only touch control on a too-small level above 1", () => {
    const elements = createElements()

    render(
      elements,
      createState({
        level: 2,
        mazeDimensions: null,
        maze: null,
        playerPosition: null,
        finalPosition: null,
        status: "too-small",
      }),
    )

    const text = normalizeScreenText(elements.screen.textContent)

    expect(text).toContain("Level 2 needs more screen room!")
    expect(text).toContain(messages.tooSmallActionMessageWithReset)

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

  it("keeps the zoom placeholder hidden when the too-small status text still fits", () => {
    const elements = createElements()
    vi.spyOn(elements.body, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 400, bottom: 200,
      width: 400, height: 200, toJSON: () => ({}),
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

    expect(elements.zoomPlaceholder.hidden).toBe(true)
    expect(elements.zoomPlaceholder.getAttribute("aria-hidden")).toBe("true")
  })

  it("shows the zoom placeholder once even the too-small status text can no longer fit", () => {
    const elements = createElements()
    // "Level 1 needs more screen room!" is 32 characters; charWidth falls back to 9 (elements.measure
    // is left unmocked here), so a width this narrow leaves room for only a handful of characters.
    vi.spyOn(elements.body, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 40, bottom: 200,
      width: 40, height: 200, toJSON: () => ({}),
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

    expect(elements.zoomPlaceholder.hidden).toBe(false)
    expect(elements.zoomPlaceholder.getAttribute("aria-hidden")).toBe("false")
  })

  it("hides the agent seats dock while the zoom placeholder is up, in agent-api mode", () => {
    const elements = createElements()
    elements.agentSeatsBody!.hidden = false
    // Same narrow width as the previous test: too small for even the too-small status text.
    vi.spyOn(elements.body, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 40, bottom: 200,
      width: 40, height: 200, toJSON: () => ({}),
    })

    render(
      elements,
      createState({
        controlMode: CONFIG.runtime.controlModes.agentApi,
        mazeDimensions: null,
        maze: null,
        playerPosition: null,
        finalPosition: null,
        status: "too-small",
      }),
    )

    expect(elements.zoomPlaceholder.hidden).toBe(false)
    expect(elements.agentSeatsBody!.hidden).toBe(true)
  })

  it("restores the agent seats dock once the zoom placeholder clears, in agent-api mode", () => {
    const elements = createElements()
    elements.agentSeatsBody!.hidden = true

    render(
      elements,
      createState({
        controlMode: CONFIG.runtime.controlModes.agentApi,
        status: "await-agent",
      }),
    )

    expect(elements.zoomPlaceholder.hidden).toBe(true)
    expect(elements.agentSeatsBody!.hidden).toBe(false)
  })

  it("never touches the agent seats dock outside agent-api mode", () => {
    const elements = createElements()
    elements.agentSeatsBody!.hidden = false
    vi.spyOn(elements.body, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 40, bottom: 200,
      width: 40, height: 200, toJSON: () => ({}),
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

    expect(elements.zoomPlaceholder.hidden).toBe(false)
    expect(elements.agentSeatsBody!.hidden).toBe(false)
  })

  it("shows too-small messaging without navigation text on narrow screens", () => {
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
        level: 2,
        mazeDimensions: null,
        maze: null,
        playerPosition: null,
        finalPosition: null,
        status: "too-small",
      }),
    )

    const text = normalizeScreenText(elements.screen.textContent)

    // Too-small has no maze/controls on screen to give navigation instructions about.
    expect(text).not.toContain(messages.navigation.interactive.compact)
    expect(text).toContain("Level 2 needs more screen room!")
    expect(text).toContain(messages.tooSmallActionMessageWithReset)
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

// These tests exercise fitPlayerSegmentToWidth directly, so each trimmed result is asserted as an
// isolated, standalone string rather than embedded inside a full running-status line.
describe("fitPlayerSegmentToWidth", () => {
  it("returns the label unchanged when it already fits the available width", () => {
    expect(fitPlayerSegmentToWidth("Kora the Trailblazer - 1.2000x", 20)).toBe(
      "Kora the Trailblazer - 1.2000x",
    )
  })

  it("keeps roughly half the available width from the front, half from the back, dropping the middle", () => {
    // "Kora the Trailblazer - 1.2000x" is 30 characters; a remainder of 33 leaves 22 characters of
    // room (COMPACT_STATUS_MAX_LENGTH 55 minus 33), so 21 characters go to the label once the "…"
    // marker is accounted for — 10 kept from the front, 11 from the back.
    expect(fitPlayerSegmentToWidth("Kora the Trailblazer - 1.2000x", 33)).toBe(
      "Kora the T…r - 1.2000x",
    )
  })

  it("trims a longer label the same way, using the same front/back split", () => {
    // "AgentOne" is 8 characters — CONFIG.agentConfig.playerNameMaxLength, the real cap on agent
    // names — so this is the longest label the running app can ever actually need to trim.
    expect(
      fitPlayerSegmentToWidth("AgentOne the Trailblazer - 1.2000x", 33),
    ).toBe("AgentOne t…r - 1.2000x")
  })

  it("applies the same middle-truncation to an arbitrary string with no player/rate structure at all", () => {
    expect(fitPlayerSegmentToWidth("A".repeat(25), 33)).toBe(
      `${"A".repeat(10)}…${"A".repeat(11)}`,
    )
  })

  it("keeps only the marker plus a single trailing character when almost nothing fits", () => {
    expect(fitPlayerSegmentToWidth("Kora the Trailblazer - 1.2000x", 53)).toBe("…x")
  })

  it("returns an empty string when there is no room for the label at all", () => {
    expect(fitPlayerSegmentToWidth("Kora the Trailblazer - 1.2000x", 55)).toBe("")
  })
})
