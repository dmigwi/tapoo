import { CONFIG, coreDecayIntervalPerCellMs } from "../config"
import { mergeMazeActionState } from "../cmd-feedback"
import { isRunningStatus } from "../status"
import type {
  MazeAction,
  MazeActionDispatch,
  MazeActionState,
  MoveAction,
} from "../types"

const { runtime, timing } = CONFIG

const agentMovePollIntervalMs = Math.round(
  coreDecayIntervalPerCellMs("agent-api") * timing.agentMovePollSlackFactor,
)

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
  scheduleNextAgentTurn: () => void
  setAttached: (attached: boolean) => void
  setLastActionState: (actionState: MazeActionState | null) => void
  stopPolling: () => void
  shouldPollAgent: () => boolean
}

type HandleAgentTurnLoopOptions = {
  elements: { body: HTMLElement }
  commitAgentTurn: (decayedMovesCount: number) => MazeActionState
  dispatch: MazeActionDispatch
  dispatchAgentAction: (
    action: MazeAction,
    dispatch: MazeActionDispatch,
  ) => MazeActionState
  onActionState: (actionState: MazeActionState) => void
  readActionState: () => MazeActionState
}

// handleAgentTurnLoop owns the HTTP polling cycle used by the agent-api control mode.
export function handleAgentTurnLoop({
  commitAgentTurn, dispatch, dispatchAgentAction, elements, onActionState, readActionState,
}: HandleAgentTurnLoopOptions): AgentMovePoller {
  let attached = false
  let scheduledTurn: number | null = null
  let activeController: AbortController | null = null
  let activeTimeout: number | null = null
  let lastActionState: MazeActionState | null = null

  // activeActionState returns the most recent replay state, or the live base state before any replay exists.
  const activeActionState = (): MazeActionState => lastActionState ?? readActionState()

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
  const shouldPollAgent = (): boolean => attached && isRunningStatus(readActionState().status)

  // scheduleNextAgentTurn waits for the derived agent-api poll interval before asking again.
  const scheduleNextAgentTurn = (): void => {
    clearScheduledTurn()
    if (!shouldPollAgent()) {
      return
    }

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
    activeController = controller
    activeTimeout = window.setTimeout(() => {
      didTimeout = true
      controller.abort()
    }, timing.agentApiResponseTimeoutMs)

    try {
      const response = await fetch(runtime.defaultAgentMoveEndpoint, {
        body: JSON.stringify(activeActionState()),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
        signal: controller.signal,
      })

      if (!response.ok) {
        return
      }

      const submittedMoves = parseAgentPrediction(await response.json())

      if (!submittedMoves) {
        // Malformed payloads spend the fixed mistake decay without replaying any move.
        const decayedMovesCount = runtime.agentApiMistakePenaltyMoves
        const nextState = mergeMazeActionState(
          commitAgentTurn(decayedMovesCount),
          { lastMoveStatus: "malformed-response" },
        )
        lastActionState = nextState
        onActionState(nextState)
        return
      }

      let lastReplayState: MazeActionState | null = null
      let appliedMoveCount = 0

      for (const move of submittedMoves) {
        const replayState = dispatchAgentAction({ type: move }, dispatch)
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
      const committedState = commitAgentTurn(decayedMovesCount)

      const nextState = mergeReplayResult(committedState, {
        lastMoveStatus: lastReplayState.lastMoveStatus,
        visitedBefore: lastReplayState?.visitedBefore,
        submittedMoves: submittedMoves.map(
          (move, index) => `${index}:${move}`,
        ),
        lastValidMoveIndex: appliedMoveCount > 0 ? appliedMoveCount - 1 : null,
        decayedMovesCount,
      })

      lastActionState = nextState
      onActionState(nextState)
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== "AbortError") {
        return
      }

      if (!didTimeout) {
        return
      }

      // Timed-out requests are treated like other agent mistakes and pay the fixed mistake decay.
      const decayedMovesCount = runtime.agentApiMistakePenaltyMoves
      const nextState = mergeMazeActionState(
        commitAgentTurn(decayedMovesCount),
        { lastMoveStatus: "response-timeout" },
      )
      lastActionState = nextState
      onActionState(nextState)
    } finally {
      abortActiveRequest()
      if (shouldPollAgent()) {
        scheduleNextAgentTurn()
      }
    }
  }

  return {
    scheduleNextAgentTurn,
    setAttached(nextAttached) {
      attached = nextAttached
      elements.body.dataset.agentControl = nextAttached ? "active" : "idle"
    },
    setLastActionState(actionState) {
      lastActionState = actionState
    },
    stopPolling,
    shouldPollAgent,
  }
}
