import type {
  Elements,
  MazeActionControl,
  MazeActionDispatch,
  MazeActionState,
  MoveAction,
} from "../types"
import {
  releaseAllActionBindings,
  sessionActionFromButton,
  sessionActionFromKeyboardEvent,
} from "./session-actions"
import { CONFIG } from "../config"

const { runtime } = CONFIG

// KEY_TO_MOVE_ACTION maps browser arrow-key events into semantic movement commands.
const KEY_TO_MOVE_ACTION: Partial<Record<string, MoveAction>> = {
  ArrowLeft: "MoveLeft",
  ArrowRight: "MoveRight",
  ArrowUp: "MoveUp",
  ArrowDown: "MoveDown",
}

// createInteractiveMode builds the interactive MazeActionControl used by the main game page.
export function createInteractiveMode(
  elements: Elements,
): MazeActionControl {
  let attached = false
  let keydownHandler: ((event: KeyboardEvent) => void) | null = null
  const buttonBindings: Array<{
    button: HTMLButtonElement
    onClick: () => void
  }> = []

  // focusApp keeps keyboard input anchored to the terminal root after button taps.
  const focusApp = (): void => {
    elements.app.focus()
  }

  // releaseBindings removes any listeners registered by the last active dispatch binding.
  const releaseBindings = (): void => {
    releaseAllActionBindings({
      attached,
      buttonBindings,
      keydownHandler,
      removeAppFocus: () => {
        elements.app.removeEventListener("click", focusApp)
      },
      setAttached: (nextAttached) => {
        attached = nextAttached
      },
      setKeydownHandler: (nextKeydownHandler) => {
        keydownHandler = nextKeydownHandler
      },
    })
  }

  // handleButtonClick resolves one button press into a semantic runtime command.
  const handleButtonClick = (
    button: HTMLButtonElement,
    dispatch: MazeActionDispatch,
  ): void => {
    const action = button.dataset.move
      ? { type: button.dataset.move as MoveAction }
      : sessionActionFromButton(button.dataset)
    if (!action) {
      return
    }

    focusApp()
    // Interactive controls do not request feedback; the game view already reflects the outcome.
    dispatch(action, { playerName: runtime.interactivePlayerName })
  }

  // handleKeydown routes keyboard gestures through the same command vocabulary.
  const handleKeydown = (
    event: KeyboardEvent,
    dispatch: MazeActionDispatch,
  ): void => {
    const moveAction = KEY_TO_MOVE_ACTION[event.key]
    const action = moveAction
      ? { type: moveAction }
      : sessionActionFromKeyboardEvent(event)
    if (!action) {
      return
    }

    event.preventDefault()
    // Interactive controls do not request feedback; the game view already reflects the outcome.
    dispatch(action, { playerName: runtime.interactivePlayerName })
  }

  return {
    // This MazeActionControl exposes the interactive mode name, binds browser inputs, and ignores stored feedback.
    // name lets the runtime identify which MazeActionControl implementation is active.
    name: "interactive",
    // bindActionDispatch connects browser keyboard and button events to the shared action dispatcher.
    bindActionDispatch(dispatch, readActionState, commitAgentTurn) {
      void readActionState
      void commitAgentTurn
      // Start from a clean slate so rebinding never depends on whatever was attached before.
      releaseBindings()

      elements.controls.forEach((button) => {
        const onClick = (): void => {
          handleButtonClick(button, dispatch)
        }

        buttonBindings.push({ button, onClick })
        button.addEventListener("click", onClick)
      })

      elements.touchButtons.forEach((button) => {
        const onClick = (): void => {
          handleButtonClick(button, dispatch)
        }

        buttonBindings.push({ button, onClick })
        button.addEventListener("click", onClick)
      })

      keydownHandler = (event: KeyboardEvent): void => {
        handleKeydown(event, dispatch)
      }

      window.addEventListener("keydown", keydownHandler, { passive: false })
      elements.app.addEventListener("click", focusApp)
      attached = true
    },
    // readLastActionState stays empty here because interactive users already get visual feedback.
    readLastActionState() {
      return null
    },
    // recordActionState is a no-op because the interactive mode does not retain command states.
    recordActionState(actionState: MazeActionState) {
      // Interactive controls already provide immediate visual feedback in the game view.
      void actionState
    },
  }
}
