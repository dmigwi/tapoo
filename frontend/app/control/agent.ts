import type {
  Elements,
  AgentApiConfig,
  AgentApiProvider,
  AgentReasoningEffort,
  MazeAction,
  MazeActionControl,
  MazeActionDispatch,
  MazeActionResult,
  State,
} from "../types"
import {
  agentConfigValidationError,
  isAgentApiProvider,
  isAgentReasoningEffort,
  normalizeAgentEndpoint,
} from "../agent/config"
import {
  calculateTraversalSpeedUnits,
  formatPlayerStatusLabel,
  getBatchEfficiencyMetrics,
  resolveStatusSpeedClass,
  traversalSpeedUnitsToDisplay,
} from "../agent/efficiency"
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
function logAgentRoundCompletion({ __state, __agent, __playerStatus }: AgentRoundState): void {
  const outcome = __state.status
  const traversalSpeedUnits = calculateTraversalSpeedUnits(
    __playerStatus.uniqueCellsVisited,
    __playerStatus.decayUnitsCharged,
  )

  logTapooDiagnostic(runtime.controlModes.agentApi, "info", `Agent level ${outcome}.`, {
    outcome,
    agent: {
      id: __agent.id,
      playerName: __agent.playerName,
      model: __agent.model,
      enabled: __agent.enabled,
    },
    level: __state.level,
    // Round-end displays and persistence use lastRoundScore, which is finalized only after the
    // current request's decay has been committed. Reusing it here keeps diagnostics aligned with
    // the win/loss overlay instead of serializing a transient live score value.
    score: __state.lastRoundScore,
    winSummary: __state.winSummary,
    turnCount: __state.turnCount,
    cumulativeRoundCount: __state.cumulativeRoundCount,
    mazeDimensions: __state.mazeDimensions,
    startPosition: __state.startPosition,
    playerPosition: __state.playerPosition,
    finalPosition: __state.finalPosition,
    allUniqueCellsVisited: __state.traversalHistory.length,
    playerUniqueCellsVisited: __playerStatus.uniqueCellsVisited,
    decayUnitsCharged: __playerStatus.decayUnitsCharged,
    traversalSpeed: traversalSpeedUnitsToDisplay(traversalSpeedUnits),
    traversalSpeedClass: resolveStatusSpeedClass(
      __playerStatus.uniqueCellsVisited,
      __playerStatus.decayUnitsCharged,
    ),
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
  let manageSeatId: number | null = null
  let agentRosterClickHandler: ((event: MouseEvent) => void) | null = null
  let agentManageCloseHandler: (() => void) | null = null
  let agentManageApplyHandler: (() => void) | null = null
  let agentDeleteConfirmChangeHandler: (() => void) | null = null
  let agentManageEnabledChangeHandler: (() => void) | null = null
  let agentManageEchoBackReasoningChangeHandler: (() => void) | null = null
  let agentManageReasoningEffortChangeHandler: (() => void) | null = null
  let agentConfigEnabledChangeHandler: (() => void) | null = null
  let agentConfigApiChangeHandler: (() => void) | null = null
  let agentConfigExtraHeadersAddHandler: (() => void) | null = null
  let agentConfigEchoBackReasoningChangeHandler: (() => void) | null = null
  let agentConfigReasoningEffortChangeHandler: (() => void) | null = null
  let agentFormCloseHandler: (() => void) | null = null
  let agentFormSubmitHandler: ((event: Event) => void) | null = null
  let agentFormOuterClickHandler: ((event: MouseEvent) => void) | null = null
  let releaseLogSubscription: (() => void) | null = null
  let lastActionResult: MazeActionResult | null = null
  let keydownHandler: ((event: KeyboardEvent) => void) | null = null
  let boundReadState: (() => State) | null = null
  const buttonBindings: AgentButtonBinding[] = []

  // Open overlays temporarily own focus, so normal app refocus should pause until they close.
  const isAgentConfigFormOpen = (): boolean => elements.agentConfigForm?.hidden === false
  const isAgentManageDialogOpen = (): boolean => elements.agentManageDialog?.hidden === false
  // At most one overlay is ever open (openAgentConfigForm/openAgentManageDialog each close the
  // other before opening), but callers that only care whether the app should yield focus or dim
  // don't need to know which — this is the shared "something is showing" check for those callers.
  const isAnyAgentOverlayOpen = (): boolean => isAgentConfigFormOpen() || isAgentManageDialogOpen()
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
        if (elements.agentManageClose && agentManageCloseHandler) {
          elements.agentManageClose.removeEventListener("click", agentManageCloseHandler )
          agentManageCloseHandler = null
        }
        if (elements.agentManageApply && agentManageApplyHandler) {
          elements.agentManageApply.removeEventListener("click", agentManageApplyHandler )
          agentManageApplyHandler = null
        }
        if (elements.agentDeleteConfirm && agentDeleteConfirmChangeHandler) {
          elements.agentDeleteConfirm.removeEventListener("change", agentDeleteConfirmChangeHandler )
          agentDeleteConfirmChangeHandler = null
        }
        if (elements.agentManageEnabled && agentManageEnabledChangeHandler) {
          elements.agentManageEnabled.removeEventListener("change", agentManageEnabledChangeHandler )
          agentManageEnabledChangeHandler = null
        }
        if (elements.agentManageEchoBackReasoning && agentManageEchoBackReasoningChangeHandler) {
          elements.agentManageEchoBackReasoning.removeEventListener("change", agentManageEchoBackReasoningChangeHandler)
          agentManageEchoBackReasoningChangeHandler = null
        }
        if (elements.agentManageReasoningEffort && agentManageReasoningEffortChangeHandler) {
          elements.agentManageReasoningEffort.removeEventListener("change", agentManageReasoningEffortChangeHandler)
          agentManageReasoningEffortChangeHandler = null
        }
        if (elements.agentConfigEnabled && agentConfigEnabledChangeHandler) {
          elements.agentConfigEnabled.removeEventListener("change", agentConfigEnabledChangeHandler )
          agentConfigEnabledChangeHandler = null
        }
        if (elements.agentConfigApi && agentConfigApiChangeHandler) {
          elements.agentConfigApi.removeEventListener("change", agentConfigApiChangeHandler)
          agentConfigApiChangeHandler = null
        }
        if (elements.agentConfigExtraHeadersAdd && agentConfigExtraHeadersAddHandler) {
          elements.agentConfigExtraHeadersAdd.removeEventListener("click", agentConfigExtraHeadersAddHandler)
          agentConfigExtraHeadersAddHandler = null
        }
        if (elements.agentConfigEchoBackReasoning && agentConfigEchoBackReasoningChangeHandler) {
          elements.agentConfigEchoBackReasoning.removeEventListener("change", agentConfigEchoBackReasoningChangeHandler)
          agentConfigEchoBackReasoningChangeHandler = null
        }
        if (elements.agentConfigReasoningEffort && agentConfigReasoningEffortChangeHandler) {
          elements.agentConfigReasoningEffort.removeEventListener("change", agentConfigReasoningEffortChangeHandler)
          agentConfigReasoningEffortChangeHandler = null
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
      commitTurn,
    ) {
      // Start from a clean slate so rebinding never depends on whatever was attached before.
      releaseBindings()
      boundReadState = readState

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
        __commitAgentTurn: commitTurn,
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

      // syncToggleState keeps a toggle's label and CSS state aligned with its checkbox value, and
      // now also owns locking it from user interaction: every caller that needs to disable a toggle
      // (the delete-confirmation checkbox freezing enabled/echo-back, reasoning effort "none" locking
      // echo-back) used to hand-roll the same .disabled assignment plus
      // .agent-config-form__toggle--disabled class toggle — centralized here instead so there is one
      // place that defines what "disabled" means for a toggle. A disabled toggle is always forced off
      // rather than left showing whatever it last held: a control a user cannot interact with should
      // never silently claim to be on. Takes the on/off copy explicitly so it can drive any of the
      // form's toggles, not just enabled/disabled.
      const syncToggleState = (
        input: HTMLInputElement | undefined,
        label: HTMLElement | undefined,
        onLabel: string,
        offLabel: string,
        disabled = false,
      ): void => {
        if (input) {
          input.disabled = disabled
          if (disabled) {
            input.checked = false
          }
        }
        const isOn = input?.checked ?? false
        const toggle = input?.closest(".agent-config-form__toggle")
        toggle?.classList.toggle("agent-config-form__toggle--off", !isOn)
        toggle?.classList.toggle("agent-config-form__toggle--disabled", disabled)
        if (label) {
          label.textContent = isOn ? onLabel : offLabel
        }
      }

      // syncAgentEnabledToggle specializes syncToggleState for the shared enabled/disabled toggle,
      // used by both the add/edit form and the delete dialog.
      const syncAgentEnabledToggle = (
        input: HTMLInputElement | undefined,
        label: HTMLElement | undefined,
        disabled = false,
      ): void => {
        syncToggleState(input, label, agentConfig.agentEnabledLabel, agentConfig.agentDisabledLabel, disabled)
      }

      // syncAgentConfigEnabledToggle specializes syncAgentEnabledToggle for the add/edit form fields.
      const syncAgentConfigEnabledToggle = (): void => {
        syncAgentEnabledToggle(elements.agentConfigEnabled, elements.agentConfigEnabledLabel)
      }

      // syncAgentConfigEchoBackReasoningToggle keeps the Echo Back Reasoning toggle's label and CSS
      // state aligned with its checkbox — off by default (see the field's tooltip and
      // AgentApiConfig.echoBackReasoning), since model guidance on this conflicts across providers.
      const syncAgentConfigEchoBackReasoningToggle = (): void => {
        syncToggleState(
          elements.agentConfigEchoBackReasoning,
          elements.agentConfigEchoBackReasoningLabel,
          agentConfig.echoBackReasoningOnLabel,
          agentConfig.echoBackReasoningOffLabel,
        )
      }

      // extraHeaderKeyInputs/extraHeaderValueInputs read the current set of header rows — however
      // many the user has added — rather than assuming just the one the form starts with.
      const extraHeaderKeyInputs = (): HTMLInputElement[] =>
        Array.from(
          elements.agentConfigExtraHeadersRows?.querySelectorAll<HTMLInputElement>(".agent-config-form__header-key") ?? [],
        )
      const extraHeaderValueInputs = (): HTMLInputElement[] =>
        Array.from(
          elements.agentConfigExtraHeadersRows?.querySelectorAll<HTMLInputElement>(".agent-config-form__header-value") ?? [],
        )

      // createExtraHeaderRow builds one key/value input pair, with its own remove control so a row
      // added by mistake can be taken back out without clearing the whole field.
      const createExtraHeaderRow = (api: AgentApiProvider): HTMLElement => {
        const row = document.createElement("div")
        row.className = "agent-config-form__header-row"

        const keyInput = document.createElement("input")
        keyInput.className = "agent-config-form__header-key"
        keyInput.placeholder = agentConfig.extraHeadersKeyPlaceholders[api]
        keyInput.autocomplete = "off"
        keyInput.type = "text"

        const valueInput = document.createElement("input")
        valueInput.className = "agent-config-form__header-value"
        valueInput.placeholder = agentConfig.extraHeadersValuePlaceholders[api]
        valueInput.autocomplete = "off"
        valueInput.type = "text"

        const removeButton = document.createElement("button")
        removeButton.className = "agent-config-form__header-remove"
        removeButton.type = "button"
        // Mirrors what applyConfigAttribute (page-chrome.ts) does for data-config-title elements
        // in static markup — this button doesn't exist yet at that hydration pass, so it sets its
        // own data-tooltip/aria-label here instead, to get the same themed CSS tooltip.
        removeButton.setAttribute("data-tooltip", agentConfig.removeHeaderLabel)
        removeButton.setAttribute("aria-label", agentConfig.removeHeaderLabel)
        removeButton.addEventListener("click", () => { row.remove() })
        removeButton.textContent = "-"

        row.append(keyInput, valueInput, removeButton)
        return row
      }

      // resetExtraHeaderRows drops every row down to the single starting one and clears its inputs,
      // since form.reset() restores input values but does not undo rows added after the form was
      // built. The first row itself is never recreated (only rows beyond it are removed): its "+"
      // button is the one static element bindAgentConfigForm wires a click listener to once, and
      // rebuilding that row from scratch would leave the new node with no listener at all.
      const resetExtraHeaderRows = (): void => {
        if (!elements.agentConfigExtraHeadersRows) {
          return
        }

        const rows = Array.from(
          elements.agentConfigExtraHeadersRows.querySelectorAll<HTMLElement>(".agent-config-form__header-row"),
        )
        rows.slice(1).forEach((row) => row.remove())

        const [firstKeyInput, firstValueInput] = [extraHeaderKeyInputs()[0], extraHeaderValueInputs()[0]]
        if (firstKeyInput) {
          firstKeyInput.value = ""
        }
        if (firstValueInput) {
          firstValueInput.value = ""
        }
      }

      // collectExtraHeaders reduces the key/value rows back into the single "Key: Value" per line
      // string the record stores and parseExtraHeaders (agent/protocol.ts) already knows how to
      // read — the row-based UI is presentation only, not a change to what gets persisted. Rows
      // with a blank key are skipped rather than submitted as broken headers.
      const collectExtraHeaders = (): string => {
        const keys = extraHeaderKeyInputs()
        const values = extraHeaderValueInputs()
        return keys.map((keyInput, index) => [keyInput.value.trim(), values[index]?.value.trim() ?? ""])
          .filter(([key]) => key.length > 0)
          .map(([key, value]) => `${key}: ${value}`)
          .join("\n")
      }

      // syncReasoningEffortOptions hides/disables the <option>s a provider doesn't support (each of
      // the three exposes a different subset — see agentConfig.reasoningEffortOptions) and resets an
      // now-unsupported selection to that provider's own default, rather than leaving a stale value
      // selected under a provider that never offered it. Shared by the add form (called on every
      // provider change) and the manage dialog (called once at open time against the agent's fixed,
      // non-editable provider).
      const syncReasoningEffortOptions = (
        select: HTMLSelectElement | undefined,
        api: AgentApiProvider,
      ): void => {
        if (!select) {
          return
        }

        const allowed = agentConfig.reasoningEffortOptions[api]
        Array.from(select.options).forEach((option) => {
          const isAllowed = allowed.includes(option.value as AgentReasoningEffort)
          option.hidden = !isAllowed
          option.disabled = !isAllowed
        })

        if (!allowed.includes(select.value as AgentReasoningEffort)) {
          select.value = agentConfig.reasoningEffortDefaults[api]
        }
      }

      // syncAgentConfigProviderFields applies the selected provider's copy: the endpoint placeholder,
      // the credential field's label (same input, different real-world name per provider), each
      // extra-header row's placeholders (a live example of what that provider might need — Extra
      // Headers itself stays visible for every provider, unlike the Anthropic-only field it replaced),
      // and the reasoning-effort dropdown's available options.
      const syncAgentConfigProviderFields = (): void => {
        const selectedApi = elements.agentConfigApi?.value
        const api: AgentApiProvider = isAgentApiProvider(selectedApi) ? selectedApi : "ollama"
        syncReasoningEffortOptions(elements.agentConfigReasoningEffort, api)
        // Echo-back-reasoning is locked off whenever reasoning effort is "none" — there is no
        // reasoning content produced at that level, so echoing it back has nothing to send and
        // leaving the toggle clickable would let a user turn on a setting with no effect until they
        // pick a level that actually reasons.
        syncToggleState(
          elements.agentConfigEchoBackReasoning,
          elements.agentConfigEchoBackReasoningLabel,
          agentConfig.echoBackReasoningOnLabel,
          agentConfig.echoBackReasoningOffLabel,
          elements.agentConfigReasoningEffort?.value === "none",
        )

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
        extraHeaderKeyInputs().forEach((input) => {
          input.placeholder = agentConfig.extraHeadersKeyPlaceholders[api]
        })
        extraHeaderValueInputs().forEach((input) => {
          input.placeholder = agentConfig.extraHeadersValuePlaceholders[api]
        })
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
        if (elements.agentConfigEchoBackReasoning) {
          elements.agentConfigEchoBackReasoning.checked = false
        }
        resetExtraHeaderRows()
        syncAgentConfigEnabledToggle()
        syncAgentConfigEchoBackReasoningToggle()
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
        if (isAgentManageDialogOpen()) {
          closeAgentManageDialog()
        }

        pauseIfRunning()
        selectedSeatId = seatId
        if (elements.agentConfigTitle) {
          elements.agentConfigTitle.textContent = agentSeatAddLabel(seatId)
        }
        elements.agentConfigForm.hidden = false
        syncAgentConfigEnabledToggle()
        syncAgentConfigEchoBackReasoningToggle()
        syncAgentConfigProviderFields()
        syncOverlayState()
        elements.agentConfigPlayerName?.focus()
      }

      // closeAgentManageDialog hides the manage dialog and clears the pending seat id.
      const closeAgentManageDialog = (): void => {
        if (!elements.agentManageDialog) {
          return
        }

        elements.agentManageDialog.hidden = true
        manageSeatId = null
        syncOverlayState()
      }

      // syncAgentManageOptions disables the enable/disable toggle when the delete checkbox is
      // checked (it won't matter once the agent is about to be removed — syncToggleState forces it
      // off along with locking it), and disables the echo-back-reasoning toggle the same way whenever
      // either that same delete checkbox is checked or reasoning effort is "none": at that level
      // there is no reasoning content to echo back, so the toggle having no effect until a level that
      // actually reasons is picked (see syncAgentConfigProviderFields's add-form counterpart for the
      // same rule).
      const syncAgentManageOptions = (): void => {
        const shouldDelete = elements.agentDeleteConfirm?.checked ?? false
        const reasoningIsNone = elements.agentManageReasoningEffort?.value === "none"
        syncAgentEnabledToggle(elements.agentManageEnabled, elements.agentManageEnabledLabel, shouldDelete)
        syncToggleState(
          elements.agentManageEchoBackReasoning,
          elements.agentManageEchoBackReasoningLabel,
          agentConfig.echoBackReasoningOnLabel,
          agentConfig.echoBackReasoningOffLabel,
          shouldDelete || reasoningIsNone,
        )
      }

      // openAgentManageDialog pauses an active round and opens the manage overlay for the chosen seat.
      const openAgentManageDialog = (seatId: number): void => {
        const agent = readAgentConfigs().find((config) => config.id === seatId)
        if (!agent || agent.id === currentPlayingAgentId() || !elements.agentManageDialog) {
          return
        }

        // Both overlays share one screen position, so leaving the other open would render them
        // superimposed rather than merely stacked.
        if (isAgentConfigFormOpen()) {
          closeAgentConfigForm()
        }

        pauseIfRunning()
        manageSeatId = seatId
        if (elements.agentManageTitle) {
          elements.agentManageTitle.textContent = agentSeatManageLabel(agent, readState().traversalHistory)
        }
        if (elements.agentDeleteTarget) {
          elements.agentDeleteTarget.textContent = agentConfig.deleteMessageTemplate
        }
        elements.agentManageDialog.hidden = false
        if (elements.agentManageEnabled) {
          elements.agentManageEnabled.checked = agent.enabled
        }
        if (elements.agentManageReasoningEffort) {
          // Unlike the add form, this dialog has no live provider <select> to react to — the
          // provider is fixed to whatever the already-persisted agent record carries, so options are
          // filtered once here at open time rather than on a change event.
          syncReasoningEffortOptions(elements.agentManageReasoningEffort, agent.api)
          elements.agentManageReasoningEffort.value =
            agent.reasoningEffort ?? agentConfig.reasoningEffortDefaults[agent.api]
        }
        if (elements.agentManageEchoBackReasoning) {
          elements.agentManageEchoBackReasoning.checked = agent.echoBackReasoning ?? false
        }
        if (elements.agentDeleteConfirm) {
          elements.agentDeleteConfirm.checked = false
        }
        syncAgentManageOptions()
        syncOverlayState()
        elements.agentManageApply?.focus()
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
            openAgentManageDialog(seatIdToDelete)
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
          !elements.agentConfigExtraHeadersRows ||
          !elements.agentConfigExtraHeadersAdd ||
          !elements.agentConfigReasoningEffort ||
          !elements.agentConfigEchoBackReasoning ||
          !elements.agentConfigEchoBackReasoningLabel ||
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
          const extraHeaders = collectExtraHeaders()
          const selectedReasoningEffort = elements.agentConfigReasoningEffort?.value
          const reasoningEffort: AgentReasoningEffort = isAgentReasoningEffort(selectedReasoningEffort) &&
            agentConfig.reasoningEffortOptions[api].includes(selectedReasoningEffort)
              ? selectedReasoningEffort
              : agentConfig.reasoningEffortDefaults[api]
          const echoBackReasoning = elements.agentConfigEchoBackReasoning?.checked ?? false
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
            reasoningEffort,
            credential,
            extraHeaders,
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
            reasoningEffort,
            ...(credential ? { credential } : {}),
            ...(extraHeaders ? { extraHeaders } : {}),
            ...(echoBackReasoning ? { echoBackReasoning } : {}),
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

        agentConfigReasoningEffortChangeHandler = () => {
          syncToggleState(
            elements.agentConfigEchoBackReasoning,
            elements.agentConfigEchoBackReasoningLabel,
            agentConfig.echoBackReasoningOnLabel,
            agentConfig.echoBackReasoningOffLabel,
            elements.agentConfigReasoningEffort?.value === "none",
          )
        }
        elements.agentConfigReasoningEffort.addEventListener("change", agentConfigReasoningEffortChangeHandler)

        agentConfigExtraHeadersAddHandler = () => {
          const selectedApi = elements.agentConfigApi?.value
          const api: AgentApiProvider = isAgentApiProvider(selectedApi) ? selectedApi : "ollama"
          elements.agentConfigExtraHeadersRows?.append(createExtraHeaderRow(api))
        }
        elements.agentConfigExtraHeadersAdd.addEventListener("click", agentConfigExtraHeadersAddHandler)

        agentConfigEchoBackReasoningChangeHandler = syncAgentConfigEchoBackReasoningToggle
        elements.agentConfigEchoBackReasoning.addEventListener("change", agentConfigEchoBackReasoningChangeHandler)

        agentFormCloseHandler = closeAgentConfigForm
        elements.agentConfigClose.addEventListener("click", agentFormCloseHandler)

        // Only one overlay is ever open at a time (openAgentConfigForm/openAgentManageDialog each
        // close the other), so whichever one closeActiveAgentOverlay finds open is the right one.
        agentFormOuterClickHandler = (event: MouseEvent): void => {
          if (event.target === elements.body) {
            closeActiveAgentOverlay()
          }
        }
        elements.body.addEventListener("click", agentFormOuterClickHandler)
      }

      // bindAgentManageDialog wires the confirm-delete, enable-toggle, echo-back-reasoning, apply, and close handlers.
      const bindAgentManageDialog = (): void => {
        if (
          !elements.agentManageClose ||
          !elements.agentManageEnabled ||
          !elements.agentManageEnabledLabel ||
          !elements.agentManageReasoningEffort ||
          !elements.agentManageEchoBackReasoning ||
          !elements.agentManageEchoBackReasoningLabel ||
          !elements.agentManageApply ||
          !elements.agentDeleteConfirm
        ) {
          return
        }

        agentManageCloseHandler = closeAgentManageDialog
        agentDeleteConfirmChangeHandler = syncAgentManageOptions
        agentManageEnabledChangeHandler = syncAgentManageOptions
        agentManageEchoBackReasoningChangeHandler = syncAgentManageOptions
        agentManageReasoningEffortChangeHandler = syncAgentManageOptions
        agentManageApplyHandler = (): void => {
          // Delete wins over enable/disable/echo-back-reasoning edits because the seat becomes empty.
          if (!manageSeatId) {
            closeAgentManageDialog()
            return
          }

          const enabled = elements.agentManageEnabled?.checked ?? false
          const echoBackReasoning = elements.agentManageEchoBackReasoning?.checked ?? false
          const shouldDelete = elements.agentDeleteConfirm?.checked ?? false
          const nextAgents = shouldDelete
            ? readAgentConfigs().filter((agent) => agent.id !== manageSeatId)
            : readAgentConfigs().map((agent) => {
                if (agent.id !== manageSeatId) {
                  return agent
                }

                const selectedReasoningEffort = elements.agentManageReasoningEffort?.value
                const reasoningEffort: AgentReasoningEffort =
                  isAgentReasoningEffort(selectedReasoningEffort) &&
                  agentConfig.reasoningEffortOptions[agent.api].includes(selectedReasoningEffort)
                    ? selectedReasoningEffort
                    : agentConfig.reasoningEffortDefaults[agent.api]

                // Omit the key entirely rather than storing false, matching how the add form only
                // ever persists this field when it is true (see agentFormSubmitHandler above).
                // reasoningEffort is unconditionally set instead — unlike echo-back, there is always
                // a meaningful, provider-valid level in effect, never a meaningful "absent".
                const nextAgent: AgentApiConfig = { ...agent, enabled, reasoningEffort }
                delete nextAgent.echoBackReasoning
                if (echoBackReasoning) {
                  nextAgent.echoBackReasoning = echoBackReasoning
                }
                return nextAgent
              })
          savePersistedAgentApiConfigs(nextAgents)
          closeAgentManageDialog()
          renderAgentRoster()
          syncCurrentPoller()
        }

        elements.agentManageClose.addEventListener("click", agentManageCloseHandler)
        elements.agentDeleteConfirm.addEventListener("change", agentDeleteConfirmChangeHandler)
        elements.agentManageEnabled.addEventListener("change", agentManageEnabledChangeHandler)
        elements.agentManageEchoBackReasoning.addEventListener("change", agentManageEchoBackReasoningChangeHandler)
        elements.agentManageReasoningEffort.addEventListener("change", agentManageReasoningEffortChangeHandler)
        elements.agentManageApply.addEventListener("click", agentManageApplyHandler)
      }

      // closeActiveAgentOverlay dismisses whichever overlay is open and returns true so callers can skip further handling.
      const closeActiveAgentOverlay = (): boolean => {
        if (isAgentConfigFormOpen()) {
          closeAgentConfigForm()
          return true
        }

        if (isAgentManageDialogOpen()) {
          closeAgentManageDialog()
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
      bindAgentManageDialog()

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
    // readCurrentPlayer exposes the currently playing agent's traversal-speed status label for the
    // running-status line, mirroring the same "no active agent while paused/idle" rule
    // currentPlayingAgentId enforces internally.
    readCurrentPlayer(): string | null {
      if (!boundReadState || !isRunningStatus(boundReadState().status) || activeAgentId === null) {
        return null
      }

      const agent = readAgentConfigs().find((config) => config.id === activeAgentId)
      if (!agent) {
        return null
      }

      const { playerUniqueCellsVisited, decayUnitsCharged } = getBatchEfficiencyMetrics(
        boundReadState().traversalHistory,
        agent,
      )
      return formatPlayerStatusLabel({
        playerName: agent.playerName,
        uniqueCellsVisited: playerUniqueCellsVisited,
        decayUnitsCharged,
      })
    },
  }
}
