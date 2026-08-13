import { CONFIG } from "../config"
import { mergeMazeActionResult } from "../control"
import { requestPredictionWithAbort } from "../agent/request"
import { logTapooDiagnostic } from "../logs"
import { recordAgentTurnStats } from "../storage"
import { isLostStatus, isRunningStatus, isWonStatus } from "../status"
import type {
  AgentApiConfig,
  AgentPredictionFailure,
  AgentPredictionRequest,
  AgentPredictionResult,
  MazeAction,
  MazeActionDispatch,
  MazeActionResult,
  PredictionOutcomeStatus,
  State,
} from "../types"

const { runtime, scoring, timing } = CONFIG
const {
  agentBaseDecayUnits,
  agentPartialInvalidPenaltyDecayUnits,
  agentZeroProgressPenaltyDecayUnits,
  agentMalformedPenaltyDecayUnits,
} = scoring

type RejectedAgentResponseReason = "malformed-response" | "token-limit-exhaustion"

// isRejectedAgentResponseReason groups failures that keep their distinct status but share the
// fixed unusable-response penalty and warning-level diagnostics.
function isRejectedAgentResponseReason(
  reason: AgentPredictionFailure["reason"],
): reason is RejectedAgentResponseReason {
  return reason === "malformed-response" || reason === "token-limit-exhaustion"
}

// sleep resolves after delayMs — used only for the connection-error retry backoff below.
function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs))
}

// mergeReplayResult reapplies replay metadata without duplicating live game state.
function mergeReplayResult(
  actionResult: MazeActionResult | null,
  overrides: Partial<MazeActionResult>,
): MazeActionResult {
  return mergeMazeActionResult(actionResult, overrides)
}

export type AgentMovePoller = {
  __stopPolling: () => void
  __shouldPollAgent: () => boolean
  __scheduleNextAgentTurn: (delayMs?: number) => void
  __setAttached: (attached: boolean) => void
  __setLastActionResult: (actionResult: MazeActionResult | null) => void
}

type HandleAgentTurnLoopOptions = {
  __elements: { body: HTMLElement }
  __commitAgentTurn: (chargedMovesCount: number) => void
  __dispatch: MazeActionDispatch
  __dispatchAgentAction: (
    action: MazeAction,
    dispatch: MazeActionDispatch,
    agent: AgentApiConfig,
  ) => MazeActionResult
  __disableAgentAfterNetworkError: (agent: AgentApiConfig) => void
  __onActiveAgentChange?: (agent: AgentApiConfig | null) => void
  __onRoundOutcome: (event: AgentRoundState) => void
  __readAgentConfigs: () => AgentApiConfig[]
  __onActionResult: (actionResult: MazeActionResult) => void
  __readState: () => State
}

export type AgentRoundState = {
  __agent: AgentApiConfig
  __state: State
  __actionResult: MazeActionResult
}

