import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CONFIG } from "../config"
import type {
  AgentApiConfig,
  MazeAction,
  MazeActionDispatch,
  MazeActionResult,
  State,
  TraversalHistoryEntry,
} from "../types"
import { handleAgentTurnLoop } from "./agent-api"

const testAgentMovePollIntervalMs = 5
const testAgentResponseTimeoutMs = 20
const originalAgentResponseTimeoutMs = CONFIG.timing.agentApiResponseTimeoutMs
type SerializedRequestBody = {
  model: string
  stream: false
  think: true
}

function selfVisit(row: number, col: number): TraversalHistoryEntry {
  return { playerName: CONFIG.runtime.interactivePlayerName, row, col, openMoves: [] }
}

function createState(overrides: Partial<State> = {}): State {
  return {
    agentRequestCount: 0,
    cumulativeRoundCount: 0,
    bestWinRequestCount: null,
    bestWinRetentionUnits: null,
    canResume: false,
    clock: null,
    controlMode: CONFIG.runtime.controlModes.agentApi,
    finalPosition: { x: 5, y: 1 },
    lastAttemptRetentionUnits: null,
    lastRoundScore: 0,
    lastWinRequestCount: null,
    level: 2,
    maze: null,
    mazeDimensions: { numCols: 3, numRows: 1, area: 3 },
    playerPosition: { x: 1, y: 1 },
    score: 600,
    scoreDecayUnits: 0,
    status: "running",
    traversalHistory: [selfVisit(0, 0)],
    wallWeight: 1,
    winSummary: "",
    ...overrides,
  }
}

function createActionResult(
  overrides: Partial<MazeActionResult> = {},
): MazeActionResult {
  return {
    lastPlayerName: "Blue",
    ...overrides,
  }
}

function enabledAgentConfigs(): AgentApiConfig[] {
  return [
    {
      id: 1,
      playerName: "Blue",
      model: "llama3.2",
      endpoint: new URL("https://agents.example/move"),
      enabled: true,
    },
  ]
}

function createDisableAgentAfterNetworkError() {
  return vi.fn((agent: AgentApiConfig) => {
    agent.enabled = false
  })
}

