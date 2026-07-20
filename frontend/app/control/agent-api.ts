import { CONFIG } from "../config"
import { buildAgentPrompt, mergeMazeActionState } from "../agent/context"
import { isRunningStatus } from "../status"
import type {
  AgentApiConfig,
  MazeAction,
  MazeActionDispatch,
  MazeActionState,
  MoveAction,
} from "../types"

const { runtime, timing } = CONFIG

type AgentPredictionResponse = {
  moves?: unknown
}

// isMoveAction validates one raw prediction entry against the supported move vocabulary.
function isMoveAction(value: unknown): value is MoveAction {
  return (
    value === "MoveUp" ||
    value === "MoveDown" ||
    value === "MoveLeft" ||
    value === "MoveRight"
  )
}

// parseAgentPrediction extracts the single supported prediction payload from one HTTP response.
function parseAgentPrediction(payload: unknown): MoveAction[] | null {
  if (typeof payload !== "object" || payload === null) {
    return null
  }

  const { moves } = payload as AgentPredictionResponse
  if (!Array.isArray(moves) || moves.length === 0) {
    return null
  }
  return moves.every(isMoveAction) ? [...moves] : null
}

// mergeReplayResult reapplies replay metadata on top of the latest committed base state.
function mergeReplayResult(
  actionState: MazeActionState,
  overrides: Partial<MazeActionState>,
): MazeActionState {
  return mergeMazeActionState(actionState, overrides)
}

export type AgentMovePoller = {
  __stopPolling: () => void
  __shouldPollAgent: () => boolean
  __scheduleNextAgentTurn: () => void
  __setAttached: (attached: boolean) => void
  __setLastActionState: (actionState: MazeActionState | null) => void
}

type HandleAgentTurnLoopOptions = {
  __elements: { body: HTMLElement }
  __commitAgentTurn: (decayedMovesCount: number) => MazeActionState
  __dispatch: MazeActionDispatch
  __dispatchAgentAction: (
    action: MazeAction,
    dispatch: MazeActionDispatch,
    agent: AgentApiConfig,
  ) => MazeActionState
  __disableAgentAfterNetworkError: (agent: AgentApiConfig) => void
  __onActiveAgentChange?: (agent: AgentApiConfig | null) => void
  __readAgentConfigs: () => AgentApiConfig[]
  __onActionState: (actionState: MazeActionState) => void
  __readActionState: () => MazeActionState
}

