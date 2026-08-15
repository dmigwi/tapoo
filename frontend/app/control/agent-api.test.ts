import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CONFIG } from "../config"
import { tapooResetLogs } from "../logs"
import { loadTapooLog } from "../storage"
import type {
  AgentApiConfig,
  MazeAction,
  MazeActionDispatch,
  MazeActionResult,
  State,
  TraversalHistoryEntry,
} from "../types"
import { handleAgentTurnLoop } from "./agent-api"
import type { AgentRoundState } from "./agent-api"

const testAgentMovePollIntervalMs = 5
const testAgentResponseTimeoutMs = 20
const originalAgentResponseTimeoutMs = CONFIG.timing.agentApiResponseTimeoutMs
const testAgentConnectionErrorRetryDelayMs = 5
const originalAgentConnectionErrorRetryDelayMs = CONFIG.timing.agentApiConnectionErrorRetryDelayMs
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
    turnCount: 0,
    cumulativeRoundCount: 0,
    bestWinTraversalSpeedUnits: null,
    bestWinRetentionUnits: null,
    clock: null,
    controlMode: CONFIG.runtime.controlModes.agentApi,
    finalPosition: { x: 5, y: 1 },
    lastAttemptRetentionUnits: null,
    lastRoundScore: 0,
    lastWinTraversalSpeedUnits: null,
    level: 2,
    maze: null,
    mazeDimensions: { numCols: 3, numRows: 1, area: 3 },
    startPosition: { x: 1, y: 1 },
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
      api: "ollama",
      reasoningEffort: "max",
      enabled: true,
    },
  ]
}

function createDisableAgentAfterNetworkError() {
  return vi.fn((agent: AgentApiConfig) => {
    agent.enabled = false
  })
}

const ignoreRoundOutcome = (): void => {}

