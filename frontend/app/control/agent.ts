import type {
  Elements,
  AgentApiConfig,
  MazeAction,
  MazeActionControl,
  MazeActionDispatch,
  MazeActionState,
} from "../types"
import { mergeMazeActionState } from "../agent-context"
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
  disableAgentForNetworkError,
  loadPersistedAgentConfigs,
} from "../storage"
import { CONFIG } from "../config"

const { runtime } = CONFIG

// createAgentMode builds the agent-api MazeActionControl while transport wiring is still pending.
export function createAgentMode(
  elements: Elements,
  readAgentConfigs: () => AgentApiConfig[] = () =>
    loadPersistedAgentConfigs("agent-api"),
  disableAgentAfterNetworkError: (agent: AgentApiConfig) => void = (agent) => {
    disableAgentForNetworkError("agent-api", agent)
  },
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
        agentMovePoller?.stopPolling()
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
    playerName: string,
  ): MazeActionState => {
    const actionState = dispatch(action, { wantFeedback: true, playerName })
    if (!actionState) {
      throw new Error("agent move dispatch must return feedback")
    }

    lastActionState = actionState
    return actionState
  }

  return {
    // This MazeActionControl exposes the agent-api mode name, binds local session actions, and stores feedback for agents.
    // name lets the runtime identify which MazeActionControl implementation is active.
    name: "agent-api",
    // bindActionDispatch starts the HTTP-driven move loop while keeping session controls local.
    bindActionDispatch(
      dispatch: MazeActionDispatch,
      readActionState,
      commitAgentTurn,
    ) {
      // Start from a clean slate so rebinding never depends on whatever was attached before.
      releaseBindings()
      // handleAgentNetworkError centralizes transport-failure persistence and the state shown to agents.
      const handleAgentNetworkError = (agent: AgentApiConfig): MazeActionState => {
        disableAgentAfterNetworkError(agent)
        const nextState = mergeMazeActionState(lastActionState ?? readActionState(), {
          playerName: agent.playerName,
          lastMoveStatus: "network-error",
          decayedMovesCount: 0,
        })

        lastActionState = nextState
        return nextState
      }

      agentMovePoller = handleAgentTurnLoop({
        commitAgentTurn,
        dispatch,
        dispatchAgentAction,
        elements,
        onActionState: (actionState) => {
          lastActionState = actionState
        },
        onAgentNetworkError: handleAgentNetworkError,
        readAgentConfigs,
        readActionState,
      })

      // syncAgentMovePoller keeps the HTTP move loop active only while the maze is actually running.
      const syncAgentMovePoller = (): void => {
        if (!agentMovePoller) {
          return
        }

        agentMovePoller.stopPolling()
        if (agentMovePoller.shouldPollAgent()) {
          agentMovePoller.scheduleNextAgentTurn()
        }
      }

      elements.touchButtons.forEach((button) => {
        const onClick = (): void => {
          const command = sessionActionFromButton(button.dataset)
          if (!command) {
            return
          }

          focusApp()
          // Local human session actions stay on the lightweight path and do not ask for feedback.
          dispatch(command, { playerName: runtime.interactivePlayerName })
          syncAgentMovePoller()
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
        dispatch(command, { playerName: runtime.interactivePlayerName })
        syncAgentMovePoller()
      }

      window.addEventListener("keydown", keydownHandler, { passive: false })
      elements.app.addEventListener("click", focusApp)
      attached = true
      agentMovePoller.setAttached(true)
      agentMovePoller.setLastActionState(lastActionState)
      syncAgentMovePoller()
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
