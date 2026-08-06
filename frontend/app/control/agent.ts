import type {
  Elements,
  AgentApiConfig,
  AgentApiProvider,
  MazeAction,
  MazeActionControl,
  MazeActionDispatch,
  MazeActionResult,
} from "../types"
import {
  agentConfigValidationError,
  isAgentApiProvider,
  normalizeAgentEndpoint,
} from "../agent/config"
import {
  handleAgentTurnLoop,
} from "./agent-api"
import type { AgentMovePoller, AgentRoundState } from "./agent-api"
import {
  agentSeatAddLabel,
  agentSeatIdFromDataset,
  agentSeatManageLabel,
  renderAgentSeatRoster,
} from "../agent/seats"
import {
  isFormControlTarget,
  isMazeControlFocused,
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
import {
  subscribeTapooLogs,
  logTapooDiagnostic,
  tapooDownloadLogs,
  tapooLogCount,
  tapooResetLogs,
} from "../logs"
import { isRunningStatus } from "../status"

const { agentConfig, runtime } = CONFIG

type AgentButtonBinding = {
  __button: HTMLButtonElement
  __onClick: () => void
}

// logAgentRoundCompletion captures the final agent-api round state without serializing the live
// clock or maze grid, keeping diagnostics useful while avoiding large circular-ish payloads.
function logAgentRoundCompletion({ __state, __agent }: AgentRoundState): void {
  const outcome = __state.status

  logTapooDiagnostic(runtime.controlModes.agentApi, "info", `Agent level ${outcome}.`, {
    outcome,
    agent: {
      id: __agent.id,
      playerName: __agent.playerName,
      model: __agent.model,
      enabled: __agent.enabled,
    },
    level: __state.level,
    score: __state.score,
    winSummary: __state.winSummary,
    turnCount: __state.turnCount,
    cumulativeRoundCount: __state.cumulativeRoundCount,
    mazeDimensions: __state.mazeDimensions,
    startPosition: __state.startPosition,
    playerPosition: __state.playerPosition,
    finalPosition: __state.finalPosition,
    // Only the count: an entry per visited cell is the largest thing in State, and it grew again
    // when openMoves became a resolved adjacency map. Paired with turnCount it still gives
    // the cells-per-request efficiency these entries are read for.
    uniqueCellsVisited: __state.traversalHistory.length,
  })
}

// createAgentMode builds the agent-api MazeActionControl while transport wiring is still pending.
export function createAgentMode(
  elements: Elements,
  readAgentConfigs: () => AgentApiConfig[] = loadPersistedAgentApiConfigs,
  disableAgentAfterNetworkError: (agent: AgentApiConfig) => void = (agent) => {
    disableAgentApiConfigForNetworkError(agent)
  },
): MazeActionControl {
  // These fields track DOM bindings and overlay state for the currently mounted agent mode.
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
  let agentConfigApiChangeHandler: (() => void) | null = null
  let agentFormCloseHandler: (() => void) | null = null
  let agentFormSubmitHandler: ((event: Event) => void) | null = null
  let agentFormOuterClickHandler: ((event: MouseEvent) => void) | null = null
  let releaseLogSubscription: (() => void) | null = null
  let lastActionResult: MazeActionResult | null = null
  let keydownHandler: ((event: KeyboardEvent) => void) | null = null
  const buttonBindings: AgentButtonBinding[] = []

  // Open overlays temporarily own focus, so normal app refocus should pause until they close.
  const isAgentConfigFormOpen = (): boolean => elements.agentConfigForm?.hidden === false
  const isAgentDeleteDialogOpen = (): boolean => elements.agentDeleteDialog?.hidden === false
  // At most one overlay is ever open (openAgentConfigForm/openAgentDeleteDialog each close the
  // other before opening), but callers that only care whether the app should yield focus or dim
  // don't need to know which — this is the shared "something is showing" check for those callers.
  const isAnyAgentOverlayOpen = (): boolean => isAgentConfigFormOpen() || isAgentDeleteDialogOpen()
  const focusCurrentApp = (): void => {
    if (isAnyAgentOverlayOpen()) {
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
        if (elements.agentSeatsBody) {
          elements.agentSeatsBody.hidden = true
        }
        releaseLogSubscription?.()
        releaseLogSubscription = null
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
        if (elements.agentConfigApi && agentConfigApiChangeHandler) {
          elements.agentConfigApi.removeEventListener("change", agentConfigApiChangeHandler)
          agentConfigApiChangeHandler = null
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
    // name lets the runtime identify which MazeActionControl implementation is active.
    name: runtime.controlModes.agentApi,
    // bindActionDispatch starts the HTTP-driven move loop while keeping session controls local.
    bindActionDispatch(
      dispatch: MazeActionDispatch,
      readState,
      commitAgentTurn,
    ) {
      // Start from a clean slate so rebinding never depends on whatever was attached before.
      releaseBindings()

      // recordLastActionResult captures the move outcome so agents and replays share one source of truth.
      const recordLastActionResult = (actionResult: MazeActionResult): void => {
        lastActionResult = actionResult
      }

      // Agent-owned moves always ask for feedback so the next API request has fresh context.
      const dispatchAgentAction = (
        action: MazeAction,
        nextDispatch: MazeActionDispatch,
        agent: AgentApiConfig,
      ): MazeActionResult => {
        const actionResult = nextDispatch(action, {
          wantFeedback: true,
          playerName: agent.playerName,
        })
        if (!actionResult) {
          throw new Error("agent move dispatch must return feedback")
        }

        recordLastActionResult(actionResult)
        return actionResult
      }

      // The poller owns turn timing; this mode supplies UI/storage hooks and move dispatch.
      agentMovePoller = handleAgentTurnLoop({
        __commitAgentTurn: commitAgentTurn,
        __disableAgentAfterNetworkError: disableAgentAfterNetworkError,
        __dispatch: dispatch,
        __dispatchAgentAction: dispatchAgentAction,
        __elements: elements,
        __onActionResult: recordLastActionResult,
        __onActiveAgentChange: (agent) => {
          activeAgentId = agent?.id ?? null
          renderAgentRoster()
        },
        __onRoundOutcome: logAgentRoundCompletion,
        __readAgentConfigs: readAgentConfigs,
        __readState: readState,
      })

      // currentPlayingAgentId returns the active agent only while the round is running; idle and paused sessions have none.
      const currentPlayingAgentId = (): number | null =>
        isRunningStatus(readState().status) ? activeAgentId : null

      // renderAgentRoster repaints the seat list with the latest config and highlights the currently playing agent.
      const renderAgentRoster = (): void => {
        if (elements.agentSeatsBody) {
          elements.agentSeatsBody.hidden = false
        }
        renderAgentSeatRoster(
          elements.agentSeatRoster,
          readAgentConfigs(),
          currentPlayingAgentId(),
          readState().traversalHistory,
        )
      }

      // syncCurrentPoller restarts the turn cycle after any config or session state change.
      const syncCurrentPoller = (): void => {
        if (!agentMovePoller) {
          return
        }

        agentMovePoller.__stopPolling()
        renderAgentRoster()
        if (agentMovePoller.__shouldPollAgent()) {
          // Human-triggered start/resume paths poll immediately so agent play begins without a stale wait.
          agentMovePoller.__scheduleNextAgentTurn()
        }
      }

      // syncOverlayState toggles the body class that dims the terminal while an overlay is open.
      const syncOverlayState = (): void => {
        elements.body.classList.toggle(
          "terminal-body--agent-form-active",
          isAnyAgentOverlayOpen(),
        )
      }

      // Agent management is human-owned, so opening a form pauses active agent traversal.
      const pauseIfRunning = (): void => {
        if (!isRunningStatus(readState().status)) {
          return
        }

        dispatch({ type: "pause" }, { playerName: runtime.interactivePlayerName })
        syncCurrentPoller()
      }

      // clearAgentConfigStatus wipes any previous validation message before the next submission attempt.
      const clearAgentConfigStatus = (): void => {
        if (elements.agentConfigStatus) {
          elements.agentConfigStatus.textContent = ""
          elements.agentConfigStatus.classList.remove("agent-config-form__status--error")
        }
      }

      // syncAgentEnabledToggle keeps the toggle label and CSS state aligned with the checkbox value.
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

      // syncAgentConfigEnabledToggle specializes syncAgentEnabledToggle for the add/edit form fields.
      const syncAgentConfigEnabledToggle = (): void => {
        syncAgentEnabledToggle(elements.agentConfigEnabled, elements.agentConfigEnabledLabel)
      }

      // syncAgentConfigProviderFields applies the selected provider's copy and field visibility:
      // the endpoint placeholder, the credential field's label (same input, different real-world
      // name per provider), and whether the Anthropic-only API-version field shows at all.
      const syncAgentConfigProviderFields = (): void => {
        const selectedApi = elements.agentConfigApi?.value
        const api: AgentApiProvider = isAgentApiProvider(selectedApi) ? selectedApi : "ollama"

        if (elements.agentConfigEndpoint) {
          const previousDefaults = Object.values(agentConfig.endpointPlaceholders)
          // The field's value (not just its placeholder) starts out hydrated to Ollama's default via
          // data-config-value, and switching providers would otherwise leave that real, editable text
          // behind looking like a deliberate choice. Only ever overwrite it when it still exactly
          // matches some provider's own default — anything the user actually typed is left alone.
          if (
            elements.agentConfigEndpoint.value === "" || previousDefaults.includes(elements.agentConfigEndpoint.value)
          ) {
            elements.agentConfigEndpoint.value = agentConfig.endpointPlaceholders[api]
          }
          elements.agentConfigEndpoint.placeholder = agentConfig.endpointPlaceholders[api]
        }
        if (elements.agentConfigCredentialLabel) {
          elements.agentConfigCredentialLabel.textContent = agentConfig.credentialLabels[api]
        }
        if (elements.agentConfigCredentialRequired) {
          // Ollama/OpenAI treat an empty credential as "send no auth header" against a trusted
          // local server; Anthropic's hosted API rejects every request without one. The asterisk
          // only appears — and is only enforced by agentConfigValidationError — for Anthropic.
          elements.agentConfigCredentialRequired.hidden = api !== "anthropic"
        }
        if (elements.agentConfigApiVersionField) {
          elements.agentConfigApiVersionField.hidden = api !== "anthropic"
        }
      }

      // resetAgentConfigForm clears all fields and the seat selection so the form is ready for a fresh add.
      const resetAgentConfigForm = (): void => {
        elements.agentConfigForm?.reset()
        selectedSeatId = null
        if (elements.agentConfigEnabled) {
          elements.agentConfigEnabled.checked = true
        }
        if (elements.agentConfigApi) {
          elements.agentConfigApi.value = "ollama"
        }
        syncAgentConfigEnabledToggle()
        syncAgentConfigProviderFields()
        clearAgentConfigStatus()
      }

      // setAgentConfigError surfaces a validation failure inside the form without a separate modal.
      const setAgentConfigError = (message: string): void => {
        if (!elements.agentConfigStatus) {
          return
        }

        elements.agentConfigStatus.textContent = message
        elements.agentConfigStatus.classList.add("agent-config-form__status--error")
      }

      // closeAgentConfigForm hides the form, resets its state, and restores the overlay class.
      const closeAgentConfigForm = (): void => {
        if (!elements.agentConfigForm) {
          return
        }

        elements.agentConfigForm.hidden = true
        resetAgentConfigForm()
        syncOverlayState()
      }

      // openAgentConfigForm pauses an active round, sets the target seat, and shows the add/edit overlay.
      const openAgentConfigForm = (seatId: number): void => {
        if (!elements.agentConfigForm) {
          return
        }

        // Both overlays share one screen position, so leaving the other open would render them
        // superimposed rather than merely stacked.
        if (isAgentDeleteDialogOpen()) {
          closeAgentDeleteDialog()
        }

        pauseIfRunning()
        selectedSeatId = seatId
        if (elements.agentConfigTitle) {
          elements.agentConfigTitle.textContent = agentSeatAddLabel(seatId)
        }
        elements.agentConfigForm.hidden = false
        syncAgentConfigEnabledToggle()
        syncAgentConfigProviderFields()
        syncOverlayState()
        elements.agentConfigPlayerName?.focus()
      }

      // closeAgentDeleteDialog hides the delete/disable dialog and clears the pending seat id.
      const closeAgentDeleteDialog = (): void => {
        if (!elements.agentDeleteDialog) {
          return
        }

        elements.agentDeleteDialog.hidden = true
        deleteSeatId = null
        syncOverlayState()
      }

      // syncAgentDeleteOptions disables the enable/disable toggle when the delete checkbox is checked.
      const syncAgentDeleteOptions = (): void => {
        const shouldDelete = elements.agentDeleteConfirm?.checked ?? false
        if (elements.agentDeleteEnabled) {
          elements.agentDeleteEnabled.disabled = shouldDelete
          elements.agentDeleteEnabled.closest(".agent-config-form__toggle")
            ?.classList.toggle("agent-config-form__toggle--disabled", shouldDelete)
        }
        syncAgentEnabledToggle(elements.agentDeleteEnabled, elements.agentDeleteEnabledLabel)
      }

      // openAgentDeleteDialog pauses an active round and opens the manage/delete overlay for the chosen seat.
      const openAgentDeleteDialog = (seatId: number): void => {
        const agent = readAgentConfigs().find((config) => config.id === seatId)
        if (!agent || agent.id === currentPlayingAgentId() || !elements.agentDeleteDialog) {
          return
        }

        // Both overlays share one screen position, so leaving the other open would render them
        // superimposed rather than merely stacked.
        if (isAgentConfigFormOpen()) {
          closeAgentConfigForm()
        }

        pauseIfRunning()
        deleteSeatId = seatId
        if (elements.agentDeleteTitle) {
          elements.agentDeleteTitle.textContent = agentSeatManageLabel(agent, readState().traversalHistory)
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

      // bindAgentRoster attaches a single delegated click handler to the seat roster container.
      const bindAgentRoster = (): void => {
        if (!elements.agentSeatRoster) {
          return
        }

        agentRosterClickHandler = (event: MouseEvent): void => {
          // Seats use event delegation because the roster is re-rendered after every config change.
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

          const seatIdToDelete = agentSeatIdFromDataset(button.dataset.agentSeatDelete)
          if (seatIdToDelete !== null) {
            openAgentDeleteDialog(seatIdToDelete)
          }
        }

        elements.agentSeatRoster.addEventListener("click", agentRosterClickHandler)
        renderAgentRoster()
      }

      // bindLogButtons wires the reset and download controls to the agent-api log store.
      const bindLogButtons = (): void => {
        // syncResetButton disables both log controls when there is nothing to act on.
        const syncResetButton = (): void => {
          const hasLogs = tapooLogCount() > 0
          if (elements.tapooLogsReset) {
            elements.tapooLogsReset.disabled = !hasLogs
          }
          if (elements.tapooLogsDownload) {
            elements.tapooLogsDownload.disabled = !hasLogs
          }
        }

        // showButtonFeedback briefly pulses the button's acknowledged CSS class for visual confirmation.
        const showButtonFeedback = (button: HTMLButtonElement): void => {
          button.classList.remove("tapoo-logs-control--acknowledged")
          void button.offsetWidth
          button.classList.add("tapoo-logs-control--acknowledged")
          window.setTimeout(() => {
            button.classList.remove("tapoo-logs-control--acknowledged")
          }, 420)
        }

        // Each button is bound to a const local so the deferred onClick closure keeps the
        // narrowed non-optional type; reading elements.<button> inside the closure would widen
        // it back to possibly-undefined, since the property could in principle change later.
        const resetButton = elements.tapooLogsReset
        if (resetButton) {
          const onClick = (): void => {
            showButtonFeedback(resetButton)
            tapooResetLogs(runtime.controlModes.agentApi)
          }
          buttonBindings.push({
            __button: resetButton,
            __onClick: onClick,
          })
          resetButton.addEventListener("click", onClick)
        }

        const downloadButton = elements.tapooLogsDownload
        if (downloadButton) {
          const onClick = (): void => {
            showButtonFeedback(downloadButton)
            tapooDownloadLogs(runtime.controlModes.agentApi)
          }
          buttonBindings.push({
            __button: downloadButton,
            __onClick: onClick,
          })
          downloadButton.addEventListener("click", onClick)
        }

        releaseLogSubscription = subscribeTapooLogs(syncResetButton)
      }

      // bindAgentConfigForm attaches submit, close, toggle, and outer-click handlers to the add/edit overlay.
      const bindAgentConfigForm = (): void => {
        const form = elements.agentConfigForm
        if (
          !form ||
          !elements.agentConfigPlayerName ||
          !elements.agentConfigModel ||
          !elements.agentConfigApi ||
          !elements.agentConfigEndpoint ||
          !elements.agentConfigCredential ||
          !elements.agentConfigCredentialLabel ||
          !elements.agentConfigCredentialRequired ||
          !elements.agentConfigApiVersionField ||
          !elements.agentConfigApiVersion ||
          !elements.agentConfigEnabled ||
          !elements.agentConfigEnabledLabel ||
          !elements.agentConfigClose ||
          !elements.agentConfigStatus
        ) {
          return
        }

        agentFormSubmitHandler = (event: Event): void => {
          // Empty seats are the only valid add target; occupied seats are managed in the dialog.
          event.preventDefault()

          const model = elements.agentConfigModel?.value.trim() ?? ""
          const playerName = elements.agentConfigPlayerName?.value.trim() ?? ""
          const endpoint = elements.agentConfigEndpoint?.value.trim() ?? ""
          const selectedApi = elements.agentConfigApi?.value
          const api: AgentApiProvider = isAgentApiProvider(selectedApi) ? selectedApi : "ollama"
          const credential = elements.agentConfigCredential?.value.trim() ?? ""
          // A stale API-version value left over from a previous provider selection must never
          // reach a non-Anthropic agent, even if the field itself is currently hidden rather than
          // cleared — hidden inputs still carry whatever text was last typed into them.
          const apiVersion = api === "anthropic" ? elements.agentConfigApiVersion?.value.trim() ?? "" : ""
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
            api,
            credential,
            apiVersion,
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

          const normalizedEndpoint = normalizeAgentEndpoint(endpoint)
          if (!normalizedEndpoint) {
            setAgentConfigError(agentConfig.invalidEndpointMessage)
            return
          }

          const nextAgent: AgentApiConfig = {
            id: selectedSeatId,
            playerName,
            model,
            endpoint: normalizedEndpoint,
            api,
            ...(credential ? { credential } : {}),
            ...(apiVersion ? { apiVersion } : {}),
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

        agentConfigApiChangeHandler = syncAgentConfigProviderFields
        elements.agentConfigApi.addEventListener("change", agentConfigApiChangeHandler)

        agentFormCloseHandler = closeAgentConfigForm
        elements.agentConfigClose.addEventListener("click", agentFormCloseHandler)

        // Only one overlay is ever open at a time (openAgentConfigForm/openAgentDeleteDialog each
        // close the other), so whichever one closeActiveAgentOverlay finds open is the right one.
        agentFormOuterClickHandler = (event: MouseEvent): void => {
          if (event.target === elements.body) {
            closeActiveAgentOverlay()
          }
        }
        elements.body.addEventListener("click", agentFormOuterClickHandler)
      }

      // bindAgentDeleteDialog wires the confirm-delete, enable-toggle, apply, and close handlers.
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
          // Delete wins over enable/disable edits because the seat becomes empty.
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

      // closeActiveAgentOverlay dismisses whichever overlay is open and returns true so callers can skip further handling.
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

      // handleFormControlKeydown intercepts keys inside form fields so they keep normal typing
      // behavior instead of falling through to global session shortcuts.
      const handleFormControlKeydown = (event: KeyboardEvent): boolean => {
        return isFormControlTarget(event.target)
      }

      // Human-owned session controls stay on the no-feedback path in agent-api mode.
      const bindSessionButtons = (buttons: HTMLButtonElement[]): void => {
        buttons.forEach((button) => {
          const onClick = (): void => {
            if (!isMazeControlFocused(elements)) {
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
      bindLogButtons()
      bindAgentRoster()
      bindAgentConfigForm()
      bindAgentDeleteDialog()

      // keydownHandler routes global keyboard shortcuts while yielding control to open overlays.
      keydownHandler = (event: KeyboardEvent): void => {
        // Escape closes whichever agent overlay is open, regardless of which element inside it
        // currently holds focus (an input, a button, or otherwise).
        if (event.key === "Escape" && closeActiveAgentOverlay()) {
          event.preventDefault()
          return
        }

        // Global shortcuts are ignored while the user is typing inside agent forms.
        if (handleFormControlKeydown(event)) {
          return
        }

        if (!isMazeControlFocused(elements)) {
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
      agentMovePoller.__setLastActionResult(lastActionResult)
      syncCurrentPoller()
    },
    // readLastActionResult exposes the latest stored replay result for agent-side consumers.
    readLastActionResult() {
      return lastActionResult
    },
    // recordActionResult keeps the last replay result available for the agent-api control flow.
    recordActionResult(actionResult: MazeActionResult) {
      lastActionResult = actionResult
      agentMovePoller?.__setLastActionResult(actionResult)
    },
    // clearActionResult drops stale agent-facing replay data after full-session resets.
    clearActionResult() {
      lastActionResult = null
      agentMovePoller?.__setLastActionResult(null)
    },
  }
}
