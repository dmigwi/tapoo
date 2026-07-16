import type {
  Elements,
  AgentApiConfig,
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
import {
  disableAgentApiConfigForNetworkError,
  loadPersistedAgentApiConfigs,
} from "../storage"
import { CONFIG } from "../config"

const { runtime } = CONFIG

type AgentButtonBinding = {
  __button: HTMLButtonElement
  __onClick: () => void
}

// createAgentMode builds the agent-api MazeActionControl while transport wiring is still pending.
export function createAgentMode(
  elements: Elements,
  readAgentConfigs: () => AgentApiConfig[] = loadPersistedAgentApiConfigs,
  disableAgentAfterNetworkError: (agent: AgentApiConfig) => void = (agent) => {
    disableAgentApiConfigForNetworkError(agent)
  },
): MazeActionControl {
  let attached = false
  let agentMovePoller: AgentMovePoller | null = null
  let lastActionState: MazeActionState | null = null
  let keydownHandler: ((event: KeyboardEvent) => void) | null = null
  const buttonBindings: AgentButtonBinding[] = []
  const focusCurrentApp = (): void => {
    elements.app.focus()
  }

  // releaseBindings removes any listeners registered by the last active dispatch binding.
  const releaseBindings = (): void => {
    releaseAllActionBindings({
      __attached: attached,
      __buttonBindings: buttonBindings,
      __keydownHandler: keydownHandler,
      __onBeforeRelease: () => {
        agentMovePoller?.__setAttached(false)
        agentMovePoller?.__stopPolling()
      },
      __removeAppFocus: () => {
        elements.app.removeEventListener("click", focusCurrentApp)
      },
      __setAttached: (nextAttached) => {
        attached = nextAttached
      },
      __setKeydownHandler: (nextKeydownHandler) => {
        keydownHandler = nextKeydownHandler
      },
    })
  }

  return {
    // This MazeActionControl exposes the agent-api mode name, binds local session actions, and stores feedback for agents.
    // name lets the runtime identify which MazeActionControl implementation is active.
    name: runtime.controlModes.agentApi,
    // bindActionDispatch starts the HTTP-driven move loop while keeping session controls local.
    bindActionDispatch(
      dispatch: MazeActionDispatch,
      readActionState,
      commitAgentTurn,
    ) {
      // Start from a clean slate so rebinding never depends on whatever was attached before.
      releaseBindings()

      const recordLastActionState = (actionState: MazeActionState): void => {
        lastActionState = actionState
      }

      // Agent-owned moves always ask for feedback so the next API request has fresh context.
      const dispatchAgentAction = (
        action: MazeAction,
        nextDispatch: MazeActionDispatch,
        playerName: string,
      ): MazeActionState => {
        const actionState = nextDispatch(action, { wantFeedback: true, playerName })
        if (!actionState) {
          throw new Error("agent move dispatch must return feedback")
        }

        recordLastActionState(actionState)
        return actionState
      }

      agentMovePoller = handleAgentTurnLoop({
        __commitAgentTurn: commitAgentTurn,
        __disableAgentAfterNetworkError: disableAgentAfterNetworkError,
        __dispatch: dispatch,
        __dispatchAgentAction: dispatchAgentAction,
        __elements: elements,
        __onActionState: recordLastActionState,
        __readAgentConfigs: readAgentConfigs,
        __readActionState: readActionState,
      })

      const syncCurrentPoller = (): void => {
        if (!agentMovePoller) {
          return
        }

        agentMovePoller.__stopPolling()
        if (agentMovePoller.__shouldPollAgent()) {
          agentMovePoller.__scheduleNextAgentTurn()
        }
      }

      // Human-owned session controls stay on the no-feedback path in agent-api mode.
      const bindSessionButtons = (buttons: HTMLButtonElement[]): void => {
        buttons.forEach((button) => {
          const onClick = (): void => {
            const command = sessionActionFromButton(button.dataset)
            if (!command) {
              return
            }

            focusCurrentApp()
            dispatch(command, { playerName: runtime.interactivePlayerName })
            syncCurrentPoller()
          }

          buttonBindings.push({ __button: button, __onClick: onClick })
          button.addEventListener("click", onClick)
        })
      }

      bindSessionButtons(elements.controls)
      bindSessionButtons(elements.touchButtons)

      keydownHandler = (event: KeyboardEvent): void => {
        const command = sessionActionFromKeyboardEvent(event)
        if (!command) {
          return
        }

        event.preventDefault()
        dispatch(command, { playerName: runtime.interactivePlayerName })
        syncCurrentPoller()
      }

      window.addEventListener("keydown", keydownHandler, { passive: false })
      elements.app.addEventListener("click", focusCurrentApp)
      attached = true
      agentMovePoller.__setAttached(true)
      agentMovePoller.__setLastActionState(lastActionState)
      syncCurrentPoller()
    },
    // readLastActionState exposes the latest stored response state for agent-side consumers.
    readLastActionState() {
      return lastActionState
    },
    // recordActionState keeps the last response state available for the agent-api control flow.
    recordActionState(actionState: MazeActionState) {
      lastActionState = actionState
      agentMovePoller?.__setLastActionState(actionState)
    },
    // clearActionState drops stale agent-facing context after full-session resets.
    clearActionState() {
      lastActionState = null
      agentMovePoller?.__setLastActionState(null)
    },
  }
}
