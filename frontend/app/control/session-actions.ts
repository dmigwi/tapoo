import type { MazeAction, SessionAction } from "../types"

// SessionMazeAction keeps the shared browser-only session actions grouped together.
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

// releaseAllActionBindings clears every listener owned by the active control mode.
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

// sessionActionFromKeyboardEvent translates shared keyboard shortcuts into session actions.
export function sessionActionFromKeyboardEvent(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey"> &
    Partial<Pick<KeyboardEvent, "altKey">>,
): SessionMazeAction | null {
  const lowerKey = event.key.toLowerCase()
  const controlCombo = event.ctrlKey || event.metaKey

  if (controlCombo && event.altKey === true && lowerKey === "r") {
    return { type: "restart" }
  }

  if (controlCombo && lowerKey === "b") {
    return { type: "cycle-walls" }
  }

  if (event.key === "Enter") {
    return { type: "proceed" }
  }

  if (event.key === " " || event.key === "Escape") {
    return { type: "pause" }
  }

  return null
}

// sessionActionFromButton translates shared touch-action buttons into session actions.
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

// isFormControlTarget identifies editable controls whose keystrokes should not become game shortcuts.
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
