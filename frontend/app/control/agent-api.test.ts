import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CONFIG } from "../config"
import type {
  AgentApiConfig,
  MazeAction,
  MazeActionDispatch,
  MazeActionState,
  TraversalHistoryEntry,
} from "../types"
import { handleAgentTurnLoop } from "./agent-api"

const agentMovePollIntervalMs = CONFIG.timing.agentApiCoreDecayIntervalPerCellMs
const expectedAgentPrompt = [
  "Your name is Blue.",
  `playerName ${CONFIG.runtime.interactivePlayerName} always appears first in traversalHistory and marks the start cell.`,
  "Use currentCell as your current position and destinationCell as the target.",
  "Use traversalHistory entries matching your playerName to review your past moves in order.",
  "Explore carefully: prefer unvisited cells and submit shorter predictions when uncertain.",
  "Return only a JSON object matching expectedResponseSchema.",
  "Moves replay in order until the destination or the first invalid move.",
  "Every submitted move counts toward score decay, including moves after the first invalid move.",
  "Stop predicting when lastMoveStatus is reached-target or status is won.",
  "Choose the moves most likely to reach the destination with the fewest submitted moves.",
].join(" ")

const expectedResponseSchema: MazeActionState["expectedResponseSchema"] = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["moves"],
  properties: {
    moves: {
      type: "array",
      minItems: 1,
      items: {
        type: "string",
        enum: ["MoveUp", "MoveDown", "MoveLeft", "MoveRight"],
      },
    },
  },
}


function visit(row: number, col: number): TraversalHistoryEntry {
  return { playerName: "Blue", row, col }
}

function selfVisit(row: number, col: number): TraversalHistoryEntry {
  return { playerName: CONFIG.runtime.interactivePlayerName, row, col }
}

function createActionState(
  overrides: Partial<MazeActionState> = {},
): MazeActionState {
  return {
    currentCell: { row: 0, col: 0 },
    destinationCell: { row: 0, col: 2 },
    traversalHistory: [selfVisit(0, 0)],
    level: 2,
    score: 600,
    model: "llama3.2",
    stream: false,
    format: "json",
    status: "running",
    recommendedAvgPredictionLimit: 18,
    prompt: expectedAgentPrompt,
    expectedResponseSchema,
    ...overrides,
  }
}

function enabledAgentConfigs(): AgentApiConfig[] {
  return [
    {
      id: 1,
      playerName: "Blue",
      model: "llama3.2",
      endpoint: "https://agents.example/move",
      enabled: true,
    },
  ]
}

function createDisableAgentAfterNetworkError() {
  return vi.fn((agent: AgentApiConfig) => {
    agent.enabled = false
  })
}

