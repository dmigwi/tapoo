import type {
  Elements,
  MazeControlCommand,
  MazeControlDispatch,
  MazeControlFeedback,
  MazeControlMode,
  MoveAction,
} from "../types"

// KEY_TO_MOVE_ACTION maps browser arrow-key events into semantic movement commands.
const KEY_TO_MOVE_ACTION: Partial<Record<string, MoveAction>> = {
  ArrowLeft: "MoveLeft",
  ArrowRight: "MoveRight",
  ArrowUp: "MoveUp",
  ArrowDown: "MoveDown",
}

// controlCommandFromKey translates one keyboard gesture into a maze control command.
function controlCommandFromKey(
  key: string,
  lowerKey: string,
  controlCombo: boolean,
): MazeControlCommand | null {
  const moveAction = KEY_TO_MOVE_ACTION[key]
  if (moveAction) {
    return { type: "move", move: moveAction }
  }

  if (controlCombo && lowerKey === "b") {
    return { type: "cycle-walls" }
  }

  if (controlCombo && lowerKey === "p") {
    return { type: "proceed" }
  }

  if (key === "Enter") {
    return { type: "proceed" }
  }

  if (key === " ") {
    return { type: "pause" }
  }

  return null
}

// controlCommandFromKeyboardEvent normalizes a browser keyboard event into one command.
export function controlCommandFromKeyboardEvent(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey">,
): MazeControlCommand | null {
  return controlCommandFromKey(
    event.key,
    event.key.toLowerCase(),
    event.ctrlKey || event.metaKey,
  )
}

// controlCommandFromButton translates control-button datasets into runtime commands.
export function controlCommandFromButton(
  dataset: DOMStringMap,
): MazeControlCommand | null {
  if (dataset.move) {
    return { type: "move", move: dataset.move as MoveAction }
  }

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

// createKeyboardMode wires keyboard and touch buttons into the shared control contract.
export function createKeyboardMode(
  elements: Elements,
): MazeControlMode {
  let attached = false
  let keydownHandler: ((event: KeyboardEvent) => void) | null = null
  const controlHandlers: Array<{
    button: HTMLButtonElement
    onClick: () => void
  }> = []
  const touchHandlers: Array<{
    button: HTMLButtonElement
    onClick: () => void
  }> = []

  // focusApp keeps keyboard input anchored to the terminal root after button taps.
  const focusApp = (): void => {
    elements.app.focus()
  }

  // handleButtonClick resolves one button press into a semantic runtime command.
  const handleButtonClick = (
    button: HTMLButtonElement,
    dispatch: MazeControlDispatch,
  ): void => {
    const command = controlCommandFromButton(button.dataset)
    if (!command) {
      return
    }

    focusApp()
    dispatch(command)
  }

  // handleKeydown routes keyboard gestures through the same command vocabulary.
  const handleKeydown = (
    event: KeyboardEvent,
    dispatch: MazeControlDispatch,
  ): void => {
    const command = controlCommandFromKeyboardEvent(event)
    if (!command) {
      return
    }

    event.preventDefault()
    dispatch(command)
  }

  return {
    name: "keyboard",
    attach(dispatch) {
      if (attached) {
        return
      }

      elements.controls.forEach((button) => {
        const onClick = (): void => {
          handleButtonClick(button, dispatch)
        }

        controlHandlers.push({ button, onClick })
        button.addEventListener("click", onClick)
      })

      elements.touchButtons.forEach((button) => {
        const onClick = (): void => {
          handleButtonClick(button, dispatch)
        }

        touchHandlers.push({ button, onClick })
        button.addEventListener("click", onClick)
      })

      keydownHandler = (event: KeyboardEvent): void => {
        handleKeydown(event, dispatch)
      }

      window.addEventListener("keydown", keydownHandler, { passive: false })
      elements.app.addEventListener("click", focusApp)
      attached = true
    },
    detach() {
      if (!attached) {
        return
      }

      controlHandlers.forEach(({ button, onClick }) => {
        button.removeEventListener("click", onClick)
      })
      touchHandlers.forEach(({ button, onClick }) => {
        button.removeEventListener("click", onClick)
      })
      controlHandlers.length = 0
      touchHandlers.length = 0
      if (keydownHandler) {
        window.removeEventListener("keydown", keydownHandler)
        keydownHandler = null
      }
      elements.app.removeEventListener("click", focusApp)
      attached = false
    },
    expectsCommandFeedback() {
      return false
    },
    getLastCommandFeedback() {
      return null
    },
    receiveCommandFeedback(feedback: MazeControlFeedback) {
      // Keyboard and touch controls already provide immediate visual feedback in the game view.
      void feedback
    },
  }
}
