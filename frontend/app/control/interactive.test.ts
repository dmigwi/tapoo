import { afterEach, describe, expect, it, vi } from "vitest"

import { GameClock } from "../clock"
import { CONFIG } from "../config"
import { createInteractiveMode } from "./interactive"
import type { MazeActionResult, State, TraversalHistoryEntry } from "../types"

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

function createState(overrides: Partial<State> = {}): State {
  return {
    turnCount: 0,
    cumulativeRoundCount: 0,
    bestWinTraversalSpeedUnits: null,
    bestWinRetentionUnits: null,
    clock: null,
    controlMode: CONFIG.runtime.controlModes.interactive,
    finalPosition: null,
    lastAttemptRetentionUnits: null,
    lastRoundScore: 0,
    lastWinTraversalSpeedUnits: null,
    level: 1,
    maze: null,
    mazeDimensions: null,
    startPosition: null,
    playerPosition: null,
    score: 0,
    scoreDecayUnits: 0,
    status: "boot",
    traversalHistory: [],
    wallWeight: 1,
    winSummary: "",
    ...overrides,
  }
}

function selfVisit(row: number, col: number): TraversalHistoryEntry {
  return { playerName: CONFIG.runtime.interactivePlayerName, row, col, openMoves: [] }
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
      zoomPlaceholder: document.createElement("div"),
    }
    elements.app.focus = vi.fn()
    const dispatch = vi.fn((action: { type: string }) => (
      action.type === "MoveRight" || action.type === "MoveUp"
        ? createActionResult({ lastMoveStatus: "applied" })
        : null
    ))
    const commitTurn = vi.fn()

    const mode = createInteractiveMode(elements)

    expect(mode.name).toBe(CONFIG.runtime.controlModes.interactive)
    expect(mode.readLastActionResult()).toBeNull()

    mode.bindActionDispatch(dispatch, vi.fn(() => createState()), commitTurn)
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
    }, { wantFeedback: true, playerName: "Self" })
    expect(dispatch).toHaveBeenNthCalledWith(3, { type: "pause" }, { playerName: "Self" })
    expect(dispatch).toHaveBeenNthCalledWith(4, {
      type: "MoveUp",
    }, { wantFeedback: true, playerName: "Self" })
    expect(commitTurn).toHaveBeenCalledTimes(2)
    expect(commitTurn).toHaveBeenNthCalledWith(1)
    expect(commitTurn).toHaveBeenNthCalledWith(2)

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
      zoomPlaceholder: document.createElement("div"),
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

  it("commits only successful move actions", () => {
    const elements = {
      app: document.createElement("div"),
      body: document.createElement("div"),
      controls: [],
      measure: document.createElement("div"),
      screen: document.createElement("div"),
      touchButtons: [createButton({ move: "MoveRight" })],
      touchControls: document.createElement("div"),
      zoomPlaceholder: document.createElement("div"),
    }
    elements.app.focus = vi.fn()
    const dispatch = vi.fn(() => createActionResult({ lastMoveStatus: "invalid-move" }))
    const commitTurn = vi.fn()

    const mode = createInteractiveMode(elements)

    mode.bindActionDispatch(dispatch, vi.fn(() => createState()), commitTurn)
    elements.touchButtons[0].click()

    expect(dispatch).toHaveBeenCalledWith(
      { type: "MoveRight" },
      { wantFeedback: true, playerName: "Self" },
    )
    expect(commitTurn).not.toHaveBeenCalled()
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
      zoomPlaceholder: document.createElement("div"),
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

  it("ignores keyboard shortcuts while typing inside a form control nested in the terminal app", () => {
    // The agent-config form's text inputs live inside elements.app's own DOM subtree (even in
    // interactive mode), so isMazeControlFocused alone would treat them as "focused enough" to
    // dispatch game shortcuts — a space typed into a player name field must not pause the game.
    const restartButton = createButton({ action: "restart" })
    const nestedInput = document.createElement("input")
    const elements = {
      app: document.createElement("div"),
      body: document.createElement("div"),
      controls: [restartButton],
      measure: document.createElement("div"),
      screen: document.createElement("div"),
      touchButtons: [],
      touchControls: document.createElement("div"),
      zoomPlaceholder: document.createElement("div"),
    }
    elements.app.tabIndex = 0
    elements.app.append(restartButton, nestedInput)
    document.body.append(elements.app)
    const dispatch = vi.fn()

    const mode = createInteractiveMode(elements)
    mode.bindActionDispatch(dispatch, vi.fn(() => createState()), vi.fn())

    // Dispatch on the focused input itself (not window) so the event bubbles up with
    // event.target set to the input, matching real browser keydown delivery.
    nestedInput.focus()
    nestedInput.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }))
    nestedInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))

    expect(dispatch).not.toHaveBeenCalled()

    elements.app.focus()
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }))

    expect(dispatch).toHaveBeenCalledWith({ type: "pause" }, { playerName: "Self" })
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
      zoomPlaceholder: document.createElement("div"),
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

  it("returns null from readCurrentPlayer before any round has a live clock", () => {
    const elements = {
      app: document.createElement("div"),
      body: document.createElement("div"),
      controls: [],
      measure: document.createElement("div"),
      screen: document.createElement("div"),
      touchButtons: [],
      touchControls: document.createElement("div"),
      zoomPlaceholder: document.createElement("div"),
    }

    const mode = createInteractiveMode(elements)

    expect(mode.readCurrentPlayer?.()).toBeNull()

    mode.bindActionDispatch(vi.fn(), vi.fn(() => createState({ clock: null })), vi.fn())

    expect(mode.readCurrentPlayer?.()).toBeNull()
  })

  it("exposes a static player-name label via readCurrentPlayer once a round has a live clock", () => {
    const elements = {
      app: document.createElement("div"),
      body: document.createElement("div"),
      controls: [],
      measure: document.createElement("div"),
      screen: document.createElement("div"),
      touchButtons: [],
      touchControls: document.createElement("div"),
      zoomPlaceholder: document.createElement("div"),
    }

    const clock = new GameClock(10_000)
    const readState = vi.fn(() =>
      createState({
        clock,
        traversalHistory: [selfVisit(0, 0), selfVisit(0, 1)],
      }),
    )

    const mode = createInteractiveMode(elements)
    mode.bindActionDispatch(vi.fn(), readState, vi.fn())

    // Batch traversal-speed classification (Trailblazer/Navigator/Backtracker) does not apply to a
    // human moving one cell at a time, so this label carries no rate or class — just the name.
    expect(mode.readCurrentPlayer?.()).toBe("Self")
  })
})
