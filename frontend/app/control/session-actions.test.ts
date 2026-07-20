import { describe, expect, it } from "vitest"

import {
  isFormControlTarget,
  sessionActionFromButton,
  sessionActionFromKeyboardEvent,
} from "./session-actions"

// createButton reproduces the action-only touch-button dataset consumed by the shared helpers.
function createButton(action: string): HTMLButtonElement {
  const button = document.createElement("button")
  button.dataset.action = action
  return button
}

// These tests lock down the shared session actions used by both browser modes.
describe("shared session actions", () => {
  it("translates keyboard shortcuts into pause, proceed, wall, and restart actions", () => {
    expect(
      sessionActionFromKeyboardEvent({
        key: " ",
        ctrlKey: false,
        metaKey: false,
      }),
    ).toEqual({ type: "pause" })
    expect(
      sessionActionFromKeyboardEvent({
        key: "Escape",
        ctrlKey: false,
        metaKey: false,
      }),
    ).toEqual({ type: "pause" })
    expect(
      sessionActionFromKeyboardEvent({
        key: "Enter",
        ctrlKey: false,
        metaKey: false,
      }),
    ).toEqual({ type: "proceed" })
    expect(
      sessionActionFromKeyboardEvent({
        key: "p",
        ctrlKey: true,
        metaKey: false,
      }),
    ).toBeNull()
    expect(
      sessionActionFromKeyboardEvent({
        key: "b",
        ctrlKey: true,
        metaKey: false,
      }),
    ).toEqual({ type: "cycle-walls" })
    expect(
      sessionActionFromKeyboardEvent({
        key: "r",
        ctrlKey: true,
        metaKey: false,
        altKey: true,
      }),
    ).toEqual({ type: "restart" })
    expect(
      sessionActionFromKeyboardEvent({
        key: "r",
        ctrlKey: true,
        metaKey: false,
        altKey: false,
      }),
    ).toBeNull()
    expect(
      sessionActionFromKeyboardEvent({
        key: "ArrowRight",
        ctrlKey: false,
        metaKey: false,
      }),
    ).toBeNull()
  })

  it("translates shared touch-action buttons into session actions", () => {
    expect(sessionActionFromButton(createButton("pause").dataset)).toEqual({
      type: "pause",
    })
    expect(sessionActionFromButton(createButton("proceed").dataset)).toEqual({
      type: "proceed",
    })
    expect(sessionActionFromButton(createButton("walls").dataset)).toEqual({
      type: "cycle-walls",
    })
    expect(sessionActionFromButton(createButton("restart").dataset)).toEqual({
      type: "restart",
    })
  })

  it("identifies editable targets that should keep their keyboard input", () => {
    expect(isFormControlTarget(document.createElement("input"))).toBe(true)
    expect(isFormControlTarget(document.createElement("textarea"))).toBe(true)
    expect(isFormControlTarget(document.createElement("select"))).toBe(true)

    const editable = document.createElement("div")
    editable.contentEditable = "true"

    expect(isFormControlTarget(editable)).toBe(true)
    expect(isFormControlTarget(document.createElement("button"))).toBe(false)
    expect(isFormControlTarget(null)).toBe(false)
  })
})
