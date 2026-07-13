import { describe, expect, it, vi } from "vitest"

import {
  controlCommandFromButton,
  controlCommandFromKeyboardEvent,
  createKeyboardMode,
} from "./keyboard"

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

// These tests guard the keyboard-mode translation layer and contract shape.
describe("keyboard control mode", () => {
  it("translates keyboard events into semantic maze commands", () => {
    expect(
      controlCommandFromKeyboardEvent({
        key: "ArrowLeft",
        ctrlKey: false,
        metaKey: false,
      }),
    ).toEqual({ type: "move", move: "MoveLeft" })
    expect(
      controlCommandFromKeyboardEvent({
        key: " ",
        ctrlKey: false,
        metaKey: false,
      }),
    ).toEqual({ type: "pause" })
    expect(
      controlCommandFromKeyboardEvent({
        key: "p",
        ctrlKey: true,
        metaKey: false,
      }),
    ).toEqual({ type: "proceed" })
    expect(
      controlCommandFromKeyboardEvent({
        key: "b",
        ctrlKey: true,
        metaKey: false,
      }),
    ).toEqual({ type: "cycle-walls" })
    expect(
      controlCommandFromKeyboardEvent({
        key: "Escape",
        ctrlKey: false,
        metaKey: false,
      }),
    ).toBeNull()
  })

  it("translates button datasets into semantic maze commands", () => {
    expect(controlCommandFromButton(createButton({ action: "restart" }).dataset))
      .toEqual({ type: "restart" })
    expect(controlCommandFromButton(createButton({ action: "walls" }).dataset))
      .toEqual({ type: "cycle-walls" })
    expect(controlCommandFromButton(createButton({ move: "MoveDown" }).dataset))
      .toEqual({ type: "move", move: "MoveDown" })
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

    const mode = createKeyboardMode(elements)

    expect(mode.name).toBe("keyboard")
    expect(mode.expectsCommandFeedback()).toBe(false)
    expect(mode.getLastCommandFeedback()).toBeNull()

    mode.attach(dispatch)
    elements.controls[0].click()
    elements.touchButtons[0].click()
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowUp",
        bubbles: true,
      }),
    )

    expect(dispatch).toHaveBeenNthCalledWith(1, { type: "restart" })
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: "move",
      move: "MoveRight",
    })
    expect(dispatch).toHaveBeenNthCalledWith(3, {
      type: "move",
      move: "MoveUp",
    })

    mode.receiveCommandFeedback({
      command: "move",
      level: 1,
      message: "ignored",
      ok: true,
      score: 100,
      status: "running",
      wallWeight: 1,
    })
    expect(mode.getLastCommandFeedback()).toBeNull()

    mode.detach()
  })
})
