import type {
  Elements,
  MazeAction,
  MazeActionControl,
  MazeActionDispatch,
  MazeActionState,
} from "../types"
import {
  handleAgentTurnLoop,
} from "./agent-api"
import type { AgentMovePoller } from "./agent-api"
import {
  releaseAllActionBindings,
  sessionActionFromButton,
  sessionActionFromKeyboardEvent,
} from "./session-actions"

// createAgentMode builds the agent-api MazeActionControl while transport wiring is still pending.
export function createAgentMode(
  elements: Elements,
): MazeActionControl {
  let attached = false
  let agentMovePoller: AgentMovePoller | null = null
  let lastActionState: MazeActionState | null = null
  let keydownHandler: ((event: KeyboardEvent) => void) | null = null
  const touchHandlers: Array<{
    button: HTMLButtonElement
    onClick: () => void
  }> = []

  // focusApp keeps local keyboard shortcuts anchored to the terminal root after button taps.
  const focusApp = (): void => {
    elements.app.focus()
  }

  // releaseBindings removes any listeners registered by the last active dispatch binding.
  const releaseBindings = (): void => {
    releaseAllActionBindings({
      attached,
      buttonBindings: touchHandlers,
      keydownHandler,
      onBeforeRelease: () => {
        attached = false
        agentMovePoller?.setAttached(false)
        agentMovePoller?.clearScheduledTurn()
        agentMovePoller?.abortActiveRequest()
      },
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

  // dispatchAgentAction keeps agent-owned traversal requests on the explicit feedback path.
  const dispatchAgentAction = (
    action: MazeAction,
    dispatch: MazeActionDispatch,
  ): MazeActionState | null => {
    const actionState = dispatch(action, { wantFeedback: true })
    if (actionState) {
      lastActionState = actionState
    }
    return actionState
  }

  return {
    // This MazeActionControl exposes the agent-api mode name, binds local session actions, and stores feedback for agents.
    // name lets the runtime identify which MazeActionControl implementation is active.
    name: "agent-api",
    // bindActionDispatch starts the HTTP-driven move loop while keeping session controls local.
    bindActionDispatch(
      dispatch: MazeActionDispatch,
      readAgentContext,
    ) {
      // Start from a clean slate so rebinding never depends on whatever was attached before.
      releaseBindings()
      agentMovePoller = handleAgentTurnLoop({
        dispatch,
        dispatchAgentAction,
        elements,
        readAgentContext,
      })

      elements.touchButtons.forEach((button) => {
        const onClick = (): void => {
          const command = sessionActionFromButton(button.dataset)
          if (!command) {
            return
          }

          focusApp()
          // Local human session actions stay on the lightweight path and do not ask for feedback.
          dispatch(command)
        }

        touchHandlers.push({ button, onClick })
        button.addEventListener("click", onClick)
      })

      keydownHandler = (event: KeyboardEvent): void => {
        const command = sessionActionFromKeyboardEvent(event)
        if (!command) {
          return
        }

        event.preventDefault()
        // Local human session actions stay on the lightweight path and do not ask for feedback.
        dispatch(command)
      }

      window.addEventListener("keydown", keydownHandler, { passive: false })
      elements.app.addEventListener("click", focusApp)
      attached = true
      agentMovePoller.setAttached(true)
      agentMovePoller.setLastActionState(lastActionState)
      agentMovePoller.scheduleNextAgentTurn()
    },
    // readLastActionState exposes the latest stored response state for agent-side consumers.
    readLastActionState() {
      return lastActionState
    },
    // recordActionState keeps the last response state available for the agent-api control flow.
    recordActionState(actionState: MazeActionState) {
      lastActionState = actionState
      agentMovePoller?.setLastActionState(actionState)
    },
  }
}
