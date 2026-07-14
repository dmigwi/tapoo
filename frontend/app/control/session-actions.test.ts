import { describe, expect, it } from "vitest"

import {
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
  it("translates keyboard shortcuts into pause, proceed, and wall actions", () => {
    expect(
      sessionActionFromKeyboardEvent({
        key: " ",
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
    ).toEqual({ type: "proceed" })
    expect(
      sessionActionFromKeyboardEvent({
        key: "b",
        ctrlKey: true,
        metaKey: false,
      }),
    ).toEqual({ type: "cycle-walls" })
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
})