// handleAgentTurnLoop owns the HTTP polling cycle used by the agent-api control mode.
export function handleAgentTurnLoop({
  __elements,
  __commitAgentTurn,
  __dispatch,
  __dispatchAgentAction,
  __disableAgentAfterNetworkError,
  __onActiveAgentChange,
  __onRoundOutcome,
  __readAgentConfigs,
  __onActionResult,
  __readState,
}: HandleAgentTurnLoopOptions): AgentMovePoller {
  let attached = false
  let scheduledTurn: number | null = null
  let activeRequest: AgentPredictionRequest | null = null
  let lastActionResult: MazeActionResult | null = null
  let agentCursor = 0

  // activeActionResult returns only the most recent replay metadata.
  const activeActionResult = (): MazeActionResult | null => lastActionResult

  // hasEnabledAgents checks whether polling can produce work before waiting for a timeout.
  const hasEnabledAgents = (): boolean => __readAgentConfigs().some((agent) => agent.enabled)

  // nextAgent rotates through all enabled agents configured for the shared maze.
  const nextAgent = (): AgentApiConfig | null => {
    const enabledAgents = __readAgentConfigs().filter((agent) => agent.enabled)
    if (enabledAgents.length === 0) {
      return null
    }

    const selectedAgent = enabledAgents[agentCursor % enabledAgents.length]
    agentCursor += 1
    return selectedAgent
  }

  // awaitAgent immediately moves the game into its no-agent state without spending score.
  const awaitAgent = (): boolean => {
    if (hasEnabledAgents()) {
      return false
    }
  
    __onActiveAgentChange?.(null)
    __dispatch(
      { type: "await-agent" },
      { playerName: activeActionResult()?.lastPlayerName ?? runtime.interactivePlayerName },
    )
    return true
  }

  // agentTurnCountMismatch catches configs that claim to belong to this exact round but disagree
  // with the round's completed turn count; old configs from other rounds are allowed to reset lazily.
  const agentTurnCountMismatch = (agent: AgentApiConfig, currentState: State): boolean =>
    agent.gameLevel === currentState.level &&
    agent.cumulativeRoundCount === currentState.cumulativeRoundCount &&
    (agent.levelTurnCount ?? 0) !== currentState.turnCount

  // resetAfterAgentStateMismatch protects the model from receiving contradictory turn context.
  const resetAfterAgentStateMismatch = (agent: AgentApiConfig, currentState: State): void => {
    logTapooDiagnostic(runtime.controlModes.agentApi, "error", "Agent turn count mismatch; resetting game state.", {
      agentId: agent.id,
      playerName: agent.playerName,
      stateTurnCount: currentState.turnCount,
      agentLevelTurnCount: agent.levelTurnCount ?? 0,
      level: currentState.level,
      cumulativeRoundCount: currentState.cumulativeRoundCount,
    })
    __onActiveAgentChange?.(null)
    __dispatch({ type: "restart" }, { playerName: runtime.interactivePlayerName })
  }

  // clearScheduledTurn stops any queued request cycle.
  const clearScheduledTurn = (): void => {
    if (scheduledTurn === null) {
      return
    }

    window.clearTimeout(scheduledTurn)
    scheduledTurn = null
  }

  // stopPolling clears both queued and active work so callers can reset the loop in one step.
  const stopPolling = (): void => {
    clearScheduledTurn()
    activeRequest?.abort()
    activeRequest = null
  }

  // shouldPollAgent only keeps the replay loop alive while the live round is actively running.
  const shouldPollAgent = (): boolean => attached && isRunningStatus(__readState().status)

  // notifyRoundCompletion invokes final-state callbacks only after score decay and replay metadata
  // have been committed, so diagnostics receive the same state the UI is about to show.
  const notifyRoundCompletion = (
    agent: AgentApiConfig,
    actionResult: MazeActionResult,
  ): void => {
    const currentState = __readState()

    if (isWonStatus(currentState.status) || isLostStatus(currentState.status)) {
      __onRoundOutcome({
        __agent: agent,
        __state: currentState,
        __actionResult: actionResult,
      })
    }
  }

  // noReplayThisTurn clears the previous turn's replay details rather than letting mergeMazeActionResult
  // carry them forward. Neither malformed-response nor network-error replays anything, so
  // lastSubmittedMoves/lastAppliedMoveIndex/lastReplayStartIndex/visitedBefore must say so — leaving
  // them at whatever a prior successful turn set contradicts the "no moves were replayed" this tool
  // already documents, and reads as this failure's own data when it is really leftover from turns ago.
  const noReplayThisTurn = {
    lastSubmittedMoves: [],
    lastAppliedMoveIndex: null,
    lastReplayStartIndex: undefined,
    visitedBefore: undefined,
    predictionStatus: "empty-prediction" as const,
  }

  // recordAgentNetworkError disables failed agents and records the no-score-decay network state.
  const recordAgentNetworkError = (agent: AgentApiConfig | null): void => {
    if (!agent) {
      return
    }

    __onActiveAgentChange?.(null)
    __disableAgentAfterNetworkError(agent)
    const nextResult = mergeMazeActionResult(activeActionResult(), {
      lastPlayerName: agent.playerName,
      lastMoveStatus: "network-error",
      chargedMovesCount: 0,
      ...noReplayThisTurn,
    })

    lastActionResult = nextResult
    __onActionResult(nextResult)
    awaitAgent()
  }

  // recordRejectedAgentResponse spends the fixed mistake decay without replaying any move. The
  // status keeps malformed output distinct from a token-limit exhaustion, while both retain the
  // same scoring consequence because neither produced a usable prediction.
  const recordRejectedAgentResponse = (
    agent: AgentApiConfig,
    lastMoveStatus: RejectedAgentResponseReason,
  ): void => {
    const chargedMovesCount = agentMalformedPenaltyDecayUnits
    __commitAgentTurn(chargedMovesCount)
    const {level,cumulativeRoundCount, turnCount } = __readState()
    recordAgentTurnStats(agent, level, cumulativeRoundCount, chargedMovesCount, turnCount)

    const nextResult = mergeMazeActionResult(activeActionResult(), {
      lastPlayerName: agent.playerName,
      lastMoveStatus,
      chargedMovesCount,
      ...noReplayThisTurn,
    })
    lastActionResult = nextResult

    __onActionResult(nextResult)
    notifyRoundCompletion(agent, nextResult)
  }

  // applyPredictionFailureConsequence dispatches a failure's game effect. caller-abort means
  // polling already stopped, so it gets none. Kept separate from recordPredictionFailure below
  // because the connection-error retry needs to apply this consequence on its own, once the retry
  // is abandoned — by which point the diagnostic was already logged and must not be logged again.
  const applyPredictionFailureConsequence = (
    agent: AgentApiConfig,
    failure: AgentPredictionFailure,
  ): void => {
    if (failure.reason === "caller-abort") {
      return
    }

    if (isRejectedAgentResponseReason(failure.reason)) {
      recordRejectedAgentResponse(agent, failure.reason)
      return
    }

    recordAgentNetworkError(agent)
  }

  // recordPredictionFailure is the single place a failure's diagnostic gets logged. It also applies
  // the matching game consequence immediately, unless deferConsequence is set — used by the
  // connection-error retry to log the failure up front while the consequence waits on the retry's
  // outcome; that consequence is then applied later via applyPredictionFailureConsequence directly.
  const recordPredictionFailure = (
    agent: AgentApiConfig,
    failure: AgentPredictionFailure,
    deferConsequence = false,
  ): void => {
    if (failure.diagnostic) {
      // network-error and connection-error both mean the provider/infrastructure actually broke —
      // a genuine error — just split apart by retry eligibility (see AgentPredictionFailureReason's
      // comment). malformed-response means the model returned something Tapoo couldn't use (bad
      // JSON, a hallucinated tool call); that's an anticipated, handled deviation charged its own
      // decay penalty below, not a system failure, so it stays a warning.
      logTapooDiagnostic(
        runtime.controlModes.agentApi,
        isRejectedAgentResponseReason(failure.reason) ? "warn" : "error",
        failure.diagnostic.message,
        failure.diagnostic.details,
      )
    }

    if (!deferConsequence) {
      applyPredictionFailureConsequence(agent, failure)
    }
  }

  // scheduleNextAgentTurn starts/resumes immediately, then delays internal loop continuations.
  const scheduleNextAgentTurn = (
    delayMs = timing.agentApiTurnPollIntervalMs,
    isDelay = false,
  ): void => {
    clearScheduledTurn()
    if (!shouldPollAgent() || activeRequest) {
      return
    }

    if (awaitAgent()) {
      return
    }

    if (!isDelay) {
      void requestNextAgentTurn(delayMs)
      return
    }

    scheduledTurn = window.setTimeout(() => {
      scheduledTurn = null
      void requestNextAgentTurn(delayMs)
    }, delayMs)
  }

  // requestAgentPrediction builds and awaits one provider request for the given agent, tracking it
  // as the currently active request so stopPolling can still abort it mid-flight.
  const requestAgentPrediction = (agent: AgentApiConfig): Promise<AgentPredictionResult> => {
    // The request service owns HTTP, timeout, tool calls, and classified failure handling.
    const predictionRequest = requestPredictionWithAbort({
      agent,
      lastActionResult: activeActionResult(),
      state: __readState(),
      timeoutMs: timing.agentApiResponseTimeoutMs,
      requestIntervalMs: timing.agentApiRequestPollIntervalMs,
    })
    activeRequest = predictionRequest
    return predictionRequest.promise
  }

  // requestAgentPredictionWithRetry gives a connection-error exactly one retry, after a short
  // backoff, before the caller treats it as final. connection-error is deliberately narrow (see
  // AgentPredictionFailureReason's comment): it means the connection itself failed — a reset, a
  // dropped socket, a DNS hiccup, a timeout abort — before any HTTP response arrived at all, the
  // one shape a retry is actually likely to fix (see the "TypeError: Failed to fetch" investigation
  // this exists for). Nothing else is retried here: a plain network-error (a non-OK HTTP status, a
  // missing message body, a Tapoo-side tool-handler bug, an unrecognized provider) means the
  // provider already answered or the problem is on our own side, neither of which a blind retry
  // fixes — a non-OK status in particular (e.g. a 429) can get worse from an immediate retry.
  // malformed-response and caller-abort are never retried either: a malformed response is the
  // model's own mistake, and a caller-abort means polling already stopped.
  const requestAgentPredictionWithRetry = async (
    agent: AgentApiConfig,
  ): Promise<AgentPredictionResult> => {
    const firstAttempt = await requestAgentPrediction(agent)
    if (firstAttempt.ok) {
      return firstAttempt
    }

    // Logged now either way; the consequence is deferred only when a retry is actually about to
    // happen, so it isn't applied ahead of an outcome that hasn't occurred yet.
    const willRetry = firstAttempt.reason === "connection-error" && shouldPollAgent()
    recordPredictionFailure(agent, firstAttempt, willRetry)
    if (!willRetry) {
      return firstAttempt
    }

    await sleep(timing.agentApiConnectionErrorRetryDelayMs)
    if (!shouldPollAgent()) {
      applyPredictionFailureConsequence(agent, firstAttempt)
      return firstAttempt
    }

    const retryAttempt = await requestAgentPrediction(agent)
    if (retryAttempt.ok) {
      logTapooDiagnostic(runtime.controlModes.agentApi, "warn", "Recovered after a connection-error retry.")
      return retryAttempt
    }

    recordPredictionFailure(agent, retryAttempt)
    return retryAttempt
  }

  // requestNextAgentTurn asks the next enabled agent for moves, then replays only successful predictions here.
  const requestNextAgentTurn = async (
    nextDelayMs = timing.agentApiTurnPollIntervalMs,
  ): Promise<void> => {
    if (!shouldPollAgent()) {
      return
    }

    try {
      if (awaitAgent()) {
        return
      }

      // Agent selection stays in this loop so the roster can update before the request starts.
      const selectedAgent = nextAgent()
      if (!selectedAgent) {
        awaitAgent()
        return
      }

      const currentState = __readState()
      if (agentTurnCountMismatch(selectedAgent, currentState)) {
        resetAfterAgentStateMismatch(selectedAgent, currentState)
        return
      }

      __onActiveAgentChange?.(selectedAgent)

      const prediction = await requestAgentPredictionWithRetry(selectedAgent)
      // Failure logging and game consequences are handled inside requestAgentPredictionWithRetry.
      if (prediction.ok === false) {
        return
      }

      const { moves: submittedMoves } = prediction
      let lastReplayResult: MazeActionResult | null = null
      let appliedMoveCount = 0
      let allAppliedMovesRevisitedCells = true
      let lastAppliedMoveVisitedBefore: boolean | undefined
      let invalidMovesPenalty = 0

      for (const move of submittedMoves) {
        const replayState = __dispatchAgentAction({ type: move }, __dispatch, selectedAgent)
        lastReplayResult = replayState
        const status = replayState.lastMoveStatus

        if (status === "reached-target") {
          appliedMoveCount += 1
          // Folding this into allAppliedMovesRevisitedCells is safe even though it could in
          // principle mark a winning turn as repeat-cell-visits: isWonStatus ends the round on the
          // very first arrival at the destination cell (see executeActionWithFeedback), so
          // visitedBefore is guaranteed false here — no cell can already be in traversalHistory as
          // the destination before someone reaches it and wins.
          allAppliedMovesRevisitedCells &&= replayState.visitedBefore === true
          lastAppliedMoveVisitedBefore = replayState.visitedBefore
          // Reaching the destination ends the turn; later submitted moves no longer matter.
          break
        }

        if (status === "applied") {
          appliedMoveCount += 1
          allAppliedMovesRevisitedCells &&= replayState.visitedBefore === true
          lastAppliedMoveVisitedBefore = replayState.visitedBefore
          continue
        }

        // Invalid moves stop replay; moves queued behind it were never executed and aren't charged.
        invalidMovesPenalty = agentPartialInvalidPenaltyDecayUnits
        break
      }

      // Unreachable in practice — parseAgentPrediction guarantees a non-empty submittedMoves, so
      // the loop above always runs at least once and sets lastReplayResult. This check exists
      // only to satisfy TypeScript's control-flow analysis on the nullable `let` declaration.
      if (!lastReplayResult) {
        return
      }

      // A turn with any valid moves costs a flat decay charge regardless of how many moves it
      // applied, and a wrong guess adds a flat mistake penalty on top regardless of how many
      // speculative moves were queued behind it. Together these make single-move-per-turn play the
      // costliest way to solve the maze — batching more moves per turn is strictly cheaper per
      // move, so agents are pushed toward longer, more carefully reasoned predictions rather than
      // conservative single-stepping.
      //
      // Three distinct outcomes, deliberately kept in this order (cheapest to costliest):
      //   - Fully valid (appliedMoveCount > 0, no invalid move): agentBaseDecayUnits alone.
      //   - Partial success (appliedMoveCount > 0, then an invalid move): base +
      //     agentPartialInvalidPenaltyDecayUnits — strictly more than a clean turn (so tacking on
      //     an unconfident guess is never free), but strictly less than making zero progress.
      //   - Zero progress (the very first move was already invalid): agentZeroProgressPenaltyDecayUnits
      //     flat, no base — standing in place is exactly as costly as a partial attempt, never
      //     cheaper. recordMalformedAgentResponse's agentMalformedPenaltyDecayUnits stays the
      //     costliest outcome of all, since a protocol violation is worse than any gameplay mistake.
      const chargedMovesCount = appliedMoveCount > 0
        ? (agentBaseDecayUnits + invalidMovesPenalty)
        : agentZeroProgressPenaltyDecayUnits

      // predictionStatus summarizes the whole submitted batch as one story. Repeat-cell-visits takes
      // precedence over the applied variants when every move that executed revisited a known cell,
      // while lastMoveStatus below keeps the final move's granular outcome unchanged.
      const predictionStatus: PredictionOutcomeStatus =
        appliedMoveCount > 0
          ? (allAppliedMovesRevisitedCells
              ? "repeat-cell-visits"
              : (invalidMovesPenalty > 0 ? "partially-applied" : "all-applied"))
          : "invalid-prediction"

      __commitAgentTurn(chargedMovesCount)
      const {level, cumulativeRoundCount, turnCount } = __readState()
      recordAgentTurnStats(selectedAgent, level, cumulativeRoundCount, chargedMovesCount, turnCount)

      const nextResult = mergeReplayResult(lastReplayResult, {
        lastPlayerName: selectedAgent.playerName,
        lastMoveStatus: lastReplayResult.lastMoveStatus,
        predictionStatus,
        visitedBefore: lastAppliedMoveVisitedBefore,
        lastSubmittedMoves: submittedMoves.map((move, index) => `${index}:${move}`),
        lastAppliedMoveIndex: appliedMoveCount > 0 ? appliedMoveCount - 1 : null,
        chargedMovesCount,
      })

      lastActionResult = nextResult
      __onActionResult(nextResult)
      notifyRoundCompletion(selectedAgent, nextResult)
    } finally {
      activeRequest = null
      if (shouldPollAgent()) {
        // Completed agent turns schedule the next poll after the configured delay to pace API traffic.
        scheduleNextAgentTurn(nextDelayMs, true)
      } else {
        // The round ended (won/lost) or polling was detached mid-turn — release the active seat so
        // its UI stops showing an agent as still playing.
        __onActiveAgentChange?.(null)
      }
    }
  }

  return {
    // External callers can tune delay duration for tests, but cannot force delayed mode.
    __scheduleNextAgentTurn(delayMs) {
      scheduleNextAgentTurn(delayMs)
    },
    __setAttached(nextAttached) {
      attached = nextAttached
      __elements.body.dataset.agentControl = nextAttached ? "active" : "idle"
    },
    __setLastActionResult(actionResult) {
      lastActionResult = actionResult
    },
    __stopPolling: stopPolling,
    __shouldPollAgent: shouldPollAgent,
  }
}
