import { CONFIG } from "../config"
import { mergeMazeActionResult } from "../control"
import { requestPredictionWithAbort } from "../agent/request"
import type { EncodedMazeForLevelStart } from "../agent/request"
import { agentRequestIntervalMs } from "../agent/config"
import { calculateTraversalSpeedUnits, getBatchEfficiencyMetrics } from "../agent/efficiency"
import { snapshotAgentState } from "../agent/state-snapshot"
import type { AgentStateSnapshot } from "../agent/state-snapshot"
import { encodeMazeForLog, logTapooDiagnostic } from "../logs"
import { recordAgentTurnStats } from "../storage"
import { isLostStatus, isRunningStatus, isWonStatus } from "../status"
import { cloneMazeDimensions } from "../traversal"
import type {
  AgentApiConfig,
  AgentPredictionFailure,
  AgentPredictionRequest,
  AgentPredictionResult,
  AgentPlayerStatus,
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
  __commitAgentTurn: (chargedMovesCount?: number, traversalSpeedUnits?: number) => void
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
  __playerStatus: AgentPlayerStatus
  __state: State
  __actionResult: MazeActionResult
}

function encodeMazeForLevelStart(state: State): EncodedMazeForLevelStart | null {
  if (!state.maze || !state.mazeDimensions) {
    return null
  }

  return {
    ...encodeMazeForLog(state.maze),
    dimensions: cloneMazeDimensions(state.mazeDimensions),
  }
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

  // agentTurnCountMismatch catches configs that claim to belong to this exact round (matching
  // gameLevel + cumulativeRoundCount — see State.turnCount's comment for why that pair is a safe
  // fingerprint) but disagree with the round's completed turn count; old configs from other rounds
  // are allowed to reset lazily instead of tripping this. A mismatch here means the agent's stored
  // view and the live round have genuinely diverged for the exact round they both claim to be in —
  // not a rare transient blip — so it cannot be reconciled by patching a counter: the round's history
  // up to this point is no longer trustworthy input for the model. Deliberately takes live State, not
  // the turn's stateSnapshot: this check runs before a turn's request is even attempted, so it isn't
  // "building/sending the request" — the one thing stateSnapshot exists for — and it must see the
  // round exactly as it is right now, not a view captured for a different purpose.
  const agentTurnCountMismatch = (agent: AgentApiConfig, currentState: State): boolean =>
    agent.gameLevel === currentState.level &&
    agent.cumulativeRoundCount === currentState.cumulativeRoundCount &&
    (agent.levelTurnCount ?? 0) !== currentState.turnCount

  // resetAfterAgentStateMismatch is deliberately a full restart, not a lighter correction: once the
  // fingerprint check above fails, there is no way to know which side actually diverged or why, so
  // patching one counter to match the other risks quietly feeding the model turn context assembled
  // from a different game output than the one it's reasoning about. A restart is the only response
  // that guarantees that never happens.
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

  // shouldPollAgent only keeps the replay loop alive while the live round is actively running. This
  // is deliberately a live read, not the turn's frozen stateSnapshot: it's consulted at several
  // points across a turn's async lifetime (before starting, after a connection-error retry's real
  // backoff delay, after the turn's own work finishes) and by the poller's own public
  // __shouldPollAgent, and must see a status change (e.g. the round ending) the instant it happens,
  // not whatever the status was back when the current turn's snapshot was taken.
  const shouldPollAgent = (): boolean => attached && isRunningStatus(__readState().status)

  const defaultAgentRequestIntervalMs = (): number =>
    timing.defaultAgentApiRequestIntervalSeconds * 1_000

  // notifyRoundCompletion invokes final-state callbacks only after score decay and replay metadata
  // have been committed, so diagnostics receive the same state the UI is about to show.
  const notifyRoundCompletion = (
    agent: AgentApiConfig,
    playerStatus: AgentPlayerStatus,
    actionResult: MazeActionResult,
  ): void => {
    const currentState = __readState()

    if (isWonStatus(currentState.status) || isLostStatus(currentState.status)) {
      __onRoundOutcome({
        __agent: agent,
        __playerStatus: playerStatus,
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

  // playerStatusFor scopes traversal speed to the agent that just acted, never the whole team.
  const playerStatusFor = (agent: AgentApiConfig, currentState: State): AgentPlayerStatus => {
    const { playerUniqueCellsVisited, decayUnitsCharged } = getBatchEfficiencyMetrics(
      currentState.traversalHistory,
      agent,
    )
    return {
      playerName: agent.playerName,
      uniqueCellsVisited: playerUniqueCellsVisited,
      decayUnitsCharged,
    }
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
  // same scoring consequence because neither produced a usable prediction. Agent stats are recorded
  // with the next turn count before committing so a terminal turn's summary can use that post-turn
  // agent status immediately.
  const recordRejectedAgentResponse = (
    agent: AgentApiConfig,
    lastMoveStatus: RejectedAgentResponseReason,
  ): void => {
    const chargedMovesCount = agentMalformedPenaltyDecayUnits
    const preCommitState = __readState()
    const updatedAgent = recordAgentTurnStats(
      agent,
      preCommitState.level,
      preCommitState.cumulativeRoundCount,
      chargedMovesCount,
      preCommitState.turnCount + 1,
    )
    const playerStatus = playerStatusFor(updatedAgent, preCommitState)
    __commitAgentTurn(
      chargedMovesCount,
      calculateTraversalSpeedUnits(playerStatus.uniqueCellsVisited, playerStatus.decayUnitsCharged),
    )

    const nextResult = mergeMazeActionResult(activeActionResult(), {
      lastPlayerName: agent.playerName,
      lastMoveStatus,
      chargedMovesCount,
      ...noReplayThisTurn,
    })
    lastActionResult = nextResult

    __onActionResult(nextResult)
    notifyRoundCompletion(updatedAgent, playerStatus, nextResult)
  }

  // applyPredictionFailureConsequence dispatches a failure's game effect. caller-abort means
  // polling already stopped, so it gets none. Kept separate from recordPredictionFailure below
  // because the connection-error retry needs to apply this consequence on its own, once the retry
  // is abandoned — by which point the diagnostic was already logged and must not be logged again.
  // No stateSnapshot here: neither branch reads it (recordRejectedAgentResponse reads live state
  // itself, after committing — see its own comment for why).
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

  // scheduleNextAgentTurn starts/resumes immediately, then delays internal loop continuations. No
  // stateSnapshot here — a new turn's snapshot doesn't exist until requestNextAgentTurn takes one
  // fresh, at the start of that specific turn; this only ever decides whether/when to begin one.
  const scheduleNextAgentTurn = (
    delayMs = defaultAgentRequestIntervalMs(),
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
  // as the currently active request so stopPolling can still abort it mid-flight. Takes the
  // snapshot rather than building it itself — requestNextAgentTurn takes it exactly once per turn,
  // before the first of possibly several attempts (including a connection-error retry, separated by
  // a real backoff delay), and threads it through every attempt. Rebuilding it here could hand a
  // later attempt a different view than the one the turn started with, even though nothing about
  // the outcome of a failed attempt should have changed it.
  const requestAgentPrediction = (
    agent: AgentApiConfig,
    stateSnapshot: AgentStateSnapshot,
    encodedMazeForLevelStart: EncodedMazeForLevelStart | null,
  ): Promise<AgentPredictionResult> => {
    // The request service owns HTTP, timeout, tool calls, and classified failure handling.
    const predictionRequest = requestPredictionWithAbort({
      agent,
      lastActionResult: activeActionResult(),
      stateSnapshot,
      encodedMazeForLevelStart,
      timeoutMs: timing.agentApiResponseTimeoutMs,
      requestIntervalMs: agentRequestIntervalMs(agent),
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
    stateSnapshot: AgentStateSnapshot,
    encodedMazeForLevelStart: EncodedMazeForLevelStart | null,
  ): Promise<AgentPredictionResult> => {
    const firstAttempt = await requestAgentPrediction(agent, stateSnapshot, encodedMazeForLevelStart)
    if (firstAttempt.ok) {
      return firstAttempt
    }

    // Logged now either way; the consequence is deferred only when a retry is actually about to
    // happen, so it isn't applied ahead of an outcome that hasn't occurred yet. shouldPollAgent is
    // deliberately called live (no stateSnapshot) here — this is a "is it still valid to keep
    // going right now" gate, not part of the turn's frozen data, and must see a real-time status
    // change (e.g. the round ending while this backoff sleeps) immediately.
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

    // Reuses the same stateSnapshot the first attempt used, not a fresh read — a connection-error
    // means no HTTP response ever arrived, so nothing about the turn's own outcome could have
    // changed state in the meantime; the retry should still see exactly what the turn started with.
    const retryAttempt = await requestAgentPrediction(agent, stateSnapshot, null)
    if (retryAttempt.ok) {
      logTapooDiagnostic(runtime.controlModes.agentApi, "warn", "Recovered after a connection-error retry.")
      return retryAttempt
    }

    recordPredictionFailure(agent, retryAttempt)
    return retryAttempt
  }

  // requestNextAgentTurn asks the next enabled agent for moves, then replays only successful
  // predictions here. This function itself is the real once-per-turn boundary — unlike
  // handleAgentTurnLoop, which runs once for this poller's whole lifetime, this runs fresh for
  // every turn (it reschedules itself via scheduleNextAgentTurn in the finally block below), so it's
  // the right place to take the turn's stateSnapshot, not a level any higher.
  const requestNextAgentTurn = async (
    nextDelayMs = defaultAgentRequestIntervalMs(),
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
      nextDelayMs = agentRequestIntervalMs(selectedAgent)

      // The turn's one and only live read, taken fresh on every call to this function (i.e. once
      // per turn). The mismatch gate below reads it directly, live — see agentTurnCountMismatch's
      // comment for why. Only once that gate passes does requestAgentPredictionWithRetry get the
      // frozen stateSnapshot derived from this same read, scoped to exactly one thing: building
      // and sending this turn's HTTP request(s), first attempt and any connection-error retry
      // alike. Every outcome-handling path afterward reads live state fresh instead — a rejected
      // response (recordRejectedAgentResponse) re-reads it after committing, and moves that
      // actually succeed do the same (see __commitAgentTurn below and notifyRoundCompletion) — by
      // design, to track whatever just changed rather than what this turn started with.
      const currentState = __readState()
      if (agentTurnCountMismatch(selectedAgent, currentState)) {
        resetAfterAgentStateMismatch(selectedAgent, currentState)
        return
      }

      __onActiveAgentChange?.(selectedAgent)

      const stateSnapshot = snapshotAgentState(currentState)
      const encodedMazeForLevelStart = stateSnapshot.turnCount === 0 ? encodeMazeForLevelStart(currentState) : null
      const prediction = await requestAgentPredictionWithRetry(
        selectedAgent,
        stateSnapshot,
        encodedMazeForLevelStart,
      )
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
      // Three distinct outcomes, deliberately kept in this order (cheapest first):
      //   - Fully valid (appliedMoveCount > 0, no invalid move): agentBaseDecayUnits alone — 1.
      //   - Partial success (appliedMoveCount > 0, then an invalid move): base +
      //     agentPartialInvalidPenaltyDecayUnits — strictly more than a clean turn (so tacking on
      //     an unconfident guess is never free) — 1 + 1 = 2.
      //   - Zero progress (the very first move was already invalid): agentZeroProgressPenaltyDecayUnits
      //     flat, no base — 2. Deliberately tied with partial success, not cheaper: standing in
      //     place costs exactly as much as a wrong guess after some real progress, so there's no
      //     incentive to play it safe with a single speculative move instead of a longer one.
      //     recordMalformedAgentResponse's agentMalformedPenaltyDecayUnits stays the costliest
      //     outcome of all at 3, since a protocol violation is worse than any gameplay mistake.
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

      const preCommitState = __readState()
      const updatedAgent = recordAgentTurnStats(
        selectedAgent,
        preCommitState.level,
        preCommitState.cumulativeRoundCount,
        chargedMovesCount,
        preCommitState.turnCount + 1,
      )
      const playerStatus = playerStatusFor(updatedAgent, preCommitState)
      __commitAgentTurn(
        chargedMovesCount,
        calculateTraversalSpeedUnits(playerStatus.uniqueCellsVisited, playerStatus.decayUnitsCharged),
      )

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
      notifyRoundCompletion(updatedAgent, playerStatus, nextResult)
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
