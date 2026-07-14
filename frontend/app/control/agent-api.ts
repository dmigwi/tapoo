import { CONFIG, coreDecayIntervalPerCellMs } from "../config"
import type {
  CommandStatus,
  Elements,
  MazeAgentContext,
  MazeAction,
  MazeActionDispatch,
  MazeAgentExpectedResponseType,
  MazeActionState,
} from "../types"

const { runtime, timing } = CONFIG
const agentMovePollIntervalMs =
  coreDecayIntervalPerCellMs("agent-api") * timing.agentMovePollSlackFactor

// AgentMoveRequest is the flattened HTTP payload sent to the external agent for the next move decision.
export type AgentMoveRequest = {
  currentCell: MazeAgentContext["currentCell"]
  destinationCell: MazeAgentContext["destinationCell"]
  level: number
  score: number
  status: MazeAgentContext["status"]
  traversalHistory: MazeAgentContext["traversalHistory"]
  lastCommand: MazeAction | null
  lastCommandStatus: CommandStatus | null
  lastCommandMessage: string | null
  instruction: string | null
  expectedResponseType: MazeAgentExpectedResponseType | null
  visitedBefore: boolean | null
}

// AgentMoveResponse is the compact HTTP response expected back from the external agent.
export type AgentMoveResponse = {
  direction?: string
  move?: string
}

type AgentMovePollerState = {
  activeRequest: AbortController | null
  attached: boolean
  lastActionState: MazeActionState | null
  turnTimeout: number | null
}

type AgentMovePollerOptions = {
  elements: Elements
  readAgentContext: () => MazeAgentContext
  dispatchAgentAction: (
    action: MazeAction,
    dispatch: MazeActionDispatch,
  ) => MazeActionState | null
  dispatch: MazeActionDispatch
}

export type AgentMovePoller = {
  abortActiveRequest: () => void
  clearScheduledTurn: () => void
  scheduleNextAgentTurn: () => void
  shouldPollAgent: () => boolean
  setAttached: (attached: boolean) => void
  setLastActionState: (actionState: MazeActionState | null) => void
}

// agentMoveEndpoint resolves the configured HTTP endpoint for agent move polling.
export function agentMoveEndpoint(elements: Elements): string {
  return elements.body.dataset.tapooAgentEndpoint ?? runtime.defaultAgentMoveEndpoint
}

// agentMoveFromResponse extracts one supported maze move from the agent's HTTP response.
export function agentMoveFromResponse(
  payload: AgentMoveResponse,
): MazeAction | null {
  const move = payload.move ?? payload.direction
  switch (move) {
    case "MoveLeft":
    case "MoveRight":
    case "MoveUp":
    case "MoveDown":
      return { type: move }
    default:
      return null
  }
}

// buildAgentMoveRequest flattens runtime context plus the last command state into one agent-facing payload.
function buildAgentMoveRequest(
  context: MazeAgentContext,
  actionState: MazeActionState | null,
): AgentMoveRequest {
  return {
    currentCell: context.currentCell,
    destinationCell: context.destinationCell,
    level: context.level,
    score: context.score,
    status: context.status,
    traversalHistory: context.traversalHistory,
    lastCommand: actionState?.lastCommand ?? null,
    lastCommandStatus: actionState?.lastCommandStatus ?? null,
    lastCommandMessage: actionState?.lastCommandMessage ?? null,
    instruction: actionState?.instruction ?? null,
    expectedResponseType: actionState?.expectedResponseType ?? null,
    visitedBefore: actionState?.visitedBefore ?? null,
  }
}

// handleAgentTurnLoop owns the HTTP polling cycle used by the agent-api control mode.
export function handleAgentTurnLoop(
  options: AgentMovePollerOptions,
): AgentMovePoller {
  const state: AgentMovePollerState = {
    activeRequest: null,
    attached: false,
    lastActionState: null,
    turnTimeout: null,
  }
  const {
    elements,
    readAgentContext,
    dispatchAgentAction,
    dispatch,
  } = options

  // scheduleNextAgentTurn waits for the derived agent-api poll interval before asking again.
  const scheduleNextAgentTurn = (): void => {
    if (!shouldPollAgent()) {
      return
    }

    state.turnTimeout = window.setTimeout(() => {
      state.turnTimeout = null
      void requestNextAgentTurn()
    }, agentMovePollIntervalMs)
  }

  // shouldPollAgent reports whether the current maze state can accept another agent move.
  const shouldPollAgent = (): boolean => {
    const context = readAgentContext()
    return (
      state.attached &&
      context.status === "running" &&
      Boolean(context.currentCell) &&
      Boolean(context.destinationCell)
    )
  }

  // requestNextAgentTurn fetches one traversal direction from the HTTP agent and applies it.
  const requestNextAgentTurn = async (): Promise<void> => {
    const context = readAgentContext()
    if (!state.attached) {
      return
    }

    if (context.status !== "running" || !context.currentCell || !context.destinationCell) {
      return
    }

    const controller = new AbortController()
    state.activeRequest = controller

    try {
      const response = await fetch(agentMoveEndpoint(elements), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          buildAgentMoveRequest(context, state.lastActionState),
        ),
        signal: controller.signal,
      })
      if (!response.ok) {
        return
      }

      const payload = (await response.json()) as unknown as AgentMoveResponse
      const action = agentMoveFromResponse(payload)
      if (!action) {
        return
      }

      const actionState = dispatchAgentAction(action, dispatch)
      if (actionState) {
        state.lastActionState = actionState
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        return
      }
    } finally {
      if (state.activeRequest === controller) {
        state.activeRequest = null
      }
      if (shouldPollAgent()) {
        scheduleNextAgentTurn()
      }
    }
  }

  return {
    abortActiveRequest() {
      state.activeRequest?.abort()
      state.activeRequest = null
    },
    clearScheduledTurn() {
      if (state.turnTimeout !== null) {
        window.clearTimeout(state.turnTimeout)
        state.turnTimeout = null
      }
    },
    scheduleNextAgentTurn,
    shouldPollAgent,
    setAttached(attached: boolean) {
      state.attached = attached
    },
    setLastActionState(actionState: MazeActionState | null) {
      state.lastActionState = actionState
    },
  }
}
