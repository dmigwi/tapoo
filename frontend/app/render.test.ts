import { beforeEach, describe, expect, it, vi } from "vitest"

import { CONFIG } from "./config"
import { render } from "./render"
import type { Elements, State } from "./types"

function normalizeScreenText(value: string | null): string {
  return (value ?? "").replaceAll("\u00a0", " ")
}

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

function createElements(): Elements {
  const screen = document.createElement("div")
  const touchControls = document.createElement("div")
  const touchButtons = [
    createButton({ action: "walls" }),
    createButton({ move: "up" }),
    createButton({ action: "proceed" }),
    createButton({ move: "left" }),
    createButton({ move: "right" }),
    createButton({ move: "down" }),
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

function createState(overrides: Partial<State> = {}): State {
  return {
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
    canResume: false,
    wallWeight: 1,
    clock: null,
    inputMode: "keyboard",
    ...overrides,
  }
}

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

    expect(visibleLabels).toEqual(["up", "left", "right", "down", "pause"])
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

  it("shows walls plus proceed touch controls after a win", () => {
    const elements = createElements()

    render(
      elements,
      createState({
        status: "won",
        lastRoundScore: 900,
      }),
    )

    const text = normalizeScreenText(elements.screen.textContent)

    expect(text).toContain(CONFIG.successMessage)
    expect(text).toContain(CONFIG.proceedMessage)

    const visibleLabels = elements.touchButtons
      .filter((button) => !button.hidden)
      .map((button) => button.dataset.action ?? button.dataset.move)

    expect(visibleLabels).toEqual(["walls", "proceed"])
    expect(
      elements.touchControls.classList.contains("touch-controls--action-pair"),
    ).toBe(true)
  })
})