// handleAgentTurnLoop owns the HTTP polling cycle used by the agent-api control mode.
export function handleAgentTurnLoop({
  __commitAgentTurn, __disableAgentAfterNetworkError, __dispatch,
  __dispatchAgentAction, __elements, __onActionState, __onActiveAgentChange,
  __readActionState, __readAgentConfigs,
}: HandleAgentTurnLoopOptions): AgentMovePoller {
  let attached = false
  let scheduledTurn: number | null = null
  let activeController: AbortController | null = null
  let activeTimeout: number | null = null
  let lastActionState: MazeActionState | null = null
  let agentCursor = 0

  // activeActionState returns the most recent replay state, or the live base state before any replay exists.
  const activeActionState = (): MazeActionState => lastActionState ?? __readActionState()

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

  // hasEnabledAgents checks whether polling can produce work before waiting for a timeout.
  const hasEnabledAgents = (): boolean => __readAgentConfigs().some((agent) => agent.enabled)

  // awaitAgent immediately moves the game into its no-agent state without spending score.
  const awaitAgent = (): void => {
    __onActiveAgentChange?.(null)
    __dispatch(
      { type: "await-agent" },
      { playerName: activeActionState().lastPlayerName ?? runtime.interactivePlayerName },
    )
  }

  // clearScheduledTurn stops any queued request cycle.
  const clearScheduledTurn = (): void => {
    if (scheduledTurn === null) {
      return
    }

    window.clearTimeout(scheduledTurn)
    scheduledTurn = null
  }

  // abortActiveRequest cancels the in-flight HTTP request and its timeout watcher.
  const abortActiveRequest = (): void => {
    activeController?.abort()
    activeController = null
    if (activeTimeout !== null) {
      window.clearTimeout(activeTimeout)
      activeTimeout = null
    }
  }

  // stopPolling clears both queued and active work so callers can reset the loop in one step.
  const stopPolling = (): void => {
    clearScheduledTurn()
    abortActiveRequest()
  }

  // shouldPollAgent only keeps the replay loop alive while the live round is actively running.
  const shouldPollAgent = (): boolean => attached && isRunningStatus(__readActionState().status)

  // recordAgentNetworkError disables failed agents and records the no-score-decay network state.
  const recordAgentNetworkError = (agent: AgentApiConfig | null): void => {
    if (!agent) {
      return
    }

    __onActiveAgentChange?.(null)
    __disableAgentAfterNetworkError(agent)
    const nextState = mergeMazeActionState(activeActionState(), {
      lastPlayerName: agent.playerName,
      lastMoveStatus: "network-error",
      decayedMovesCount: 0,
    })
    lastActionState = nextState
    __onActionState(nextState)

    if (!hasEnabledAgents()) {
      awaitAgent()
    }
  }

  // scheduleNextAgentTurn waits for the derived agent-api poll interval before asking again.
  const scheduleNextAgentTurn = (): void => {
    clearScheduledTurn()
    if (!shouldPollAgent()) {
      return
    }

    if (!hasEnabledAgents()) {
      awaitAgent()
      return
    }

    const agentMovePollIntervalMs = timing.agentApiCoreDecayIntervalPerCellMs
    scheduledTurn = window.setTimeout(() => {
      scheduledTurn = null
      void requestNextAgentTurn()
    }, agentMovePollIntervalMs)
  }

  // requestNextAgentTurn submits the current maze state and replays one predicted batch in order.
  const requestNextAgentTurn = async (): Promise<void> => {
    if (!shouldPollAgent()) {
      return
    }

    let didTimeout = false
    // AbortController lets the timeout watcher cancel slow requests cleanly.
    const controller = new AbortController()
    let selectedAgent: AgentApiConfig | null = null
    activeController = controller
    activeTimeout = window.setTimeout(() => {
      didTimeout = true
      controller.abort()
    }, timing.agentApiResponseTimeoutMs)

    try {
      const currentActionState = activeActionState()
      selectedAgent = nextAgent()
      if (!selectedAgent) {
        awaitAgent()
        return
      }
      __onActiveAgentChange?.(selectedAgent)

      const requestActionState = mergeMazeActionState(currentActionState, {
        model: selectedAgent.model,
        prompt: buildAgentPrompt(selectedAgent.playerName),
      })

      const response = await fetch(selectedAgent.endpoint, {
        body: JSON.stringify(requestActionState),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
        signal: controller.signal,
      })

      if (!response.ok) {
        // Network-class failures disable this agent without spending score decay.
        recordAgentNetworkError(selectedAgent)
        return
      }

      const submittedMoves = parseAgentPrediction(await response.json())

      if (!submittedMoves) {
        // Malformed payloads spend the fixed mistake decay without replaying any move.
        const decayedMovesCount = runtime.agentApiMistakePenaltyMoves
        const nextState = mergeMazeActionState(
          __commitAgentTurn(decayedMovesCount),
          {
            lastPlayerName: selectedAgent.playerName,
            lastMoveStatus: "malformed-response",
          },
        )
        lastActionState = nextState
        __onActionState(nextState)
        return
      }

      let lastReplayState: MazeActionState | null = null
      let appliedMoveCount = 0

      for (const move of submittedMoves) {
        const replayState = __dispatchAgentAction({ type: move }, __dispatch, selectedAgent)
        lastReplayState = replayState
        const status = replayState.lastMoveStatus

        if (status === "reached-target") {
          appliedMoveCount += 1
          // The destination was reached, so no later prediction can affect this replay.
          break
        }

        if (status === "applied") {
          appliedMoveCount += 1
          continue
        }

        // Stop once replay hits the first invalid move in the batch.
        break
      }

      if (!lastReplayState) {
        return
      }

      const decayedMovesCount = submittedMoves.length

      // Every successfully parsed prediction batch decays by its full submitted move count.
      const committedState = __commitAgentTurn(decayedMovesCount)

      const nextState = mergeReplayResult(committedState, {
        lastPlayerName: selectedAgent.playerName,
        lastMoveStatus: lastReplayState.lastMoveStatus,
        visitedBefore: lastReplayState?.visitedBefore,
        lastSubmittedMoves: submittedMoves.map(
          (move, index) => `${index}:${move}`,
        ),
        lastValidMoveIndex: appliedMoveCount > 0 ? appliedMoveCount - 1 : null,
        decayedMovesCount,
      })

      lastActionState = nextState
      __onActionState(nextState)
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== "AbortError") {
        recordAgentNetworkError(selectedAgent)
        return
      }

      if (!didTimeout) {
        return
      }

      // Timeouts are transport failures, so only the failing agent is disabled.
      recordAgentNetworkError(selectedAgent)
    } finally {
      abortActiveRequest()
      if (shouldPollAgent()) {
        scheduleNextAgentTurn()
      }
    }
  }

  return {
    __scheduleNextAgentTurn: scheduleNextAgentTurn,
    __setAttached(nextAttached) {
      attached = nextAttached
      __elements.body.dataset.agentControl = nextAttached ? "active" : "idle"
    },
    __setLastActionState(actionState) {
      lastActionState = actionState
    },
    __stopPolling: stopPolling,
    __shouldPollAgent: shouldPollAgent,
  }
}
