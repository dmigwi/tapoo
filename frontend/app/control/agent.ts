import type {
  Elements,
  AgentApiConfig,
  MazeAction,
  MazeActionControl,
  MazeActionDispatch,
  MazeActionState,
} from "../types"
import {
  agentConfigValidationError,
  normalizeAgentEndpoint,
} from "../agent/config"
import {
  handleAgentTurnLoop,
} from "./agent-api"
import type { AgentMovePoller } from "./agent-api"
import {
  agentSeatAddLabel,
  agentSeatIdFromDataset,
  agentSeatManageLabel,
  renderAgentSeatRoster,
} from "../agent/seats"
import {
  isFormControlTarget,
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
  let activeAgentId: number | null = null
  let selectedSeatId: number | null = null
  let deleteSeatId: number | null = null
  let agentRosterClickHandler: ((event: MouseEvent) => void) | null = null
  let agentDeleteCloseHandler: (() => void) | null = null
  let agentDeleteApplyHandler: (() => void) | null = null
  let agentDeleteConfirmChangeHandler: (() => void) | null = null
  let agentDeleteEnabledChangeHandler: (() => void) | null = null
  let agentConfigEnabledChangeHandler: (() => void) | null = null
  let agentFormCloseHandler: (() => void) | null = null
  let agentFormSubmitHandler: ((event: Event) => void) | null = null
  let agentFormOuterClickHandler: ((event: MouseEvent) => void) | null = null
  let lastActionState: MazeActionState | null = null
  let keydownHandler: ((event: KeyboardEvent) => void) | null = null
  const buttonBindings: AgentButtonBinding[] = []
  const isAgentConfigFormOpen = (): boolean => elements.agentConfigForm?.hidden === false
  const isAgentDeleteDialogOpen = (): boolean => elements.agentDeleteDialog?.hidden === false
  const focusCurrentApp = (): void => {
    if (isAgentConfigFormOpen() || isAgentDeleteDialogOpen()) {
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
        if (elements.agentSeatRoster && agentRosterClickHandler) {
          elements.agentSeatRoster.removeEventListener("click", agentRosterClickHandler)
          agentRosterClickHandler = null
        }
        if (elements.agentDeleteClose && agentDeleteCloseHandler) {
          elements.agentDeleteClose.removeEventListener("click", agentDeleteCloseHandler )
          agentDeleteCloseHandler = null
        }
        if (elements.agentDeleteApply && agentDeleteApplyHandler) {
          elements.agentDeleteApply.removeEventListener("click", agentDeleteApplyHandler )
          agentDeleteApplyHandler = null
        }
        if (elements.agentDeleteConfirm && agentDeleteConfirmChangeHandler) {
          elements.agentDeleteConfirm.removeEventListener("change", agentDeleteConfirmChangeHandler )
          agentDeleteConfirmChangeHandler = null
        }
        if (elements.agentDeleteEnabled && agentDeleteEnabledChangeHandler) {
          elements.agentDeleteEnabled.removeEventListener("change", agentDeleteEnabledChangeHandler )
          agentDeleteEnabledChangeHandler = null
        }
        if (elements.agentConfigEnabled && agentConfigEnabledChangeHandler) {
          elements.agentConfigEnabled.removeEventListener("change", agentConfigEnabledChangeHandler )
          agentConfigEnabledChangeHandler = null
        }
        if (elements.agentConfigForm && agentFormSubmitHandler) {
          elements.agentConfigForm.removeEventListener("submit", agentFormSubmitHandler )
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
        const actionState = nextDispatch(action, {
          wantFeedback: true,
          playerName,
        })
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
        __onActiveAgentChange: (agent) => {
          activeAgentId = agent?.id ?? null
          renderAgentRoster()
        },
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

      const syncOverlayState = (): void => {
        elements.body.classList.toggle(
          "terminal-body--agent-form-active",
          isAgentConfigFormOpen() || isAgentDeleteDialogOpen(),
        )
      }

      const pauseIfRunning = (): void => {
        if (!isRunningStatus(readActionState().status)) {
          return
        }

        dispatch({ type: "pause" }, { playerName: runtime.interactivePlayerName })
        syncCurrentPoller()
      }

      const renderAgentRoster = (): void => {
        renderAgentSeatRoster(elements.agentSeatRoster, readAgentConfigs(), activeAgentId)
      }

      const clearAgentConfigStatus = (): void => {
        if (elements.agentConfigStatus) {
          elements.agentConfigStatus.textContent = ""
          elements.agentConfigStatus.classList.remove("agent-config-form__status--error")
        }
      }

      const syncAgentEnabledToggle = (
        input: HTMLInputElement | undefined,
        label: HTMLElement | undefined,
      ): void => {
        const agentEnabled = input?.checked ?? false
        input
          ?.closest(".agent-config-form__toggle")
          ?.classList.toggle("agent-config-form__toggle--off", !agentEnabled)
        if (label) {
          label.textContent = agentEnabled
            ? agentConfig.agentEnabledLabel
            : agentConfig.agentDisabledLabel
        }
      }

      const syncAgentConfigEnabledToggle = (): void => {
        syncAgentEnabledToggle(elements.agentConfigEnabled, elements.agentConfigEnabledLabel)
      }

      const resetAgentConfigForm = (): void => {
        elements.agentConfigForm?.reset()
        selectedSeatId = null
        if (elements.agentConfigEnabled) {
          elements.agentConfigEnabled.checked = true
        }
        syncAgentConfigEnabledToggle()
        clearAgentConfigStatus()
      }

      const setAgentConfigError = (message: string): void => {
        if (!elements.agentConfigStatus) {
          return
        }

        elements.agentConfigStatus.textContent = message
        elements.agentConfigStatus.classList.add("agent-config-form__status--error")
      }

      const closeAgentConfigForm = (): void => {
        if (!elements.agentConfigForm) {
          return
        }

        elements.agentConfigForm.hidden = true
        resetAgentConfigForm()
        syncOverlayState()
      }

      const openAgentConfigForm = (seatId: number): void => {
        if (!elements.agentConfigForm) {
          return
        }

        pauseIfRunning()
        selectedSeatId = seatId
        if (elements.agentConfigTitle) {
          elements.agentConfigTitle.textContent = agentSeatAddLabel(seatId)
        }
        elements.agentConfigForm.hidden = false
        syncAgentConfigEnabledToggle()
        syncOverlayState()
        elements.agentConfigPlayerName?.focus()
      }

      const closeAgentDeleteDialog = (): void => {
        if (!elements.agentDeleteDialog) {
          return
        }

        elements.agentDeleteDialog.hidden = true
        deleteSeatId = null
        syncOverlayState()
      }

      const syncAgentDeleteOptions = (): void => {
        const shouldDelete = elements.agentDeleteConfirm?.checked ?? false
        if (elements.agentDeleteEnabled) {
          elements.agentDeleteEnabled.disabled = shouldDelete
          elements.agentDeleteEnabled.closest(".agent-config-form__toggle")
            ?.classList.toggle("agent-config-form__toggle--disabled", shouldDelete)
        }
        syncAgentEnabledToggle(elements.agentDeleteEnabled, elements.agentDeleteEnabledLabel)
      }

      const openAgentDeleteDialog = (seatId: number): void => {
        const agent = readAgentConfigs().find((config) => config.id === seatId)
        if (!agent || agent.id === activeAgentId || !elements.agentDeleteDialog) {
          return
        }

        pauseIfRunning()
        deleteSeatId = seatId
        if (elements.agentDeleteTitle) {
          elements.agentDeleteTitle.textContent = agentSeatManageLabel(agent)
        }
        if (elements.agentDeleteTarget) {
          elements.agentDeleteTarget.textContent = agentConfig.deleteMessageTemplate
        }
        elements.agentDeleteDialog.hidden = false
        if (elements.agentDeleteEnabled) {
          elements.agentDeleteEnabled.checked = agent.enabled
        }
        if (elements.agentDeleteConfirm) {
          elements.agentDeleteConfirm.checked = false
        }
        syncAgentDeleteOptions()
        syncOverlayState()
        elements.agentDeleteApply?.focus()
      }

      const bindAgentRoster = (): void => {
        if (!elements.agentSeatRoster) {
          return
        }

        agentRosterClickHandler = (event: MouseEvent): void => {
          const target = event.target
          if (!(target instanceof Element)) {
            return
          }

          const button = target.closest("button")
          if (!(button instanceof HTMLButtonElement)) {
            return
          }

          const seatIdToAdd = agentSeatIdFromDataset(button.dataset.agentSeatAdd)
          if (seatIdToAdd !== null) {
            openAgentConfigForm(seatIdToAdd)
            return
          }

          const seatIdToDelete = agentSeatIdFromDataset(
            button.dataset.agentSeatDelete,
          )
          if (seatIdToDelete !== null) {
            openAgentDeleteDialog(seatIdToDelete)
          }
        }

        elements.agentSeatRoster.addEventListener("click", agentRosterClickHandler)
        renderAgentRoster()
      }

      const bindAgentConfigForm = (): void => {
        const form = elements.agentConfigForm
        if (
          !form ||
          !elements.agentConfigPlayerName ||
          !elements.agentConfigModel ||
          !elements.agentConfigEndpoint ||
          !elements.agentConfigEnabled ||
          !elements.agentConfigEnabledLabel ||
          !elements.agentConfigClose ||
          !elements.agentConfigStatus
        ) {
          return
        }

        agentFormSubmitHandler = (event: Event): void => {
          event.preventDefault()

          const model = elements.agentConfigModel?.value.trim() ?? ""
          const playerName = elements.agentConfigPlayerName?.value.trim() ?? ""
          const endpoint = elements.agentConfigEndpoint?.value.trim() ?? ""
          const enabled = elements.agentConfigEnabled?.checked ?? false
          clearAgentConfigStatus()

          if (!selectedSeatId) {
            setAgentConfigError(agentConfig.invalidMessage)
            return
          }

          const existingAgents = readAgentConfigs()
          const validationError = agentConfigValidationError({
            endpoint,
            existingAgents,
            model,
            playerName,
          })
          if (validationError) {
            setAgentConfigError(validationError)
            return
          }

          if (existingAgents.some((agent) => agent.id === selectedSeatId)) {
            closeAgentConfigForm()
            renderAgentRoster()
            return
          }

          const nextAgent: AgentApiConfig = {
            id: selectedSeatId,
            playerName,
            model,
            endpoint: normalizeAgentEndpoint(endpoint) ?? endpoint,
            enabled,
          }

          savePersistedAgentApiConfigs([...existingAgents, nextAgent])
          closeAgentConfigForm()
          renderAgentRoster()
          syncCurrentPoller()
        }

        form.addEventListener("submit", agentFormSubmitHandler)

        agentConfigEnabledChangeHandler = syncAgentConfigEnabledToggle
        elements.agentConfigEnabled.addEventListener("change", agentConfigEnabledChangeHandler)

        agentFormCloseHandler = closeAgentConfigForm
        elements.agentConfigClose.addEventListener("click", agentFormCloseHandler)

        agentFormOuterClickHandler = (event: MouseEvent): void => {
          if (elements.agentConfigForm?.hidden === false && event.target === elements.body) {
            closeAgentConfigForm()
            return
          }

          if (
            elements.agentDeleteDialog?.hidden === false &&
            event.target === elements.body
          ) {
            closeAgentDeleteDialog()
          }
        }
        elements.body.addEventListener("click", agentFormOuterClickHandler)
      }

      const bindAgentDeleteDialog = (): void => {
        if (
          !elements.agentDeleteClose ||
          !elements.agentDeleteEnabled ||
          !elements.agentDeleteEnabledLabel ||
          !elements.agentDeleteApply ||
          !elements.agentDeleteConfirm
        ) {
          return
        }

        agentDeleteCloseHandler = closeAgentDeleteDialog
        agentDeleteConfirmChangeHandler = syncAgentDeleteOptions
        agentDeleteEnabledChangeHandler = syncAgentDeleteOptions
        agentDeleteApplyHandler = (): void => {
          if (!deleteSeatId) {
            closeAgentDeleteDialog()
            return
          }

          const enabled = elements.agentDeleteEnabled?.checked ?? false
          const shouldDelete = elements.agentDeleteConfirm?.checked ?? false
          const nextAgents = shouldDelete
            ? readAgentConfigs().filter((agent) => agent.id !== deleteSeatId)
            : readAgentConfigs().map((agent) =>
                agent.id === deleteSeatId ? { ...agent, enabled } : agent,
              )
          savePersistedAgentApiConfigs(nextAgents)
          closeAgentDeleteDialog()
          renderAgentRoster()
          syncCurrentPoller()
        }

        elements.agentDeleteClose.addEventListener("click", agentDeleteCloseHandler)
        elements.agentDeleteConfirm.addEventListener("change", agentDeleteConfirmChangeHandler)
        elements.agentDeleteEnabled.addEventListener("change", agentDeleteEnabledChangeHandler)
        elements.agentDeleteApply.addEventListener("click", agentDeleteApplyHandler)
      }

      const closeActiveAgentOverlay = (): boolean => {
        if (isAgentConfigFormOpen()) {
          closeAgentConfigForm()
          return true
        }

        if (isAgentDeleteDialogOpen()) {
          closeAgentDeleteDialog()
          return true
        }

        return false
      }

      const handleFormControlKeydown = (event: KeyboardEvent): boolean => {
        if (!isFormControlTarget(event.target)) {
          return false
        }

        if (event.key === "Escape" && closeActiveAgentOverlay()) {
          event.preventDefault()
        }

        return true
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
      bindAgentRoster()
      bindAgentConfigForm()
      bindAgentDeleteDialog()

      keydownHandler = (event: KeyboardEvent): void => {
        if (handleFormControlKeydown(event)) {
          return
        }

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
