import { describe, expect, it, vi } from "vitest"

import { createInteractiveMode } from "./interactive"

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

// These tests guard the interactive-mode translation layer and contract shape.
describe("interactive control mode", () => {
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

    expect(mode.name).toBe("interactive")
    expect(mode.readLastActionState()).toBeNull()

    mode.bindActionDispatch(dispatch, vi.fn(() => ({
      currentCell: null,
      destinationCell: null,
      level: 1,
      score: 0,
      status: "boot" as const,
      traversalHistory: [],
    })))
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

    expect(dispatch).toHaveBeenNthCalledWith(1, { type: "restart" })
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: "MoveRight",
    })
    expect(dispatch).toHaveBeenNthCalledWith(3, { type: "pause" })
    expect(dispatch).toHaveBeenNthCalledWith(4, {
      type: "MoveUp",
    })

    mode.recordActionState({
      expectedResponseType: "MoveAction",
      instruction: "Choose the next MoveAction.",
      lastCommand: { type: "MoveRight" },
      lastCommandStatus: "applied",
      lastCommandMessage: "ignored",
    })
    expect(mode.readLastActionState()).toBeNull()
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

    mode.bindActionDispatch(dispatch, vi.fn(() => ({
      currentCell: null,
      destinationCell: null,
      level: 1,
      score: 0,
      status: "boot" as const,
      traversalHistory: [],
    })))
    elements.controls[0].click()
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
      }),
    )

    expect(dispatch).not.toHaveBeenCalled()
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

    const readAgentContext = vi.fn(() => ({
      currentCell: null,
      destinationCell: null,
      level: 1,
      score: 0,
      status: "boot" as const,
      traversalHistory: [],
    }))

    mode.bindActionDispatch(firstDispatch, readAgentContext)
    mode.bindActionDispatch(secondDispatch, readAgentContext)
    elements.controls[0].click()

    expect(firstDispatch).not.toHaveBeenCalled()
    expect(secondDispatch).toHaveBeenCalledWith({ type: "restart" })
  })
})
