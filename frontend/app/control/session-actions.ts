import type { MazeAction, SessionAction } from "../types"

// SessionMazeAction keeps the shared browser-only session actions grouped together.
export type SessionMazeAction = Extract<MazeAction, { type: SessionAction }>

type ButtonBinding = {
  button: HTMLButtonElement
  onClick: () => void
}

type ReleaseActionBindingsOptions = {
  attached: boolean
  buttonBindings: ButtonBinding[]
  keydownHandler: ((event: KeyboardEvent) => void) | null
  onAfterRelease?: () => void
  onBeforeRelease?: () => void
  removeAppFocus: () => void
  setAttached: (attached: boolean) => void
  setKeydownHandler: (handler: ((event: KeyboardEvent) => void) | null) => void
}

// releaseAllActionBindings clears every listener owned by the active control mode.
export function releaseAllActionBindings({
  attached,
  buttonBindings,
  keydownHandler,
  onAfterRelease,
  onBeforeRelease,
  removeAppFocus,
  setAttached,
  setKeydownHandler,
}: ReleaseActionBindingsOptions): void {
  if (!attached) {
    return
  }

  onBeforeRelease?.()
  buttonBindings.forEach(({ button, onClick }) => {
    button.removeEventListener("click", onClick)
  })
  buttonBindings.length = 0
  if (keydownHandler) {
    window.removeEventListener("keydown", keydownHandler)
    setKeydownHandler(null)
  }
  removeAppFocus()
  setAttached(false)
  onAfterRelease?.()
}

// sessionActionFromKeyboardEvent translates shared keyboard shortcuts into session actions.
export function sessionActionFromKeyboardEvent(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey">,
): SessionMazeAction | null {
  const lowerKey = event.key.toLowerCase()
  const controlCombo = event.ctrlKey || event.metaKey

  if (controlCombo && lowerKey === "b") {
    return { type: "cycle-walls" }
  }

  if (controlCombo && lowerKey === "p") {
    return { type: "proceed" }
  }

  if (event.key === "Enter") {
    return { type: "proceed" }
  }

  if (event.key === " ") {
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
