import { CONFIG } from "../config"
import { mergeMazeActionResult } from "../control"
import { requestPredictionWithAbort } from "../agent/request"
import { recordAgentTurnStats } from "../storage"
import { isRunningStatus } from "../status"
import type {
  AgentApiConfig,
  MazeAction,
  MazeActionDispatch,
  MazeActionResult,
  State,
} from "../types"
import type { AgentPredictionRequest } from "../agent/request"

const { runtime, timing } = CONFIG

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
  __readAgentConfigs: () => AgentApiConfig[]
  __onActionResult: (actionResult: MazeActionResult) => void
  __readState: () => State
}

// handleAgentTurnLoop owns the HTTP polling cycle used by the agent-api control mode.
export function handleAgentTurnLoop({
  __commitAgentTurn, __disableAgentAfterNetworkError, __dispatch,
  __dispatchAgentAction, __elements, __onActionResult, __onActiveAgentChange,
  __readState, __readAgentConfigs,
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
    const chargedMovesCount = runtime.agentApiMistakePenaltyMoves
    __commitAgentTurn(chargedMovesCount)
    recordAgentTurnStats(agent, __readState().level, __readState().cumulativeRoundCount)
    const nextResult = mergeMazeActionResult(activeActionResult(), {
      lastPlayerName: agent.playerName,
      lastMoveStatus: "malformed-response",
      chargedMovesCount,
    })
    lastActionResult = nextResult
    __onActionResult(nextResult)
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
        onMalformedResponse: recordMalformedAgentResponse,
        onNetworkError: recordAgentNetworkError,
      })

      activeRequest = predictionRequest
      const prediction = await predictionRequest.promise
      // Manual aborts and classified failures have already been handled by request.ts callbacks.
      if (predictionRequest.isAborted() || prediction.ok === false) {
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

      if (!lastReplayResult) {
        return
      }

      // A wrong guess always costs the same flat mistake penalty, regardless of how many
      // speculative moves were queued behind it — so longer guesses are never punished harder
      // than short ones for the same single mistake.
      const chargedMovesCount = appliedMoveCount + (hasInvalidMove ? runtime.agentApiMistakePenaltyMoves : 0)

      __commitAgentTurn(chargedMovesCount)
      recordAgentTurnStats(selectedAgent, __readState().level, __readState().cumulativeRoundCount)

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
    } finally {
      activeRequest = null
      if (shouldPollAgent()) {
        // Completed agent turns schedule the next poll after the configured delay to pace API traffic.
        scheduleNextAgentTurn(nextDelayMs, true)
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
