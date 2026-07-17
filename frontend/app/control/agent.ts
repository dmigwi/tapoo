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
  savePersistedAgentApiConfigs,
} from "../storage"
import { CONFIG } from "../config"
import { isRunningStatus } from "../status"

const { agentConfig, runtime } = CONFIG

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
  let agentFormCloseHandler: (() => void) | null = null
  let agentFormSubmitHandler: ((event: Event) => void) | null = null
  let agentFormOuterClickHandler: ((event: MouseEvent) => void) | null = null
  let lastActionState: MazeActionState | null = null
  let keydownHandler: ((event: KeyboardEvent) => void) | null = null
  const buttonBindings: AgentButtonBinding[] = []
  const isAgentConfigFormOpen = (): boolean =>
    elements.agentConfigForm?.hidden === false
  const focusCurrentApp = (): void => {
    if (isAgentConfigFormOpen()) {
      return
    }

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
        elements.body.classList.remove("terminal-body--agent-form-active")
        if (elements.agentConfigForm && agentFormSubmitHandler) {
          elements.agentConfigForm.removeEventListener("submit", agentFormSubmitHandler)
          agentFormSubmitHandler = null
        }
        if (elements.agentConfigClose && agentFormCloseHandler) {
          elements.agentConfigClose.removeEventListener("click", agentFormCloseHandler)
          agentFormCloseHandler = null
        }
        if (agentFormOuterClickHandler) {
          elements.body.removeEventListener("click", agentFormOuterClickHandler)
          agentFormOuterClickHandler = null
        }
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

      const resetAgentConfigForm = (): void => {
        elements.agentConfigForm?.reset()
        if (elements.agentConfigEnabled) {
          elements.agentConfigEnabled.checked = true
        }
        if (elements.agentConfigStatus) {
          elements.agentConfigStatus.textContent = ""
          elements.agentConfigStatus.classList.remove(
            "agent-config-form__status--error",
          )
        }
      }

      const setAgentConfigMessage = (message: string, isError = false): void => {
        if (!elements.agentConfigStatus) {
          return
        }

        elements.agentConfigStatus.textContent = message
        elements.agentConfigStatus.classList.toggle(
          "agent-config-form__status--error",
          isError,
        )
      }

      const closeAgentConfigForm = (): void => {
        if (!elements.agentConfigForm) {
          return
        }

        elements.agentConfigForm.hidden = true
        elements.body.classList.remove("terminal-body--agent-form-active")
        resetAgentConfigForm()
      }

      const openAgentConfigForm = (): void => {
        if (!elements.agentConfigForm) {
          return
        }

        elements.agentConfigForm.hidden = false
        elements.body.classList.add("terminal-body--agent-form-active")
        elements.agentConfigPlayerName?.focus()
      }

      const toggleAgentConfigForm = (): void => {
        if (!elements.agentConfigForm) {
          return
        }

        if (isRunningStatus(readActionState().status)) {
          closeAgentConfigForm()
          return
        }

        if (elements.agentConfigForm.hidden) {
          openAgentConfigForm()
          return
        }

        closeAgentConfigForm()
      }

      const bindAgentConfigForm = (): void => {
        const form = elements.agentConfigForm
        if (
          !form ||
          !elements.agentConfigPlayerName ||
          !elements.agentConfigModel ||
          !elements.agentConfigEndpoint ||
          !elements.agentConfigEnabled ||
          !elements.agentConfigClose ||
          !elements.agentConfigStatus
        ) {
          return
        }

        agentFormSubmitHandler = (event: Event): void => {
          event.preventDefault()

          const playerName = elements.agentConfigPlayerName?.value.trim() ?? ""
          const model = elements.agentConfigModel?.value.trim() ?? ""
          const endpoint = elements.agentConfigEndpoint?.value.trim() ?? ""
          const enabled = elements.agentConfigEnabled?.checked ?? false
          setAgentConfigMessage("")

          if (!playerName || !model || !endpoint) {
            setAgentConfigMessage(agentConfig.invalidMessage, true)
            return
          }

          const existingAgents = readAgentConfigs()
          const existingPlayerName = existingAgents.some(
            (agent) =>
              agent.playerName.trim().toLowerCase() ===
              playerName.toLowerCase(),
          )
          if (existingPlayerName) {
            setAgentConfigMessage(agentConfig.duplicatePlayerNameMessage, true)
            return
          }

          const agentIdBase = playerName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "") || "agent"
          const nextAgent: AgentApiConfig = {
            id: `${agentIdBase}-${Date.now().toString(36)}`,
            playerName,
            model,
            endpoint,
            enabled,
          }

          savePersistedAgentApiConfigs([...existingAgents, nextAgent])
          resetAgentConfigForm()
          setAgentConfigMessage(agentConfig.addedMessage)
          syncCurrentPoller()
        }

        form.addEventListener("submit", agentFormSubmitHandler)

        agentFormCloseHandler = (): void => {
          closeAgentConfigForm()
        }
        elements.agentConfigClose.addEventListener("click", agentFormCloseHandler)

        agentFormOuterClickHandler = (event: MouseEvent): void => {
          if (
            elements.agentConfigForm?.hidden === false &&
            event.target === elements.body
          ) {
            closeAgentConfigForm()
          }
        }
        elements.body.addEventListener("click", agentFormOuterClickHandler)
      }

      // Human-owned session controls stay on the no-feedback path in agent-api mode.
      const bindSessionButtons = (buttons: HTMLButtonElement[]): void => {
        buttons.forEach((button) => {
          const onClick = (): void => {
            if (button.dataset.agentConfigToggle === "true") {
              focusCurrentApp()
              toggleAgentConfigForm()
              return
            }

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
      bindAgentConfigForm()

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
