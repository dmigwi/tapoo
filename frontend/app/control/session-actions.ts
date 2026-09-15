import { isBelowMinimumViewport } from "../dom"
import type { Elements, MazeAction, SessionAction } from "../types"

/**
 * SessionMazeAction keeps the shared browser-only session actions grouped together.
 */
export type SessionMazeAction = Extract<MazeAction, { type: SessionAction }>

type ButtonBinding = {
  __button: HTMLButtonElement
  __onClick: () => void
}

type ReleaseActionBindingsOptions = {
  __attached: boolean
  __buttonBindings: ButtonBinding[]
  __keydownHandler: ((event: KeyboardEvent) => void) | null
  __onAfterRelease?: () => void
  __onBeforeRelease?: () => void
  __removeAppFocus: () => void
  __setAttached: (attached: boolean) => void
  __setKeydownHandler: (handler: ((event: KeyboardEvent) => void) | null) => void
}

/**
 * releaseAllActionBindings clears every listener owned by the active control mode.
 */
export function releaseAllActionBindings({
  __attached,
  __buttonBindings,
  __keydownHandler,
  __onAfterRelease,
  __onBeforeRelease,
  __removeAppFocus,
  __setAttached,
  __setKeydownHandler,
}: ReleaseActionBindingsOptions): void {
  if (!__attached) {
    return
  }

  __onBeforeRelease?.()
  __buttonBindings.forEach(({ __button, __onClick }) => {
    __button.removeEventListener("click", __onClick)
  })
  __buttonBindings.length = 0
  if (__keydownHandler) {
    window.removeEventListener("keydown", __keydownHandler)
    __setKeydownHandler(null)
  }
  __removeAppFocus()
  __setAttached(false)
  __onAfterRelease?.()
}

/**
 * acceptsGameControls answers whether human input should reach the game at all. Two conditions,
 * both about whether the player can see what they would be acting on:
 *
 * - the terminal app must hold focus, so typing in an agent form is not read as a game shortcut;
 * - the viewport must be at least the supported minimum, because below it the zoom placeholder
 *   covers the screen. That cover is opaque: without this, every touch button underneath stays
 *   clickable and every shortcut still moves a player nobody can see, on a maze nobody can read.
 *
 * Shared by both control modes rather than repeated in each keydown handler, so a mode cannot be
 * given input rules the other does not have.
 */
export function acceptsGameControls(elements: Elements): boolean {
  return isMazeControlFocused(elements) && !isBelowMinimumViewport(elements)
}

/**
 * isMazeControlFocused keeps human keyboard/button controls scoped to the terminal app.
 */
export function isMazeControlFocused(elements: Elements): boolean {
  if (!elements.app.isConnected) {
    return true
  }

  const activeElement = document.activeElement
  return activeElement === elements.app || elements.app.contains(activeElement)
}

/**
 * Translates shared keyboard shortcuts into session actions.
 *
 * Session actions are one-shot, so an auto-repeating held key is not read as a stream of them:
 * holding Space would otherwise rewrite the persisted state on every repeat. (Movement keys are
 * mapped elsewhere and keep repeating - holding an arrow to keep moving is the point.) Enter, Space
 * and Escape count only when pressed alone, so Shift+Enter or Ctrl+Space is never a game command.
 */
export function sessionActionFromKeyboardEvent(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey"> &
    Partial<Pick<KeyboardEvent, "altKey" | "shiftKey" | "code" | "repeat">>,
): SessionMazeAction | null {
  if (event.repeat === true) {
    return null
  }

  const letter = shortcutLetter(event)
  const controlCombo = event.ctrlKey || event.metaKey

  if (controlCombo && event.altKey === true && letter === "r") {
    return { type: "restart" }
  }

  if (controlCombo && letter === "b") {
    return { type: "cycle-walls" }
  }

  const unmodified =
    !event.ctrlKey && !event.metaKey && event.altKey !== true && event.shiftKey !== true
  if (!unmodified) {
    return null
  }

  if (event.key === "Enter") {
    return { type: "proceed" }
  }

  if (event.key === " " || event.key === "Escape") {
    return { type: "pause" }
  }

  return null
}

/**
 * shortcutLetter names the letter a shortcut was pressed on. The key's own label wins whenever it
 * is a Latin letter, so Dvorak and AZERTY users press Ctrl+B where their B is. Only when the label
 * is not a Latin letter does the physical key decide: on a Cyrillic layout the B key's label is
 * "и", and macOS Option can turn R into "®" - matched on the label alone, those shortcuts would
 * never fire.
 */
function shortcutLetter(
  event: Pick<KeyboardEvent, "key"> & Partial<Pick<KeyboardEvent, "code">>,
): string {
  const label = event.key.toLowerCase()
  if (/^[a-z]$/.test(label)) {
    return label
  }

  const physical = /^Key([A-Z])$/.exec(event.code ?? "")
  return physical ? physical[1].toLowerCase() : label
}

/**
 * sessionActionFromButton translates shared touch-action buttons into session actions.
 */
export function sessionActionFromButton(
  dataset: DOMStringMap,
): SessionMazeAction | null {
  switch (dataset.action) {
    case "pause":
      return { type: "pause" }
    case "proceed":
      return { type: "proceed" }
    case "walls":
      return { type: "cycle-walls" }
    case "restart":
      return { type: "restart" }
    default:
      return null
  }
}

/**
 * Reports a key press that belongs to an input method's in-progress composition (Japanese, Chinese,
 * Korean and similar input). Browsers still deliver those keydowns to page listeners: Escape there
 * cancels a half-typed word and Enter commits one, and neither is meant for the page.
 *
 * Three signals, because no single one covers every browser. `isComposing` is the standard one, and
 * Chrome also reports `key` "Process". `keyCode` 229 is kept on purpose despite `keyCode` being
 * deprecated: Safari ends the composition before dispatching the keydown for the key that ended it,
 * so that event arrives with `isComposing` false and `key` "Escape" or "Enter", and 229 is the only
 * mark it still carries. Dropping it would let Escape close - and reset - the agent form in Safari
 * again.
 */
export function isComposingKeyEvent(
  event: Pick<KeyboardEvent, "key"> & Partial<Pick<KeyboardEvent, "isComposing" | "keyCode">>,
): boolean {
  return event.isComposing === true || event.key === "Process" || event.keyCode === 229
}

/**
 * Answers whether a key press is for the focused element rather than for the game: composition keys
 * always are; text fields keep every key; and buttons, links and `<summary>` keep the keys that
 * activate them. Only Enter and Space for those - a focused button claiming every key would stop
 * the arrows moving the player after a touch button was clicked with a mouse. Without the
 * activation rule, Enter on a focused Save button ran the game's "proceed" and cancelled the click,
 * resuming the paused round behind the form instead of saving it.
 */
export function keyboardEventBelongsToTarget(event: KeyboardEvent): boolean {
  if (isComposingKeyEvent(event) || isFormControlTarget(event.target)) {
    return true
  }

  return isActivationTarget(event.target) && (event.key === "Enter" || event.key === " ")
}

/**
 * isActivationTarget identifies elements a keyboard user presses with Enter or Space.
 */
function isActivationTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLButtonElement ||
    (target instanceof HTMLAnchorElement && target.hasAttribute("href")) ||
    (target instanceof HTMLElement && target.localName === "summary")
  )
}

/**
 * isFormControlTarget identifies editable controls whose keystrokes should not become game shortcuts.
 */
export function isFormControlTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement &&
      (target.isContentEditable === true ||
        target.contentEditable === "true" ||
        target.getAttribute("contenteditable") === "true"))
  )
}
