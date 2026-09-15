import { describe, expect, it } from "vitest"

import {
  isComposingKeyEvent,
  isFormControlTarget,
  keyboardEventBelongsToTarget,
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

  it("ignores held-key repeats and modified Enter, Space and Escape", () => {
    const plain = { ctrlKey: false, metaKey: false }
    // Holding Space would otherwise rewrite the persisted state on every repeat.
    expect(sessionActionFromKeyboardEvent({ ...plain, key: " ", repeat: true })).toBeNull()
    expect(sessionActionFromKeyboardEvent({ ...plain, key: "Enter", repeat: true })).toBeNull()
    expect(sessionActionFromKeyboardEvent({ ...plain, key: "Enter", shiftKey: true })).toBeNull()
    expect(sessionActionFromKeyboardEvent({ key: " ", ctrlKey: true, metaKey: false })).toBeNull()
    expect(sessionActionFromKeyboardEvent({ ...plain, key: "Escape", altKey: true })).toBeNull()
    // The unmodified keys still are the shortcuts.
    expect(sessionActionFromKeyboardEvent({ ...plain, key: "Enter", repeat: false })).toEqual({ type: "proceed" })
  })

  it("matches a shortcut letter by its label, and by the physical key only when the label is not Latin", () => {
    // Cyrillic layout: the B key is labelled "и", but it is still physically KeyB.
    expect(sessionActionFromKeyboardEvent({ key: "и", code: "KeyB", ctrlKey: true, metaKey: false }))
      .toEqual({ type: "cycle-walls" })
    // macOS Option can turn R into "®"; the physical key still names the shortcut.
    expect(sessionActionFromKeyboardEvent({ key: "®", code: "KeyR", ctrlKey: false, metaKey: true, altKey: true }))
      .toEqual({ type: "restart" })
    // Dvorak puts the B label on the physical N key: the label the user sees is what counts.
    expect(sessionActionFromKeyboardEvent({ key: "b", code: "KeyN", ctrlKey: true, metaKey: false }))
      .toEqual({ type: "cycle-walls" })
  })

  it("recognises keys that belong to an input method's composition", () => {
    expect(isComposingKeyEvent({ key: "Escape", isComposing: true })).toBe(true)
    expect(isComposingKeyEvent({ key: "Process" })).toBe(true)
    expect(isComposingKeyEvent({ key: "Enter", keyCode: 229 })).toBe(true)
    expect(isComposingKeyEvent({ key: "Escape", isComposing: false })).toBe(false)
  })

  it("keeps a focused element's own keys away from the game", () => {
    // Evaluated inside a real dispatch, so event.target is the element the way a browser sets it.
    const belongsToTarget = (target: HTMLElement, init: KeyboardEventInit): boolean => {
      let result: boolean | null = null
      target.addEventListener("keydown", (event) => {
        result = keyboardEventBelongsToTarget(event)
      }, { once: true })
      target.dispatchEvent(new KeyboardEvent("keydown", init))
      if (result === null) {
        throw new Error("keydown listener did not run")
      }
      return result
    }
    const link = document.createElement("a")
    link.href = "#seat"

    // Text fields keep every key.
    expect(belongsToTarget(document.createElement("input"), { key: "ArrowRight" })).toBe(true)
    // Buttons, links and <summary> keep only the keys that activate them.
    expect(belongsToTarget(document.createElement("button"), { key: "Enter" })).toBe(true)
    expect(belongsToTarget(document.createElement("button"), { key: " " })).toBe(true)
    expect(belongsToTarget(link, { key: "Enter" })).toBe(true)
    expect(belongsToTarget(document.createElement("summary"), { key: " " })).toBe(true)
    // Arrows still move the player from a focused button; Escape still reaches its handlers.
    expect(belongsToTarget(document.createElement("button"), { key: "ArrowRight" })).toBe(false)
    expect(belongsToTarget(document.createElement("button"), { key: "Escape" })).toBe(false)
    // A link without href is not activated by Enter, and a plain element keeps nothing...
    expect(belongsToTarget(document.createElement("a"), { key: "Enter" })).toBe(false)
    expect(belongsToTarget(document.createElement("div"), { key: "Enter" })).toBe(false)
    // ...except a composition key, which belongs to the input method wherever it lands.
    expect(belongsToTarget(document.createElement("div"), { key: "Process" })).toBe(true)
  })
})
