import { afterEach, describe, expect, it, vi } from "vitest"

import { CONFIG } from "../config"
import { createInteractiveMode } from "./interactive"
import type { MazeActionResult, State } from "../types"

// createButton reproduces the data attributes used by keyboard and touch controls.
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
  }

  return button
}

// createActionResult supplies the small replay payload shape expected by the control contract.
function createActionResult(
  overrides: Partial<MazeActionResult> = {},
): MazeActionResult {
  return {
    ...overrides,
  }
}

function createState(): State {
  return {
    agentRequestCount: 0,
    bestWinRequestCount: null,
    bestWinRetentionUnits: null,
    canResume: false,
    clock: null,
    controlMode: CONFIG.runtime.controlModes.interactive,
    finalPosition: null,
    lastAttemptRetentionUnits: null,
    lastRoundScore: 0,
    lastWinRequestCount: null,
    level: 1,
    maze: null,
    mazeDimensions: null,
    playerPosition: null,
    score: 0,
    scoreDecayUnits: 0,
    status: "boot",
    traversalHistory: [],
    wallWeight: 1,
    winSummary: "",
  }
}

// These tests guard the interactive-mode translation layer and contract shape.
describe("interactive control mode", () => {
  afterEach(() => {
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  it("implements the shared control mode contract", () => {
    const elements = {
      app: document.createElement("div"),
      body: document.createElement("div"),
      controls: [createButton({ action: "restart" })],
      measure: document.createElement("div"),
      screen: document.createElement("div"),
      touchButtons: [createButton({ move: "MoveRight" })],
      touchControls: document.createElement("div"),
    }
    elements.app.focus = vi.fn()
    const dispatch = vi.fn()

    const mode = createInteractiveMode(elements)

    expect(mode.name).toBe(CONFIG.runtime.controlModes.interactive)
    expect(mode.readLastActionResult()).toBeNull()

    mode.bindActionDispatch(dispatch, vi.fn(() => createState()), vi.fn())
    elements.controls[0].click()
    elements.touchButtons[0].click()
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: " ",
        bubbles: true,
      }),
    )
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowUp",
        bubbles: true,
      }),
    )

    expect(dispatch).toHaveBeenNthCalledWith(1, { type: "restart" }, { playerName: "Self" })
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: "MoveRight",
    }, { playerName: "Self" })
    expect(dispatch).toHaveBeenNthCalledWith(3, { type: "pause" }, { playerName: "Self" })
    expect(dispatch).toHaveBeenNthCalledWith(4, {
      type: "MoveUp",
    }, { playerName: "Self" })

    mode.recordActionResult(createActionResult({
      lastMoveStatus: "applied",
    }))
    expect(mode.readLastActionResult()).toBeNull()
  })

  it("ignores unsupported button and keyboard actions", () => {
    const elements = {
      app: document.createElement("div"),
      body: document.createElement("div"),
      controls: [createButton({ action: "unknown" })],
      measure: document.createElement("div"),
      screen: document.createElement("div"),
      touchButtons: [],
      touchControls: document.createElement("div"),
    }
    elements.app.focus = vi.fn()
    const dispatch = vi.fn()

    const mode = createInteractiveMode(elements)

    mode.bindActionDispatch(dispatch, vi.fn(() => createState()), vi.fn())
    elements.controls[0].click()
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "x",
        bubbles: true,
      }),
    )

    expect(dispatch).not.toHaveBeenCalled()
  })

  it("handles human controls only while the terminal app is focused", () => {
    const restartButton = createButton({ action: "restart" })
    const elements = {
      app: document.createElement("div"),
      body: document.createElement("div"),
      controls: [restartButton],
      measure: document.createElement("div"),
      screen: document.createElement("div"),
      touchButtons: [],
      touchControls: document.createElement("div"),
    }
    const outsideInput = document.createElement("input")
    elements.app.tabIndex = 0
    elements.app.append(restartButton)
    document.body.append(elements.app, outsideInput)
    const dispatch = vi.fn()

    const mode = createInteractiveMode(elements)
    mode.bindActionDispatch(dispatch, vi.fn(() => createState()), vi.fn())

    outsideInput.focus()
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }))

    expect(dispatch).not.toHaveBeenCalled()

    elements.app.focus()
    restartButton.click()
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }))

    expect(dispatch).toHaveBeenNthCalledWith(1, { type: "restart" }, { playerName: "Self" })
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: "pause" }, { playerName: "Self" })
  })

  it("rebinds controls without keeping stale listeners alive", () => {
    const elements = {
      app: document.createElement("div"),
      body: document.createElement("div"),
      controls: [createButton({ action: "restart" })],
      measure: document.createElement("div"),
      screen: document.createElement("div"),
      touchButtons: [],
      touchControls: document.createElement("div"),
    }
    elements.app.focus = vi.fn()
    const firstDispatch = vi.fn()
    const secondDispatch = vi.fn()

    const mode = createInteractiveMode(elements)

    const readState = vi.fn(() => createState())

    mode.bindActionDispatch(firstDispatch, readState, vi.fn())
    mode.bindActionDispatch(secondDispatch, readState, vi.fn())
    elements.controls[0].click()

    expect(firstDispatch).not.toHaveBeenCalled()
    expect(secondDispatch).toHaveBeenCalledWith({ type: "restart" }, { playerName: "Self" })
  })
})