async function flushImmediateAgentTurn(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

// flushConnectionErrorRetry advances fake timers past the one-shot connection-error retry's backoff
// delay, so a test whose fetch mock keeps failing reaches the final disable/no-score-decay outcome
// instead of stalling mid-retry.
async function flushConnectionErrorRetry(): Promise<void> {
  await vi.advanceTimersByTimeAsync(CONFIG.timing.agentApiConnectionErrorRetryDelayMs)
}

describe("agent api turn loop", () => {
  beforeEach(() => {
    CONFIG.timing.agentApiResponseTimeoutMs = testAgentResponseTimeoutMs
    CONFIG.timing.agentApiConnectionErrorRetryDelayMs = testAgentConnectionErrorRetryDelayMs
    vi.useFakeTimers()
  })

  afterEach(() => {
    CONFIG.timing.agentApiResponseTimeoutMs = originalAgentResponseTimeoutMs
    CONFIG.timing.agentApiConnectionErrorRetryDelayMs = originalAgentConnectionErrorRetryDelayMs
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
      __onRoundOutcome: ignoreRoundOutcome,
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
      __onRoundOutcome: ignoreRoundOutcome,
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
      __onRoundOutcome: ignoreRoundOutcome,
      __disableAgentAfterNetworkError: disableAgentAfterNetworkError,
      __readAgentConfigs: () => agentConfigs,
      __readState: () => createState(),
    })

    poller.__setAttached(true)
    poller.__scheduleNextAgentTurn(testAgentMovePollIntervalMs)
    await flushImmediateAgentTurn()
    await flushConnectionErrorRetry()
    expect(disableAgentAfterNetworkError).toHaveBeenCalledWith(agentConfigs[0])
    expect(dispatch).toHaveBeenCalledWith({ type: "await-agent" }, { playerName: "Blue" })
  })

  it("restarts before polling when an agent turn count mismatches the current round", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const dispatch = vi.fn() as MazeActionDispatch
    const currentState = createState({ cumulativeRoundCount: 8, level: 3, turnCount: 2 })
    const staleAgent: AgentApiConfig = {
      ...enabledAgentConfigs()[0],
      cumulativeRoundCount: 8,
      gameLevel: 3,
      levelTurnCount: 1,
    }

    const poller = handleAgentTurnLoop({
      __elements: { body: document.createElement("div") },
      __commitAgentTurn: vi.fn(),
      __dispatch: dispatch,
      __dispatchAgentAction: vi.fn(),
      __onActionResult: vi.fn(),
      __onRoundOutcome: ignoreRoundOutcome,
      __disableAgentAfterNetworkError: createDisableAgentAfterNetworkError(),
      __readAgentConfigs: () => [staleAgent],
      __readState: () => currentState,
    })

    poller.__setAttached(true)
    poller.__scheduleNextAgentTurn(testAgentMovePollIntervalMs)
    await flushImmediateAgentTurn()

    expect(dispatch).toHaveBeenCalledWith({ type: "restart" }, { playerName: "Self" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("replays valid predictions and decays score by a flat valid-turn charge plus a flat mistake penalty", async () => {
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
      __onRoundOutcome: ignoreRoundOutcome,
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
    expect(commitAgentTurn).toHaveBeenCalledWith(2)
    expect(onActionResult).toHaveBeenCalledWith(
      expect.objectContaining({
        lastMoveStatus: "invalid-move",
        predictionStatus: "partially-applied",
        lastSubmittedMoves: ["0:MoveRight", "1:MoveDown", "2:MoveLeft"],
        lastAppliedMoveIndex: 1,
        visitedBefore: false,
        chargedMovesCount: 2,
      }),
    )
  })

  it.each([
    {
      name: "fully applied",
      replayResults: [
        createActionResult({ lastMoveStatus: "applied", visitedBefore: true }),
        createActionResult({ lastMoveStatus: "applied", visitedBefore: true }),
      ],
      lastMoveStatus: "applied",
      lastAppliedMoveIndex: 1,
      visitedBefore: true,
      chargedMovesCount: CONFIG.scoring.agentBaseDecayUnits,
    },
    {
      name: "partially applied",
      replayResults: [
        createActionResult({ lastMoveStatus: "applied", visitedBefore: true }),
        createActionResult({ lastMoveStatus: "invalid-move" }),
      ],
      lastMoveStatus: "invalid-move",
      lastAppliedMoveIndex: 0,
      visitedBefore: true,
      chargedMovesCount:
        CONFIG.scoring.agentBaseDecayUnits + CONFIG.scoring.agentPartialInvalidPenaltyDecayUnits,
    },
  ])("reports repeat-cell-visits when a $name batch adds no visited cells", async ({
    replayResults,
    lastMoveStatus,
    lastAppliedMoveIndex,
    visitedBefore,
    chargedMovesCount,
  }) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        message: {
          role: "assistant",
          content: "{\"moves\":[\"MoveRight\",\"MoveLeft\"]}",
        },
      }),
    }))

    const dispatchAgentAction = vi.fn<(action: MazeAction) => MazeActionResult>()
    for (const replayResult of replayResults) {
      dispatchAgentAction.mockReturnValueOnce(replayResult)
    }
    const onActionResult = vi.fn()

    const poller = handleAgentTurnLoop({
      __elements: { body: document.createElement("div") },
      __commitAgentTurn: vi.fn(),
      __dispatch: vi.fn() as MazeActionDispatch,
      __dispatchAgentAction: dispatchAgentAction,
      __onActionResult: onActionResult,
      __onRoundOutcome: ignoreRoundOutcome,
      __disableAgentAfterNetworkError: createDisableAgentAfterNetworkError(),
      __readAgentConfigs: enabledAgentConfigs,
      __readState: () => createState(),
    })

    poller.__setAttached(true)
    poller.__scheduleNextAgentTurn(testAgentMovePollIntervalMs)
    await flushImmediateAgentTurn()

    expect(onActionResult).toHaveBeenCalledWith(
      expect.objectContaining({
        lastMoveStatus,
        predictionStatus: "repeat-cell-visits",
        lastAppliedMoveIndex,
        visitedBefore,
        chargedMovesCount,
      }),
    )
  })

  it("leaves visitedBefore empty when the first submitted move is invalid", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        message: { role: "assistant", content: "{\"moves\":[\"MoveRight\"]}" },
      }),
    }))

    const onActionResult = vi.fn()
    const poller = handleAgentTurnLoop({
      __elements: { body: document.createElement("div") },
      __commitAgentTurn: vi.fn(),
      __dispatch: vi.fn() as MazeActionDispatch,
      __dispatchAgentAction: vi.fn(() => createActionResult({ lastMoveStatus: "invalid-move" })),
      __onActionResult: onActionResult,
      __onRoundOutcome: ignoreRoundOutcome,
      __disableAgentAfterNetworkError: createDisableAgentAfterNetworkError(),
      __readAgentConfigs: enabledAgentConfigs,
      __readState: () => createState(),
    })

    poller.__setAttached(true)
    poller.__scheduleNextAgentTurn(testAgentMovePollIntervalMs)
    await flushImmediateAgentTurn()

    expect(onActionResult).toHaveBeenCalledWith(
      expect.objectContaining({
        lastMoveStatus: "invalid-move",
        predictionStatus: "invalid-prediction",
        lastAppliedMoveIndex: null,
        visitedBefore: undefined,
      }),
    )
  })

  it("releases the active seat when a turn ends the round (win or loss)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          message: { role: "assistant", content: "{\"moves\":[\"MoveRight\"]}" },
        }),
      }),
    )

    const dispatchAgentAction = vi.fn(() =>
      createActionResult({ lastMoveStatus: "applied" }),
    )
    const onActiveAgentChange = vi.fn()
    // commitAgentTurn stands in for game.ts committing the turn and flipping status to "lost"
    // once the round's score is depleted mid-turn.
    let roundStatus: State["status"] = "running"
    const commitAgentTurn = vi.fn(() => {
      roundStatus = "lost"
    })
    const onRoundOutcome = vi.fn<(event: AgentRoundState) => void>()

    const poller = handleAgentTurnLoop({
      __elements: { body: document.createElement("div") },
      __commitAgentTurn: commitAgentTurn,
      __dispatch: vi.fn() as MazeActionDispatch,
      __dispatchAgentAction: dispatchAgentAction,
      __onActionResult: vi.fn(),
      __onActiveAgentChange: onActiveAgentChange,
      __onRoundOutcome: onRoundOutcome,
      __disableAgentAfterNetworkError: createDisableAgentAfterNetworkError(),
      __readAgentConfigs: enabledAgentConfigs,
      __readState: () => createState({ status: roundStatus }),
    })

    poller.__setAttached(true)
    poller.__scheduleNextAgentTurn(testAgentMovePollIntervalMs)
    await flushImmediateAgentTurn()

    expect(commitAgentTurn).toHaveBeenCalledTimes(1)
    expect(onActiveAgentChange).toHaveBeenCalledWith(
      expect.objectContaining({ playerName: "Blue" }),
    )
    expect(onActiveAgentChange).toHaveBeenLastCalledWith(null)
    expect(onRoundOutcome).toHaveBeenCalledTimes(1)
    const lostEvent = onRoundOutcome.mock.calls[0][0]
    expect(lostEvent.__agent.playerName).toBe("Blue")
    expect(lostEvent.__actionResult.lastMoveStatus).toBe("applied")
    expect(lostEvent.__state.status).toBe("lost")
  })

  it("invokes the win callback with final agent state after a reached-target replay", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          message: { role: "assistant", content: "{\"moves\":[\"MoveRight\"]}" },
        }),
      }),
    )

    const dispatchAgentAction = vi.fn(() =>
      createActionResult({ lastMoveStatus: "reached-target" }),
    )
    const onRoundOutcome = vi.fn<(event: AgentRoundState) => void>()
    let roundStatus: State["status"] = "running"
    const commitAgentTurn = vi.fn(() => {
      roundStatus = "won"
    })

    const poller = handleAgentTurnLoop({
      __elements: { body: document.createElement("div") },
      __commitAgentTurn: commitAgentTurn,
      __dispatch: vi.fn() as MazeActionDispatch,
      __dispatchAgentAction: dispatchAgentAction,
      __onActionResult: vi.fn(),
      __onRoundOutcome: onRoundOutcome,
      __disableAgentAfterNetworkError: createDisableAgentAfterNetworkError(),
      __readAgentConfigs: enabledAgentConfigs,
      __readState: () => createState({ status: roundStatus, score: 500 }),
    })

    poller.__setAttached(true)
    poller.__scheduleNextAgentTurn(testAgentMovePollIntervalMs)
    await flushImmediateAgentTurn()

    expect(commitAgentTurn).toHaveBeenCalledTimes(1)
    expect(onRoundOutcome).toHaveBeenCalledTimes(1)
    const wonEvent = onRoundOutcome.mock.calls[0][0]
    expect(wonEvent.__agent.playerName).toBe("Blue")
    expect(wonEvent.__actionResult.lastMoveStatus).toBe("reached-target")
    expect(wonEvent.__state.status).toBe("won")
    expect(wonEvent.__state.score).toBe(500)
  })

  it("rotates through enabled agents configured for the shared maze", async () => {
    const agentConfigs: AgentApiConfig[] = [
      {
        id: 1,
        playerName: "Agent A",
        model: "llama3.2",
        endpoint: new URL("https://agents.example/api/agents/a/move"),
        api: "ollama",
        reasoningEffort: "max",
        enabled: true,
      },
      {
        id: 2,
        playerName: "Agent B",
        model: "gemma4",
        endpoint: new URL("https://agents.example/api/agents/b/move"),
        api: "ollama",
        reasoningEffort: "max",
        enabled: true,
      },
      {
        id: 3,
        playerName: "Disabled Agent",
        model: "disabled-model",
        endpoint: new URL("https://agents.example/api/agents/disabled/move"),
        api: "ollama",
        enabled: false,
      },
      {
        id: 4,
        playerName: "Agent C",
        model: "qwen3",
        endpoint: new URL("https://agents.example/api/agents/c/move"),
        api: "ollama",
        reasoningEffort: "max",
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
      __onRoundOutcome: ignoreRoundOutcome,
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
      __onRoundOutcome: ignoreRoundOutcome,
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
    tapooResetLogs(CONFIG.runtime.controlModes.agentApi)
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
      __onRoundOutcome: ignoreRoundOutcome,
      __disableAgentAfterNetworkError: createDisableAgentAfterNetworkError(),
      __readAgentConfigs: enabledAgentConfigs,
      __readState: () => createState(),
    })

    poller.__setAttached(true)
    poller.__scheduleNextAgentTurn(testAgentMovePollIntervalMs)
    await flushImmediateAgentTurn()
    expect(commitAgentTurn).toHaveBeenCalledWith(
      CONFIG.scoring.agentMalformedPenaltyDecayUnits,
    )

    expect(dispatchAgentAction).not.toHaveBeenCalled()
    expect(onActionResult).toHaveBeenCalledWith(
      expect.objectContaining({
        lastMoveStatus: "malformed-response",
        chargedMovesCount: CONFIG.scoring.agentMalformedPenaltyDecayUnits,
      }),
    )
    // malformed-response is the model's own recoverable mistake, already charged its own decay
    // penalty above — not a system failure, so unlike network-error this stays a "warn".
    const malformedEntry = loadTapooLog<{ payload: string; log: string }>(
      CONFIG.runtime.controlModes.agentApi,
    ).find((entry) => entry.payload === "Malformed agent prediction response.")
    expect(malformedEntry?.log).toBe("warn")
  })

  it("clears stale replay details on a malformed response instead of carrying over the previous turn's", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          message: { role: "assistant", content: "{\"moves\":[\"MoveSideways\"]}" },
        }),
      }),
    )

    const onActionResult = vi.fn()
    const poller = handleAgentTurnLoop({
      __elements: { body: document.createElement("div") },
      __commitAgentTurn: vi.fn(),
      __dispatch: vi.fn() as MazeActionDispatch,
      __dispatchAgentAction: vi.fn(),
      __onActionResult: onActionResult,
      __onRoundOutcome: ignoreRoundOutcome,
      __disableAgentAfterNetworkError: createDisableAgentAfterNetworkError(),
      __readAgentConfigs: enabledAgentConfigs,
      __readState: () => createState(),
    })

    // Seed replay details as if a previous turn had actually applied moves — the exact shape
    // get_last_prediction_outcome must NOT still be showing once this turn's malformed response
    // lands, since nothing was replayed this time.
    poller.__setLastActionResult(createActionResult({
      lastMoveStatus: "applied",
      lastSubmittedMoves: ["0:MoveRight", "1:MoveRight"],
      lastReplayStartIndex: 0,
      lastAppliedMoveIndex: 1,
      visitedBefore: false,
      chargedMovesCount: 1,
    }))

    poller.__setAttached(true)
    poller.__scheduleNextAgentTurn(testAgentMovePollIntervalMs)
    await flushImmediateAgentTurn()

    expect(onActionResult).toHaveBeenCalledWith(
      expect.objectContaining({
        lastMoveStatus: "malformed-response",
        predictionStatus: "empty-prediction",
        lastSubmittedMoves: [],
        lastAppliedMoveIndex: null,
        lastReplayStartIndex: undefined,
        visitedBefore: undefined,
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
      __onRoundOutcome: ignoreRoundOutcome,
      __readAgentConfigs: () => agentConfigs,
      __readState: () => createState(),
    })

    poller.__setAttached(true)
    poller.__scheduleNextAgentTurn(testAgentMovePollIntervalMs)
    await flushImmediateAgentTurn()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // First attempt times out, then the one-shot retry fires after its own backoff and times out
    // the same way — the mock fetch hangs forever regardless of call count, so both attempts abort
    // on their own timeout rather than ever resolving.
    await vi.advanceTimersByTimeAsync(testAgentResponseTimeoutMs)
    await vi.advanceTimersByTimeAsync(testAgentConnectionErrorRetryDelayMs)
    expect(fetchMock).toHaveBeenCalledTimes(2)
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
      __onRoundOutcome: ignoreRoundOutcome,
      __readAgentConfigs: () => agentConfigs,
      __readState: () => createState(),
    })

    poller.__setAttached(true)
    poller.__scheduleNextAgentTurn(testAgentMovePollIntervalMs)
    await flushImmediateAgentTurn()
    await flushConnectionErrorRetry()
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

  it("clears stale replay details on a network error instead of carrying over the previous turn's", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: vi.fn(),
        text: vi.fn().mockResolvedValue(""),
      }),
    )

    const onActionResult = vi.fn()
    const agentConfigs = enabledAgentConfigs()

    const poller = handleAgentTurnLoop({
      __elements: { body: document.createElement("div") },
      __commitAgentTurn: vi.fn(),
      __disableAgentAfterNetworkError: createDisableAgentAfterNetworkError(),
      __dispatch: vi.fn() as MazeActionDispatch,
      __dispatchAgentAction: vi.fn(),
      __onActionResult: onActionResult,
      __onRoundOutcome: ignoreRoundOutcome,
      __readAgentConfigs: () => agentConfigs,
      __readState: () => createState(),
    })

    // Seed replay details as if a previous turn had actually applied moves — a network error
    // must not leave this data looking like it belongs to the failed turn.
    poller.__setLastActionResult(createActionResult({
      lastMoveStatus: "applied",
      lastSubmittedMoves: ["0:MoveRight", "1:MoveRight"],
      lastReplayStartIndex: 0,
      lastAppliedMoveIndex: 1,
      visitedBefore: false,
      chargedMovesCount: 1,
    }))

    poller.__setAttached(true)
    poller.__scheduleNextAgentTurn(testAgentMovePollIntervalMs)
    await flushImmediateAgentTurn()
    await flushConnectionErrorRetry()

    expect(onActionResult).toHaveBeenCalledWith(
      expect.objectContaining({
        lastMoveStatus: "network-error",
        predictionStatus: "empty-prediction",
        lastSubmittedMoves: [],
        lastAppliedMoveIndex: null,
        lastReplayStartIndex: undefined,
        visitedBefore: undefined,
      }),
    )
  })

  it("disables the agent after fetch failures without score decay", async () => {
    tapooResetLogs(CONFIG.runtime.controlModes.agentApi)
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
      __onRoundOutcome: ignoreRoundOutcome,
      __readAgentConfigs: () => agentConfigs,
      __readState: () => createState(),
    })

    poller.__setAttached(true)
    poller.__scheduleNextAgentTurn(testAgentMovePollIntervalMs)
    await flushImmediateAgentTurn()
    await flushConnectionErrorRetry()
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
    const networkErrorEntry = loadTapooLog<{
      payload: string
      log: string
      details?: { endpoint: string; error: string }
    }>(CONFIG.runtime.controlModes.agentApi).find(
      (entry) => entry.payload === "Request failed before a valid response.",
    )
    expect(networkErrorEntry?.details).toEqual({
      endpoint: "https://agents.example/move",
      error: "TypeError: network failed",
    })
    // network-error means the provider/infrastructure actually broke, unlike malformed-response
    // (the model's own recoverable mistake, which stays a "warn") — so this logs as "error".
    expect(networkErrorEntry?.log).toBe("error")
  })

  it("recovers after a single connection-error retry and completes the turn normally", async () => {
    tapooResetLogs(CONFIG.runtime.controlModes.agentApi)
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network failed"))
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          message: { role: "assistant", content: "{\"moves\":[\"MoveRight\"]}" },
        }),
      })
    vi.stubGlobal("fetch", fetchMock)

    const dispatch = vi.fn() as MazeActionDispatch
    const dispatchAgentAction = vi
      .fn<(action: MazeAction) => MazeActionResult>()
      .mockReturnValue(createActionResult({ lastMoveStatus: "applied", visitedBefore: false }))
    const commitAgentTurn = vi.fn()
    const onActionResult = vi.fn()
    const disableAgentAfterNetworkError = createDisableAgentAfterNetworkError()

    const poller = handleAgentTurnLoop({
      __elements: { body: document.createElement("div") },
      __commitAgentTurn: commitAgentTurn,
      __dispatch: dispatch,
      __dispatchAgentAction: dispatchAgentAction,
      __onActionResult: onActionResult,
      __onRoundOutcome: ignoreRoundOutcome,
      __disableAgentAfterNetworkError: disableAgentAfterNetworkError,
      __readAgentConfigs: enabledAgentConfigs,
      __readState: () => createState(),
    })

    poller.__setAttached(true)
    poller.__scheduleNextAgentTurn(testAgentMovePollIntervalMs)
    await flushImmediateAgentTurn()
    await flushConnectionErrorRetry()

    // The retry succeeded, so the turn completes normally — no disablement, no network-error/
    // connection-error penalty, the move gets replayed and charged like any other successful turn.
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(disableAgentAfterNetworkError).not.toHaveBeenCalled()
    expect(dispatchAgentAction).toHaveBeenCalledWith(
      { type: "MoveRight" },
      dispatch,
      expect.objectContaining({ playerName: "Blue" }),
    )
    expect(commitAgentTurn).toHaveBeenCalled()

    const logEntries = loadTapooLog<{ payload: string; log: string }>(
      CONFIG.runtime.controlModes.agentApi,
    )
    expect(logEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ payload: "Request failed before a valid response.", log: "error" }),
        expect.objectContaining({ payload: "Recovered after a connection-error retry.", log: "warn" }),
      ]),
    )
  })

  it("warns the model and recovers after one token-limit-exhaustion retry", async () => {
    tapooResetLogs(CONFIG.runtime.controlModes.agentApi)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          prompt_eval_count: 1,
          eval_count: CONFIG.runtime.modelConfig.numPredict,
          message: { role: "assistant", content: "" },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          message: { role: "assistant", content: "{\"moves\":[\"MoveRight\"]}" },
        }),
      })
    vi.stubGlobal("fetch", fetchMock)

    const dispatch = vi.fn() as MazeActionDispatch
    const dispatchAgentAction = vi
      .fn<(action: MazeAction) => MazeActionResult>()
      .mockReturnValue(createActionResult({ lastMoveStatus: "applied", visitedBefore: false }))
    const commitAgentTurn = vi.fn()

    const poller = handleAgentTurnLoop({
      __elements: { body: document.createElement("div") },
      __commitAgentTurn: commitAgentTurn,
      __dispatch: dispatch,
      __dispatchAgentAction: dispatchAgentAction,
      __onActionResult: vi.fn(),
      __onRoundOutcome: ignoreRoundOutcome,
      __disableAgentAfterNetworkError: createDisableAgentAfterNetworkError(),
      __readAgentConfigs: enabledAgentConfigs,
      __readState: () => createState(),
    })

    poller.__setAttached(true)
    poller.__scheduleNextAgentTurn(testAgentMovePollIntervalMs)
    await flushImmediateAgentTurn()
    await vi.advanceTimersByTimeAsync(CONFIG.timing.agentApiRequestPollIntervalMs)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const retryRequest = fetchMock.mock.calls[1]?.[1] as RequestInit
    if (typeof retryRequest.body !== "string") {
      throw new Error("expected retry request body to be serialized json")
    }
    const retryBody = JSON.parse(retryRequest.body) as {
      messages: Array<{ role: string; content?: string }>
    }
    const retryWarning = retryBody.messages.at(-1)
    expect(retryWarning?.role).toBe("user")
    expect(retryWarning?.content).toContain(
      "Try once more to return the correct prediction format output without overthinking.",
    )
    expect(dispatchAgentAction).toHaveBeenCalledWith(
      { type: "MoveRight" },
      dispatch,
      expect.objectContaining({ playerName: "Blue" }),
    )
    expect(commitAgentTurn).toHaveBeenCalledWith(CONFIG.scoring.agentBaseDecayUnits)

  })

  it("retries a repeated token-limit-exhaustion only once", async () => {
    const cappedEmptyResponse = () => ({
      ok: true,
      json: vi.fn().mockResolvedValue({
        prompt_eval_count: 1,
        eval_count: CONFIG.runtime.modelConfig.numPredict,
        message: { role: "assistant", content: "" },
      }),
    })
    const fetchMock = vi.fn().mockResolvedValue(cappedEmptyResponse())
    vi.stubGlobal("fetch", fetchMock)

    const commitAgentTurn = vi.fn()
    const onActionResult = vi.fn()
    const poller = handleAgentTurnLoop({
      __elements: { body: document.createElement("div") },
      __commitAgentTurn: commitAgentTurn,
      __dispatch: vi.fn() as MazeActionDispatch,
      __dispatchAgentAction: vi.fn(),
      __onActionResult: onActionResult,
      __onRoundOutcome: ignoreRoundOutcome,
      __disableAgentAfterNetworkError: createDisableAgentAfterNetworkError(),
      __readAgentConfigs: enabledAgentConfigs,
      __readState: () => createState(),
    })

    poller.__setAttached(true)
    poller.__scheduleNextAgentTurn(testAgentMovePollIntervalMs)
    await flushImmediateAgentTurn()
    await vi.advanceTimersByTimeAsync(CONFIG.timing.agentApiRequestPollIntervalMs)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(commitAgentTurn).toHaveBeenCalledTimes(1)
    expect(commitAgentTurn).toHaveBeenCalledWith(
      CONFIG.scoring.agentMalformedPenaltyDecayUnits,
    )
    expect(onActionResult).toHaveBeenCalledWith(expect.objectContaining({
      lastMoveStatus: "token-limit-exhaustion",
      predictionStatus: "empty-prediction",
    }))
  })
})