async function flushImmediateAgentTurn(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

describe("agent api turn loop", () => {
  beforeEach(() => {
    CONFIG.timing.agentApiResponseTimeoutMs = testAgentResponseTimeoutMs
    vi.useFakeTimers()
  })

  afterEach(() => {
    CONFIG.timing.agentApiResponseTimeoutMs = originalAgentResponseTimeoutMs
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("polls only while attached to a running maze", async () => {
    const elements = { body: document.createElement("div") }
    let state = createState({ status: "running" })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        message: { role: "assistant", content: "{\"moves\":[\"MoveRight\"]}" },
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const poller = handleAgentTurnLoop({
      __elements: elements,
      __dispatch: vi.fn() as MazeActionDispatch,
      __dispatchAgentAction: vi.fn(() =>
        createActionResult({ lastMoveStatus: "applied" }),
      ),
      __commitAgentTurn: vi.fn(),
      __onActionResult: vi.fn(),
      __disableAgentAfterNetworkError: createDisableAgentAfterNetworkError(),
      __readAgentConfigs: enabledAgentConfigs,
      __readState: () => state,
    })

    poller.__scheduleNextAgentTurn(testAgentMovePollIntervalMs)
    expect(fetchMock).not.toHaveBeenCalled()

    poller.__setAttached(true)
    state = createState({ status: "paused" })
    poller.__scheduleNextAgentTurn(testAgentMovePollIntervalMs)
    expect(fetchMock).not.toHaveBeenCalled()

    state = createState({ status: "running" })
    poller.__scheduleNextAgentTurn(testAgentMovePollIntervalMs)
    await flushImmediateAgentTurn()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(elements.body.dataset.agentControl).toBe("active")
  })

  it("moves the game into agent waiting state immediately when no enabled agent exists", () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const dispatch = vi.fn() as MazeActionDispatch

    const poller = handleAgentTurnLoop({
      __elements: { body: document.createElement("div") },
      __dispatch: dispatch,
      __dispatchAgentAction: vi.fn(),
      __commitAgentTurn: vi.fn(),
      __onActionResult: vi.fn(),
      __disableAgentAfterNetworkError: createDisableAgentAfterNetworkError(),
      __readAgentConfigs: () => [],
      __readState: () => createState(),
    })

    poller.__setAttached(true)
    poller.__scheduleNextAgentTurn(testAgentMovePollIntervalMs)

    expect(dispatch).toHaveBeenCalledWith({ type: "await-agent" }, { playerName: "Self" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("moves into agent waiting state after the final enabled agent has a network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("network failed")),
    )

    const agentConfigs = enabledAgentConfigs()
    const dispatch = vi.fn() as MazeActionDispatch
    const disableAgentAfterNetworkError = createDisableAgentAfterNetworkError()

    const poller = handleAgentTurnLoop({
      __elements: { body: document.createElement("div") },
      __commitAgentTurn: vi.fn(),
      __dispatch: dispatch,
      __dispatchAgentAction: vi.fn(),
      __onActionResult: vi.fn(),
      __disableAgentAfterNetworkError: disableAgentAfterNetworkError,
      __readAgentConfigs: () => agentConfigs,
      __readState: () => createState(),
    })

    poller.__setAttached(true)
    poller.__scheduleNextAgentTurn(testAgentMovePollIntervalMs)
    await flushImmediateAgentTurn()
    expect(disableAgentAfterNetworkError).toHaveBeenCalledWith(agentConfigs[0])
    expect(dispatch).toHaveBeenCalledWith({ type: "await-agent" }, { playerName: "Blue" })
  })

  it("replays valid predictions and decays score by applied moves plus a flat mistake penalty", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        message: {
          role: "assistant",
          content: "{\"moves\":[\"MoveRight\",\"MoveDown\",\"MoveLeft\"]}",
        },
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const dispatch = vi.fn() as MazeActionDispatch
    const dispatchAgentAction = vi
      .fn<(action: MazeAction) => MazeActionResult>()
      .mockReturnValueOnce(createActionResult({
        lastMoveStatus: "applied",
        visitedBefore: false,
      }))
      .mockReturnValueOnce(createActionResult({
        lastMoveStatus: "applied",
        visitedBefore: false,
      }))
      .mockReturnValueOnce(createActionResult({
        lastMoveStatus: "invalid-move",
        visitedBefore: true,
      }))
    const commitAgentTurn = vi.fn()
    const onActionResult = vi.fn()

    const poller = handleAgentTurnLoop({
      __elements: { body: document.createElement("div") },
      __commitAgentTurn: commitAgentTurn,
      __dispatch: dispatch,
      __dispatchAgentAction: dispatchAgentAction,
      __onActionResult: onActionResult,
      __disableAgentAfterNetworkError: createDisableAgentAfterNetworkError(),
      __readAgentConfigs: enabledAgentConfigs,
      __readState: () => createState(),
    })

    poller.__setAttached(true)
    poller.__scheduleNextAgentTurn(testAgentMovePollIntervalMs)
    await flushImmediateAgentTurn()
    expect(dispatchAgentAction).toHaveBeenCalledTimes(3)

    expect(dispatchAgentAction).toHaveBeenNthCalledWith(
      1,
      { type: "MoveRight" },
      dispatch,
      expect.objectContaining({ model: "llama3.2", playerName: "Blue" }),
    )
    expect(dispatchAgentAction).toHaveBeenNthCalledWith(
      2,
      { type: "MoveDown" },
      dispatch,
      expect.objectContaining({ model: "llama3.2", playerName: "Blue" }),
    )
    expect(dispatchAgentAction).toHaveBeenNthCalledWith(
      3,
      { type: "MoveLeft" },
      dispatch,
      expect.objectContaining({ model: "llama3.2", playerName: "Blue" }),
    )
    expect(commitAgentTurn).toHaveBeenCalledWith(4)
    expect(onActionResult).toHaveBeenCalledWith(
      expect.objectContaining({
        lastMoveStatus: "invalid-move",
        lastSubmittedMoves: ["0:MoveRight", "1:MoveDown", "2:MoveLeft"],
        lastAppliedMoveIndex: 1,
        chargedMovesCount: 4,
      }),
    )
  })

  it("rotates through enabled agents configured for the shared maze", async () => {
    const agentConfigs: AgentApiConfig[] = [
      {
        id: 1,
        playerName: "Agent A",
        model: "llama3.2",
        endpoint: new URL("https://agents.example/api/agents/a/move"),
        enabled: true,
      },
      {
        id: 2,
        playerName: "Agent B",
        model: "gemma4",
        endpoint: new URL("https://agents.example/api/agents/b/move"),
        enabled: true,
      },
      {
        id: 3,
        playerName: "Disabled Agent",
        model: "disabled-model",
        endpoint: new URL("https://agents.example/api/agents/disabled/move"),
        enabled: false,
      },
      {
        id: 4,
        playerName: "Agent C",
        model: "qwen3",
        endpoint: new URL("https://agents.example/api/agents/c/move"),
        enabled: true,
      },
    ]
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        message: { role: "assistant", content: "{\"moves\":[\"MoveRight\"]}" },
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const dispatch = vi.fn() as MazeActionDispatch
    const dispatchAgentAction = vi.fn(() =>
      createActionResult({
        lastMoveStatus: "applied",
      }),
    )
    const onActionResult = vi.fn()
    const onActiveAgentChange = vi.fn()

    const poller = handleAgentTurnLoop({
      __elements: { body: document.createElement("div") },
      __commitAgentTurn: vi.fn(),
      __dispatch: dispatch,
      __dispatchAgentAction: dispatchAgentAction,
      __onActionResult: onActionResult,
      __onActiveAgentChange: onActiveAgentChange,
      __disableAgentAfterNetworkError: createDisableAgentAfterNetworkError(),
      __readAgentConfigs: () => agentConfigs,
      __readState: () => createState({ level: 2 }),
    })

    poller.__setAttached(true)
    poller.__scheduleNextAgentTurn(testAgentMovePollIntervalMs)
    await flushImmediateAgentTurn()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(testAgentMovePollIntervalMs)
    await flushImmediateAgentTurn()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(testAgentMovePollIntervalMs)
    await flushImmediateAgentTurn()
    expect(fetchMock).toHaveBeenCalledTimes(3)

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      new URL("https://agents.example/api/agents/a/move"),
      expect.objectContaining({ method: "POST" }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      new URL("https://agents.example/api/agents/b/move"),
      expect.objectContaining({ method: "POST" }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      new URL("https://agents.example/api/agents/c/move"),
      expect.objectContaining({ method: "POST" }),
    )

    const firstRequest = fetchMock.mock.calls[0][1] as RequestInit
    const secondRequest = fetchMock.mock.calls[1][1] as RequestInit
    const thirdRequest = fetchMock.mock.calls[2][1] as RequestInit

    if (
      typeof firstRequest.body !== "string" ||
      typeof secondRequest.body !== "string" ||
      typeof thirdRequest.body !== "string"
    ) {
      throw new Error("expected agent request bodies to be serialized json")
    }

    const firstRequestBody = JSON.parse(firstRequest.body) as SerializedRequestBody
    const secondRequestBody = JSON.parse(secondRequest.body) as SerializedRequestBody
    const thirdRequestBody = JSON.parse(thirdRequest.body) as SerializedRequestBody

    expect(firstRequestBody).toEqual(expect.objectContaining({
      model: "llama3.2",
      stream: false,
      think: true,
    }))
    expect(secondRequestBody).toEqual(expect.objectContaining({
      model: "gemma4",
      stream: false,
      think: true,
    }))
    expect(thirdRequestBody).toEqual(expect.objectContaining({
      model: "qwen3",
      stream: false,
      think: true,
    }))
    expect(dispatchAgentAction).toHaveBeenNthCalledWith(
      1,
      { type: "MoveRight" },
      dispatch,
      expect.objectContaining({ model: "llama3.2", playerName: "Agent A" }),
    )
    expect(dispatchAgentAction).toHaveBeenNthCalledWith(
      2,
      { type: "MoveRight" },
      dispatch,
      expect.objectContaining({ model: "gemma4", playerName: "Agent B" }),
    )
    expect(dispatchAgentAction).toHaveBeenNthCalledWith(
      3,
      { type: "MoveRight" },
      dispatch,
      expect.objectContaining({ model: "qwen3", playerName: "Agent C" }),
    )
    expect(onActionResult).toHaveBeenLastCalledWith(
      expect.objectContaining({ lastPlayerName: "Agent C" }),
    )
    expect(onActiveAgentChange).toHaveBeenNthCalledWith(1, agentConfigs[0])
    expect(onActiveAgentChange).toHaveBeenNthCalledWith(2, agentConfigs[1])
    expect(onActiveAgentChange).toHaveBeenNthCalledWith(3, agentConfigs[3])
  })

  it("stops replaying predictions after the destination is reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          message: {
            role: "assistant",
            content: "{\"moves\":[\"MoveRight\",\"MoveDown\"]}",
          },
        }),
      }),
    )

    const dispatchAgentAction = vi.fn(() =>
      createActionResult({
        lastMoveStatus: "reached-target",
      }),
    )
    const onActionResult = vi.fn()

    const poller = handleAgentTurnLoop({
      __elements: { body: document.createElement("div") },
      __commitAgentTurn: vi.fn(),
      __dispatch: vi.fn() as MazeActionDispatch,
      __dispatchAgentAction: dispatchAgentAction,
      __onActionResult: onActionResult,
      __disableAgentAfterNetworkError: createDisableAgentAfterNetworkError(),
      __readAgentConfigs: enabledAgentConfigs,
      __readState: () => createState(),
    })

    poller.__setAttached(true)
    poller.__scheduleNextAgentTurn(testAgentMovePollIntervalMs)
    await flushImmediateAgentTurn()
    expect(dispatchAgentAction).toHaveBeenCalledTimes(1)

    expect(dispatchAgentAction).toHaveBeenCalledTimes(1)
    expect(onActionResult).toHaveBeenCalledWith(
      expect.objectContaining({
        lastMoveStatus: "reached-target",
        lastSubmittedMoves: ["0:MoveRight", "1:MoveDown"],
        lastAppliedMoveIndex: 0,
        chargedMovesCount: 1,
      }),
    )
  })

  it("records malformed responses with the fixed mistake decay", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          message: { role: "assistant", content: "{\"moves\":[\"MoveSideways\"]}" },
        }),
      }),
    )

    const dispatchAgentAction = vi.fn()
    const commitAgentTurn = vi.fn()
    const onActionResult = vi.fn()

    const poller = handleAgentTurnLoop({
      __elements: { body: document.createElement("div") },
      __commitAgentTurn: commitAgentTurn,
      __dispatch: vi.fn() as MazeActionDispatch,
      __dispatchAgentAction: dispatchAgentAction,
      __onActionResult: onActionResult,
      __disableAgentAfterNetworkError: createDisableAgentAfterNetworkError(),
      __readAgentConfigs: enabledAgentConfigs,
      __readState: () => createState(),
    })

    poller.__setAttached(true)
    poller.__scheduleNextAgentTurn(testAgentMovePollIntervalMs)
    await flushImmediateAgentTurn()
    expect(commitAgentTurn).toHaveBeenCalledWith(
      CONFIG.runtime.agentApiMistakePenaltyMoves,
    )

    expect(dispatchAgentAction).not.toHaveBeenCalled()
    expect(onActionResult).toHaveBeenCalledWith(
      expect.objectContaining({
        lastMoveStatus: "malformed-response",
        chargedMovesCount: CONFIG.runtime.agentApiMistakePenaltyMoves,
      }),
    )
  })

  it("disables the agent after response timeouts without score decay", async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"))
        })
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    const commitAgentTurn = vi.fn()
    const onActionResult = vi.fn()
    const agentConfigs = enabledAgentConfigs()
    const disableAgentAfterNetworkError = createDisableAgentAfterNetworkError()

    const poller = handleAgentTurnLoop({
      __elements: { body: document.createElement("div") },
      __commitAgentTurn: commitAgentTurn,
      __disableAgentAfterNetworkError: disableAgentAfterNetworkError,
      __dispatch: vi.fn() as MazeActionDispatch,
      __dispatchAgentAction: vi.fn(),
      __onActionResult: onActionResult,
      __readAgentConfigs: () => agentConfigs,
      __readState: () => createState(),
    })

    poller.__setAttached(true)
    poller.__scheduleNextAgentTurn(testAgentMovePollIntervalMs)
    await flushImmediateAgentTurn()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(testAgentResponseTimeoutMs)

    expect(commitAgentTurn).not.toHaveBeenCalled()
    expect(disableAgentAfterNetworkError).toHaveBeenCalledWith(agentConfigs[0])
    expect(onActionResult).toHaveBeenCalledWith(
      expect.objectContaining({
        chargedMovesCount: 0,
        lastMoveStatus: "network-error",
        lastPlayerName: "Blue",
      }),
    )
  })

  it("disables the agent after non-ok http responses without score decay", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: vi.fn(),
      }),
    )

    const commitAgentTurn = vi.fn()
    const onActionResult = vi.fn()
    const agentConfigs = enabledAgentConfigs()
    const disableAgentAfterNetworkError = createDisableAgentAfterNetworkError()

    const poller = handleAgentTurnLoop({
      __elements: { body: document.createElement("div") },
      __commitAgentTurn: commitAgentTurn,
      __disableAgentAfterNetworkError: disableAgentAfterNetworkError,
      __dispatch: vi.fn() as MazeActionDispatch,
      __dispatchAgentAction: vi.fn(),
      __onActionResult: onActionResult,
      __readAgentConfigs: () => agentConfigs,
      __readState: () => createState(),
    })

    poller.__setAttached(true)
    poller.__scheduleNextAgentTurn(testAgentMovePollIntervalMs)
    await flushImmediateAgentTurn()
    expect(disableAgentAfterNetworkError).toHaveBeenCalledWith(agentConfigs[0])

    expect(commitAgentTurn).not.toHaveBeenCalled()
    expect(disableAgentAfterNetworkError).toHaveBeenCalledWith(agentConfigs[0])
    expect(onActionResult).toHaveBeenCalledWith(
      expect.objectContaining({
        chargedMovesCount: 0,
        lastMoveStatus: "network-error",
        lastPlayerName: "Blue",
      }),
    )
  })

  it("disables the agent after fetch failures without score decay", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("network failed")),
    )

    const commitAgentTurn = vi.fn()
    const onActionResult = vi.fn()
    const agentConfigs = enabledAgentConfigs()
    const disableAgentAfterNetworkError = createDisableAgentAfterNetworkError()

    const poller = handleAgentTurnLoop({
      __elements: { body: document.createElement("div") },
      __commitAgentTurn: commitAgentTurn,
      __disableAgentAfterNetworkError: disableAgentAfterNetworkError,
      __dispatch: vi.fn() as MazeActionDispatch,
      __dispatchAgentAction: vi.fn(),
      __onActionResult: onActionResult,
      __readAgentConfigs: () => agentConfigs,
      __readState: () => createState(),
    })

    poller.__setAttached(true)
    poller.__scheduleNextAgentTurn(testAgentMovePollIntervalMs)
    await flushImmediateAgentTurn()
    expect(disableAgentAfterNetworkError).toHaveBeenCalledWith(agentConfigs[0])

    expect(commitAgentTurn).not.toHaveBeenCalled()
    expect(disableAgentAfterNetworkError).toHaveBeenCalledWith(agentConfigs[0])
    expect(onActionResult).toHaveBeenCalledWith(
      expect.objectContaining({
        chargedMovesCount: 0,
        lastMoveStatus: "network-error",
        lastPlayerName: "Blue",
      }),
    )
  })
})
