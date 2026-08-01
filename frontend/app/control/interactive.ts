import type {
  Elements,
  MazeActionControl,
  MazeActionDispatch,
  MazeActionResult,
  MoveAction,
} from "../types"
import {
  isFormControlTarget,
  isMazeControlFocused,
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
    __button: HTMLButtonElement
    __onClick: () => void
  }> = []

  // focusApp keeps keyboard input anchored to the terminal root after button taps.
  const focusApp = (): void => {
    elements.app.focus()
  }

  // releaseBindings removes any listeners registered by the last active dispatch binding.
  const releaseBindings = (): void => {
    releaseAllActionBindings({
      __attached: attached,
      __buttonBindings: buttonBindings,
      __keydownHandler: keydownHandler,
      __removeAppFocus: () => {
        elements.app.removeEventListener("click", focusApp)
      },
      __setAttached: (nextAttached) => {
        attached = nextAttached
      },
      __setKeydownHandler: (nextKeydownHandler) => {
        keydownHandler = nextKeydownHandler
      },
    })
  }

  // handleButtonClick resolves one button press into a semantic runtime command.
  const handleButtonClick = (
    button: HTMLButtonElement,
    dispatch: MazeActionDispatch,
  ): void => {
    if (!isMazeControlFocused(elements)) {
      return
    }

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

  // handleKeydown routes keyboard gestures through the same command vocabulary. The agent-config
  // form and delete dialog live inside elements.app's DOM subtree even in interactive mode, so
  // isMazeControlFocused alone would treat typing in them (e.g. a space in a player name) as a
  // game shortcut — Space/Escape would pause the round mid-edit. isFormControlTarget excludes
  // those editable targets first, mirroring the same guard in agent.ts's keydown handler.
  const handleKeydown = (
    event: KeyboardEvent,
    dispatch: MazeActionDispatch,
  ): void => {
    if (isFormControlTarget(event.target)) {
      return
    }

    if (!isMazeControlFocused(elements)) {
      return
    }

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

  // bindControlButtons attaches one shared button-handler path to top-menu and touch controls.
  const bindControlButtons = (
    buttons: HTMLButtonElement[],
    dispatch: MazeActionDispatch,
  ): void => {
    buttons.forEach((button) => {
      const onClick = (): void => {
        handleButtonClick(button, dispatch)
      }

      buttonBindings.push({ __button: button, __onClick: onClick })
      button.addEventListener("click", onClick)
    })
  }

  return {
    // This MazeActionControl exposes the interactive mode name, binds browser inputs, and ignores stored feedback.
    // name lets the runtime identify which MazeActionControl implementation is active.
    name: runtime.controlModes.interactive,
    // bindActionDispatch connects browser keyboard and button events to the shared action dispatcher.
    bindActionDispatch(dispatch, readState, commitAgentTurn) {
      void readState
      void commitAgentTurn
      // Start from a clean slate so rebinding never depends on whatever was attached before.
      releaseBindings()

      bindControlButtons(elements.controls, dispatch)
      bindControlButtons(elements.touchButtons, dispatch)

      keydownHandler = (event: KeyboardEvent): void => {
        handleKeydown(event, dispatch)
      }

      window.addEventListener("keydown", keydownHandler, { passive: false })
      elements.app.addEventListener("click", focusApp)
      attached = true
    },
    // readLastActionResult stays empty here because interactive users already get visual feedback.
    readLastActionResult() {
      return null
    },
    // recordActionResult is a no-op because the interactive mode does not retain replay results.
    recordActionResult(actionResult: MazeActionResult) {
      // Interactive controls already provide immediate visual feedback in the game view.
      void actionResult
    },
    // clearActionResult is a no-op because interactive mode never stores replay results.
    clearActionResult() {},
  }
}
