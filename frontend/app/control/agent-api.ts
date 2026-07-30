import { CONFIG } from "../config"
import { mergeMazeActionResult } from "../control"
import { requestPredictionWithAbort } from "../agent/request"
import { logTapooDiagnostic } from "../logs"
import { recordAgentTurnStats } from "../storage"
import { isLostStatus, isRunningStatus, isWonStatus } from "../status"
import type {
  AgentApiConfig,
  MazeAction,
  MazeActionDispatch,
  MazeActionResult,
  State,
} from "../types"
import type { AgentPredictionFailure, AgentPredictionRequest } from "../agent/request"

const { runtime, scoring, timing } = CONFIG
const { agentBaseDecayUnits, agentPenaltyDecayUnits } = scoring

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
    })

    lastActionResult = nextResult
    __onActionResult(nextResult)
    awaitAgent()
  }

  // recordMalformedAgentResponse spends the fixed mistake decay without replaying any move.
  const recordMalformedAgentResponse = (agent: AgentApiConfig): void => {
    const chargedMovesCount = agentPenaltyDecayUnits
    __commitAgentTurn(chargedMovesCount)
    recordAgentTurnStats(agent, __readState().level, __readState().cumulativeRoundCount, chargedMovesCount)

    const nextResult = mergeMazeActionResult(activeActionResult(), {
      lastPlayerName: agent.playerName,
      lastMoveStatus: "malformed-response",
      chargedMovesCount,
    })
    lastActionResult = nextResult

    __onActionResult(nextResult)
    notifyRoundCompletion(agent, nextResult)
  }

  // recordPredictionFailure is the single bridge from provider/request failures to game effects.
  const recordPredictionFailure = (
    agent: AgentApiConfig,
    failure: AgentPredictionFailure,
  ): void => {
    if (failure.reason === "caller-abort") {
      return
    }

    if (failure.diagnostic) {
      logTapooDiagnostic(
        runtime.controlModes.agentApi,
        "warn",
        failure.diagnostic.message,
        failure.diagnostic.details,
      )
    }

    if (failure.reason === "malformed-response") {
      recordMalformedAgentResponse(agent)
      return
    }

    recordAgentNetworkError(agent)
  }

  // scheduleNextAgentTurn starts/resumes immediately, then delays internal loop continuations.
  const scheduleNextAgentTurn = (
    delayMs = timing.agentApiCoreDecayIntervalPerCellMs,
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

  // requestNextAgentTurn asks the next enabled agent for moves, then replays only successful predictions here.
  const requestNextAgentTurn = async (
    nextDelayMs = timing.agentApiCoreDecayIntervalPerCellMs,
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

      __onActiveAgentChange?.(selectedAgent)

      // The request service owns HTTP, timeout, tool calls, and classified failure handling.
      const predictionRequest = requestPredictionWithAbort({
        agent: selectedAgent,
        lastActionResult: activeActionResult(),
        state: __readState(),
        timeoutMs: timing.agentApiResponseTimeoutMs,
      })

      activeRequest = predictionRequest
      const prediction = await predictionRequest.promise
      // Request service returns structured failures; game consequences stay centralized here.
      if (prediction.ok === false) {
        recordPredictionFailure(selectedAgent, prediction)
        return
      }

      const { moves: submittedMoves } = prediction
      let lastReplayResult: MazeActionResult | null = null
      let appliedMoveCount = 0
      let hasInvalidMove = false

      for (const move of submittedMoves) {
        const replayState = __dispatchAgentAction({ type: move }, __dispatch, selectedAgent)
        lastReplayResult = replayState
        const status = replayState.lastMoveStatus

        if (status === "reached-target") {
          appliedMoveCount += 1
          // Reaching the destination ends the turn; later submitted moves no longer matter.
          break
        }

        if (status === "applied") {
          appliedMoveCount += 1
          continue
        }

        // Invalid moves stop replay; moves queued behind it were never executed and aren't charged.
        hasInvalidMove = true
        break
      }

      // Unreachable in practice — parseAgentPrediction guarantees a non-empty submittedMoves, so
      // the loop above always runs at least once and sets lastReplayResult. This check exists
      // only to satisfy TypeScript's control-flow analysis on the nullable `let` declaration.
      if (!lastReplayResult) {
        return
      }

      // A turn with any valid moves costs a flat decay charge regardless of how many moves it
      // applied, and a wrong guess costs a flat mistake penalty regardless of how many speculative
      // moves were queued behind it. Together these make single-move-per-turn play the costliest
      // way to solve the maze — batching more moves per turn is strictly cheaper per move, so
      // agents are pushed toward longer, more carefully reasoned predictions rather than
      // conservative single-stepping. The most a single turn can ever be charged is
      // agentBaseDecayUnits + agentPenaltyDecayUnits, when a turn applies at least one valid move
      // before hitting an invalid one.
      const chargedMovesCount =
        (appliedMoveCount > 0 ? agentBaseDecayUnits : 0) + (hasInvalidMove ? agentPenaltyDecayUnits : 0)

      __commitAgentTurn(chargedMovesCount)
      recordAgentTurnStats(
        selectedAgent, __readState().level, __readState().cumulativeRoundCount, chargedMovesCount,
      )

      const nextResult = mergeReplayResult(lastReplayResult, {
        lastPlayerName: selectedAgent.playerName,
        lastMoveStatus: lastReplayResult.lastMoveStatus,
        visitedBefore: lastReplayResult.visitedBefore,
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