describe("agent api turn loop", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("polls only while attached to a running maze", async () => {
    const elements = { body: document.createElement("div") }
    let actionState = createActionState({ status: "running" })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ moves: ["MoveRight"] }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const poller = handleAgentTurnLoop({
      __elements: elements,
      __dispatch: vi.fn() as MazeActionDispatch,
      __dispatchAgentAction: vi.fn(() =>
        createActionState({ lastMoveStatus: "applied" }),
      ),
      __commitAgentTurn: vi.fn(() => createActionState()),
      __onActionState: vi.fn(),
      __disableAgentAfterNetworkError: createDisableAgentAfterNetworkError(),
      __readAgentConfigs: enabledAgentConfigs,
      __readActionState: () => actionState,
    })

    poller.__scheduleNextAgentTurn()
    await vi.advanceTimersByTimeAsync(agentMovePollIntervalMs)
    expect(fetchMock).not.toHaveBeenCalled()

    poller.__setAttached(true)
    actionState = createActionState({ status: "paused" })
    poller.__scheduleNextAgentTurn()
    await vi.advanceTimersByTimeAsync(agentMovePollIntervalMs)
    expect(fetchMock).not.toHaveBeenCalled()

    actionState = createActionState({ status: "running" })
    poller.__scheduleNextAgentTurn()
    await vi.advanceTimersByTimeAsync(agentMovePollIntervalMs)

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
      __commitAgentTurn: vi.fn(() => createActionState()),
      __onActionState: vi.fn(),
      __disableAgentAfterNetworkError: createDisableAgentAfterNetworkError(),
      __readAgentConfigs: () => [],
      __readActionState: () => createActionState(),
    })

    poller.__setAttached(true)
    poller.__scheduleNextAgentTurn()

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
      __commitAgentTurn: vi.fn(() => createActionState()),
      __dispatch: dispatch,
      __dispatchAgentAction: vi.fn(),
      __onActionState: vi.fn(),
      __disableAgentAfterNetworkError: disableAgentAfterNetworkError,
      __readAgentConfigs: () => agentConfigs,
      __readActionState: () => createActionState(),
    })

    poller.__setAttached(true)
    poller.__scheduleNextAgentTurn()
    await vi.advanceTimersByTimeAsync(agentMovePollIntervalMs)

    expect(disableAgentAfterNetworkError).toHaveBeenCalledWith(agentConfigs[0])
    expect(dispatch).toHaveBeenCalledWith({ type: "await-agent" }, { playerName: "Blue" })
  })

  it("replays valid predictions and decays score by every submitted move", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        moves: ["MoveRight", "MoveDown", "MoveLeft"],
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const dispatch = vi.fn() as MazeActionDispatch
    const dispatchAgentAction = vi
      .fn<(action: MazeAction) => MazeActionState>()
      .mockReturnValueOnce(createActionState({
        currentCell: { row: 0, col: 1 },
        traversalHistory: [selfVisit(0, 0), visit(0, 1)],
        lastMoveStatus: "applied",
        visitedBefore: false,
      }))
      .mockReturnValueOnce(createActionState({
        currentCell: { row: 1, col: 1 },
        traversalHistory: [selfVisit(0, 0), visit(0, 1), visit(1, 1)],
        lastMoveStatus: "applied",
        visitedBefore: false,
      }))
      .mockReturnValueOnce(createActionState({
        currentCell: { row: 1, col: 1 },
        traversalHistory: [selfVisit(0, 0), visit(0, 1), visit(1, 1)],
        lastMoveStatus: "invalid-move",
        visitedBefore: true,
      }))
    const commitAgentTurn = vi.fn((decayedMovesCount: number) =>
      createActionState({
        currentCell: { row: 1, col: 1 },
        score: 600 - decayedMovesCount * CONFIG.timing.scoreDecayRate,
      }),
    )
    const onActionState = vi.fn()

    const poller = handleAgentTurnLoop({
      __elements: { body: document.createElement("div") },
      __commitAgentTurn: commitAgentTurn,
      __dispatch: dispatch,
      __dispatchAgentAction: dispatchAgentAction,
      __onActionState: onActionState,
      __disableAgentAfterNetworkError: createDisableAgentAfterNetworkError(),
      __readAgentConfigs: enabledAgentConfigs,
      __readActionState: () => createActionState(),
    })

    poller.__setAttached(true)
    poller.__scheduleNextAgentTurn()
    await vi.advanceTimersByTimeAsync(agentMovePollIntervalMs)

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
    expect(commitAgentTurn).toHaveBeenCalledWith(3)
    expect(onActionState).toHaveBeenCalledWith(
      expect.objectContaining({
        currentCell: { row: 1, col: 1 },
        lastMoveStatus: "invalid-move",
        lastSubmittedMoves: ["0:MoveRight", "1:MoveDown", "2:MoveLeft"],
        lastValidMoveIndex: 1,
        decayedMovesCount: 3,
      }),
    )
  })

  it("rotates through enabled agents configured for the shared maze", async () => {
    const agentConfigs: AgentApiConfig[] = [
      {
        id: 1,
        playerName: "Agent A",
        model: "llama3.2",
        endpoint: "/api/agents/a/move",
        enabled: true,
      },
      {
        id: 2,
        playerName: "Agent B",
        model: "gemma4",
        endpoint: "/api/agents/b/move",
        enabled: true,
      },
      {
        id: 3,
        playerName: "Disabled Agent",
        model: "disabled-model",
        endpoint: "/api/agents/disabled/move",
        enabled: false,
      },
      {
        id: 4,
        playerName: "Agent C",
        model: "qwen3",
        endpoint: "/api/agents/c/move",
        enabled: true,
      },
    ]
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ moves: ["MoveRight"] }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const dispatch = vi.fn() as MazeActionDispatch
    const dispatchAgentAction = vi.fn(() =>
      createActionState({
        currentCell: { row: 0, col: 1 },
        lastMoveStatus: "applied",
      }),
    )
    const onActionState = vi.fn()
    const onActiveAgentChange = vi.fn()

    const poller = handleAgentTurnLoop({
      __elements: { body: document.createElement("div") },
      __commitAgentTurn: vi.fn(() => createActionState()),
      __dispatch: dispatch,
      __dispatchAgentAction: dispatchAgentAction,
      __onActionState: onActionState,
      __onActiveAgentChange: onActiveAgentChange,
      __disableAgentAfterNetworkError: createDisableAgentAfterNetworkError(),
      __readAgentConfigs: () => agentConfigs,
      __readActionState: () => createActionState({ level: 2 }),
    })

    poller.__setAttached(true)
    poller.__scheduleNextAgentTurn()
    await vi.advanceTimersByTimeAsync(agentMovePollIntervalMs)
    await vi.advanceTimersByTimeAsync(agentMovePollIntervalMs)
    await vi.advanceTimersByTimeAsync(agentMovePollIntervalMs)

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/agents/a/move",
      expect.objectContaining({ method: "POST" }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/agents/b/move",
      expect.objectContaining({ method: "POST" }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/agents/c/move",
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

    const firstRequestBody = JSON.parse(firstRequest.body) as MazeActionState
    const secondRequestBody = JSON.parse(secondRequest.body) as MazeActionState
    const thirdRequestBody = JSON.parse(thirdRequest.body) as MazeActionState

    expect(firstRequestBody.prompt).toContain("Your name is Agent A.")
    expect(firstRequestBody.model).toBe("llama3.2")
    expect(firstRequestBody.stream).toBe(false)
    expect(firstRequestBody.format).toBe("json")
    expect(firstRequestBody.prompt).toContain("Your name is Agent A.")
    expect(secondRequestBody.prompt).toContain("Your name is Agent B.")
    expect(secondRequestBody.model).toBe("gemma4")
    expect(secondRequestBody.prompt).toContain("Your name is Agent B.")
    expect(thirdRequestBody.prompt).toContain("Your name is Agent C.")
    expect(thirdRequestBody.model).toBe("qwen3")
    expect(thirdRequestBody.prompt).toContain("Your name is Agent C.")
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
    expect(onActionState).toHaveBeenLastCalledWith(
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
          moves: ["MoveRight", "MoveDown"],
        }),
      }),
    )

    const dispatchAgentAction = vi.fn(() =>
      createActionState({
        currentCell: { row: 0, col: 1 },
        destinationCell: { row: 0, col: 1 },
        lastMoveStatus: "reached-target",
        status: "won",
      }),
    )
    const onActionState = vi.fn()

    const poller = handleAgentTurnLoop({
      __elements: { body: document.createElement("div") },
      __commitAgentTurn: vi.fn((decayedMovesCount: number) =>
        createActionState({
          currentCell: { row: 0, col: 1 },
          destinationCell: { row: 0, col: 1 },
          decayedMovesCount,
          status: "won",
        }),
      ),
      __dispatch: vi.fn() as MazeActionDispatch,
      __dispatchAgentAction: dispatchAgentAction,
      __onActionState: onActionState,
      __disableAgentAfterNetworkError: createDisableAgentAfterNetworkError(),
      __readAgentConfigs: enabledAgentConfigs,
      __readActionState: () => createActionState(),
    })

    poller.__setAttached(true)
    poller.__scheduleNextAgentTurn()
    await vi.advanceTimersByTimeAsync(agentMovePollIntervalMs)

    expect(dispatchAgentAction).toHaveBeenCalledTimes(1)
    expect(onActionState).toHaveBeenCalledWith(
      expect.objectContaining({
        lastMoveStatus: "reached-target",
        status: "won",
        lastSubmittedMoves: ["0:MoveRight", "1:MoveDown"],
        lastValidMoveIndex: 0,
        decayedMovesCount: 2,
      }),
    )
  })

  it("records malformed responses with the fixed mistake decay", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ moves: ["MoveSideways"] }),
      }),
    )

    const dispatchAgentAction = vi.fn()
    const commitAgentTurn = vi.fn((decayedMovesCount: number) =>
      createActionState({ decayedMovesCount }),
    )
    const onActionState = vi.fn()

    const poller = handleAgentTurnLoop({
      __elements: { body: document.createElement("div") },
      __commitAgentTurn: commitAgentTurn,
      __dispatch: vi.fn() as MazeActionDispatch,
      __dispatchAgentAction: dispatchAgentAction,
      __onActionState: onActionState,
      __disableAgentAfterNetworkError: createDisableAgentAfterNetworkError(),
      __readAgentConfigs: enabledAgentConfigs,
      __readActionState: () => createActionState(),
    })

    poller.__setAttached(true)
    poller.__scheduleNextAgentTurn()
    await vi.advanceTimersByTimeAsync(agentMovePollIntervalMs)

    expect(dispatchAgentAction).not.toHaveBeenCalled()
    expect(commitAgentTurn).toHaveBeenCalledWith(
      CONFIG.runtime.agentApiMistakePenaltyMoves,
    )
    expect(onActionState).toHaveBeenCalledWith(
      expect.objectContaining({
        lastMoveStatus: "malformed-response",
        decayedMovesCount: CONFIG.runtime.agentApiMistakePenaltyMoves,
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

    const commitAgentTurn = vi.fn((decayedMovesCount: number) =>
      createActionState({ decayedMovesCount }),
    )
    const onActionState = vi.fn()
    const agentConfigs = enabledAgentConfigs()
    const disableAgentAfterNetworkError = createDisableAgentAfterNetworkError()

    const poller = handleAgentTurnLoop({
      __elements: { body: document.createElement("div") },
      __commitAgentTurn: commitAgentTurn,
      __disableAgentAfterNetworkError: disableAgentAfterNetworkError,
      __dispatch: vi.fn() as MazeActionDispatch,
      __dispatchAgentAction: vi.fn(),
      __onActionState: onActionState,
      __readAgentConfigs: () => agentConfigs,
      __readActionState: () => createActionState(),
    })

    poller.__setAttached(true)
    poller.__scheduleNextAgentTurn()
    await vi.advanceTimersByTimeAsync(agentMovePollIntervalMs)
    await vi.advanceTimersByTimeAsync(CONFIG.timing.agentApiResponseTimeoutMs)

    expect(commitAgentTurn).not.toHaveBeenCalled()
    expect(disableAgentAfterNetworkError).toHaveBeenCalledWith(agentConfigs[0])
    expect(onActionState).toHaveBeenCalledWith(
      expect.objectContaining({
        decayedMovesCount: 0,
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

    const commitAgentTurn = vi.fn((decayedMovesCount: number) =>
      createActionState({ decayedMovesCount }),
    )
    const onActionState = vi.fn()
    const agentConfigs = enabledAgentConfigs()
    const disableAgentAfterNetworkError = createDisableAgentAfterNetworkError()

    const poller = handleAgentTurnLoop({
      __elements: { body: document.createElement("div") },
      __commitAgentTurn: commitAgentTurn,
      __disableAgentAfterNetworkError: disableAgentAfterNetworkError,
      __dispatch: vi.fn() as MazeActionDispatch,
      __dispatchAgentAction: vi.fn(),
      __onActionState: onActionState,
      __readAgentConfigs: () => agentConfigs,
      __readActionState: () => createActionState(),
    })

    poller.__setAttached(true)
    poller.__scheduleNextAgentTurn()
    await vi.advanceTimersByTimeAsync(agentMovePollIntervalMs)

    expect(commitAgentTurn).not.toHaveBeenCalled()
    expect(disableAgentAfterNetworkError).toHaveBeenCalledWith(agentConfigs[0])
    expect(onActionState).toHaveBeenCalledWith(
      expect.objectContaining({
        decayedMovesCount: 0,
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

    const commitAgentTurn = vi.fn((decayedMovesCount: number) =>
      createActionState({ decayedMovesCount }),
    )
    const onActionState = vi.fn()
    const agentConfigs = enabledAgentConfigs()
    const disableAgentAfterNetworkError = createDisableAgentAfterNetworkError()

    const poller = handleAgentTurnLoop({
      __elements: { body: document.createElement("div") },
      __commitAgentTurn: commitAgentTurn,
      __disableAgentAfterNetworkError: disableAgentAfterNetworkError,
      __dispatch: vi.fn() as MazeActionDispatch,
      __dispatchAgentAction: vi.fn(),
      __onActionState: onActionState,
      __readAgentConfigs: () => agentConfigs,
      __readActionState: () => createActionState(),
    })

    poller.__setAttached(true)
    poller.__scheduleNextAgentTurn()
    await vi.advanceTimersByTimeAsync(agentMovePollIntervalMs)

    expect(commitAgentTurn).not.toHaveBeenCalled()
    expect(disableAgentAfterNetworkError).toHaveBeenCalledWith(agentConfigs[0])
    expect(onActionState).toHaveBeenCalledWith(
      expect.objectContaining({
        decayedMovesCount: 0,
        lastMoveStatus: "network-error",
        lastPlayerName: "Blue",
      }),
    )
  })
})
