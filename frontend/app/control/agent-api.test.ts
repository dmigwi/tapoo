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

function visit(row: number, col: number): TraversalHistoryEntry {
  return { playerName: "Blue", row, col }
}

function createActionState(
  overrides: Partial<MazeActionState> = {},
): MazeActionState {
  return {
    currentCell: { row: 0, col: 0 },
    destinationCell: { row: 0, col: 2 },
    traversalHistory: [visit(0, 0)],
    playerName: "Blue",
    level: 2,
    score: 600,
    model: "llama3.2",
    stream: false,
    format: "json",
    status: "running",
    allowedMoves: ["MoveUp", "MoveDown", "MoveLeft", "MoveRight"],
    recommendedAvgPredictionLimit: 18,
    prompt:
      "Your name is Blue. Use traversalHistory entries matching your playerName to review your past moves in order, then use the provided context to predict the next valid moves. Valid moves advance you until the first invalid move stops replay. Every submitted prediction counts toward score decay until the destination is reached. Locate the randomized path between the current position and destination with the highest score retention.",
    expectedResponseFormat: {
      validPredictionFormat: {
        moves: ["MoveRight", "MoveDown"],
      },
    },
    submittedMovesIndexBase: 0,
    submittedMovesPattern: "<index>:<MoveAction>",
    submittedMoves: [],
    lastMoveStatus: null,
    lastValidMoveIndex: null,
    decayedMovesCount: 0,
    ...overrides,
  }
}

function enabledAgentConfigs(): AgentApiConfig[] {
  return [
    {
      id: "blue-agent",
      playerName: "Blue",
      model: "llama3.2",
      endpoint: "/api/agent/move",
      enabled: true,
    },
  ]
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
      elements,
      dispatch: vi.fn() as MazeActionDispatch,
      dispatchAgentAction: vi.fn(() =>
        createActionState({ lastMoveStatus: "applied" }),
      ),
      commitAgentTurn: vi.fn(() => createActionState()),
      onActionState: vi.fn(),
      readAgentConfigs: enabledAgentConfigs,
      readActionState: () => actionState,
    })

    poller.scheduleNextAgentTurn()
    await vi.advanceTimersByTimeAsync(agentMovePollIntervalMs)
    expect(fetchMock).not.toHaveBeenCalled()

    poller.setAttached(true)
    actionState = createActionState({ status: "paused" })
    poller.scheduleNextAgentTurn()
    await vi.advanceTimersByTimeAsync(agentMovePollIntervalMs)
    expect(fetchMock).not.toHaveBeenCalled()

    actionState = createActionState({ status: "running" })
    poller.scheduleNextAgentTurn()
    await vi.advanceTimersByTimeAsync(agentMovePollIntervalMs)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(elements.body.dataset.agentControl).toBe("active")
  })

  it("moves the game into agent waiting state when no enabled agent exists", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const dispatch = vi.fn() as MazeActionDispatch

    const poller = handleAgentTurnLoop({
      elements: { body: document.createElement("div") },
      dispatch,
      dispatchAgentAction: vi.fn(),
      commitAgentTurn: vi.fn(() => createActionState()),
      onActionState: vi.fn(),
      readAgentConfigs: () => [],
      readActionState: () => createActionState(),
    })

    poller.setAttached(true)
    poller.scheduleNextAgentTurn()
    await vi.advanceTimersByTimeAsync(agentMovePollIntervalMs)

    expect(dispatch).toHaveBeenCalledWith({ type: "await-agent" }, { playerName: "Blue" })
    expect(fetchMock).not.toHaveBeenCalled()
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
        traversalHistory: [visit(0, 0), visit(0, 1)],
        lastMoveStatus: "applied",
        visitedBefore: false,
      }))
      .mockReturnValueOnce(createActionState({
        currentCell: { row: 1, col: 1 },
        traversalHistory: [visit(0, 0), visit(0, 1), visit(1, 1)],
        lastMoveStatus: "applied",
        visitedBefore: false,
      }))
      .mockReturnValueOnce(createActionState({
        currentCell: { row: 1, col: 1 },
        traversalHistory: [visit(0, 0), visit(0, 1), visit(1, 1)],
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
      elements: { body: document.createElement("div") },
      commitAgentTurn,
      dispatch,
      dispatchAgentAction,
      onActionState,
      readAgentConfigs: enabledAgentConfigs,
      readActionState: () => createActionState(),
    })

    poller.setAttached(true)
    poller.scheduleNextAgentTurn()
    await vi.advanceTimersByTimeAsync(agentMovePollIntervalMs)

    expect(dispatchAgentAction).toHaveBeenNthCalledWith(
      1,
      { type: "MoveRight" },
      dispatch,
      "Blue",
    )
    expect(dispatchAgentAction).toHaveBeenNthCalledWith(
      2,
      { type: "MoveDown" },
      dispatch,
      "Blue",
    )
    expect(dispatchAgentAction).toHaveBeenNthCalledWith(
      3,
      { type: "MoveLeft" },
      dispatch,
      "Blue",
    )
    expect(commitAgentTurn).toHaveBeenCalledWith(3)
    expect(onActionState).toHaveBeenCalledWith(
      expect.objectContaining({
        currentCell: { row: 1, col: 1 },
        lastMoveStatus: "invalid-move",
        submittedMoves: ["0:MoveRight", "1:MoveDown", "2:MoveLeft"],
        lastValidMoveIndex: 1,
        decayedMovesCount: 3,
      }),
    )
  })

  it("rotates through enabled agents configured for the shared maze", async () => {
    const agentConfigs: AgentApiConfig[] = [
      {
        id: "agent-a",
        playerName: "Agent A",
        model: "llama3.2",
        endpoint: "/api/agents/a/move",
        enabled: true,
      },
      {
        id: "agent-b",
        playerName: "Agent B",
        model: "gemma4",
        endpoint: "/api/agents/b/move",
        enabled: true,
      },
      {
        id: "agent-disabled",
        playerName: "Disabled Agent",
        model: "disabled-model",
        endpoint: "/api/agents/disabled/move",
        enabled: false,
      },
      {
        id: "agent-c",
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

    const poller = handleAgentTurnLoop({
      elements: { body: document.createElement("div") },
      commitAgentTurn: vi.fn(() => createActionState()),
      dispatch,
      dispatchAgentAction,
      onActionState,
      readAgentConfigs: () => agentConfigs,
      readActionState: () => createActionState({ level: 2 }),
    })

    poller.setAttached(true)
    poller.scheduleNextAgentTurn()
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

    expect(firstRequestBody.playerName).toBe("Agent A")
    expect(firstRequestBody.model).toBe("llama3.2")
    expect(firstRequestBody.stream).toBe(false)
    expect(firstRequestBody.format).toBe("json")
    expect(firstRequestBody.prompt).toContain("Your name is Agent A.")
    expect(secondRequestBody.playerName).toBe("Agent B")
    expect(secondRequestBody.model).toBe("gemma4")
    expect(secondRequestBody.prompt).toContain("Your name is Agent B.")
    expect(thirdRequestBody.playerName).toBe("Agent C")
    expect(thirdRequestBody.model).toBe("qwen3")
    expect(thirdRequestBody.prompt).toContain("Your name is Agent C.")
    expect(dispatchAgentAction).toHaveBeenNthCalledWith(
      1,
      { type: "MoveRight" },
      dispatch,
      "Agent A",
    )
    expect(dispatchAgentAction).toHaveBeenNthCalledWith(
      2,
      { type: "MoveRight" },
      dispatch,
      "Agent B",
    )
    expect(dispatchAgentAction).toHaveBeenNthCalledWith(
      3,
      { type: "MoveRight" },
      dispatch,
      "Agent C",
    )
    expect(onActionState).toHaveBeenLastCalledWith(
      expect.objectContaining({ playerName: "Agent C" }),
    )
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
      elements: { body: document.createElement("div") },
      commitAgentTurn: vi.fn((decayedMovesCount: number) =>
        createActionState({
          currentCell: { row: 0, col: 1 },
          destinationCell: { row: 0, col: 1 },
          decayedMovesCount,
          status: "won",
        }),
      ),
      dispatch: vi.fn() as MazeActionDispatch,
      dispatchAgentAction,
      onActionState,
      readAgentConfigs: enabledAgentConfigs,
      readActionState: () => createActionState(),
    })

    poller.setAttached(true)
    poller.scheduleNextAgentTurn()
    await vi.advanceTimersByTimeAsync(agentMovePollIntervalMs)

    expect(dispatchAgentAction).toHaveBeenCalledTimes(1)
    expect(onActionState).toHaveBeenCalledWith(
      expect.objectContaining({
        lastMoveStatus: "reached-target",
        submittedMoves: ["0:MoveRight", "1:MoveDown"],
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
      elements: { body: document.createElement("div") },
      commitAgentTurn,
      dispatch: vi.fn() as MazeActionDispatch,
      dispatchAgentAction,
      onActionState,
      readAgentConfigs: enabledAgentConfigs,
      readActionState: () => createActionState(),
    })

    poller.setAttached(true)
    poller.scheduleNextAgentTurn()
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

  it("records response timeouts with the fixed mistake decay", async () => {
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

    const poller = handleAgentTurnLoop({
      elements: { body: document.createElement("div") },
      commitAgentTurn,
      dispatch: vi.fn() as MazeActionDispatch,
      dispatchAgentAction: vi.fn(),
      onActionState,
      readAgentConfigs: enabledAgentConfigs,
      readActionState: () => createActionState(),
    })

    poller.setAttached(true)
    poller.scheduleNextAgentTurn()
    await vi.advanceTimersByTimeAsync(agentMovePollIntervalMs)
    await vi.advanceTimersByTimeAsync(CONFIG.timing.agentApiResponseTimeoutMs)

    expect(commitAgentTurn).toHaveBeenCalledWith(
      CONFIG.runtime.agentApiMistakePenaltyMoves,
    )
    expect(onActionState).toHaveBeenCalledWith(
      expect.objectContaining({
        lastMoveStatus: "response-timeout",
        decayedMovesCount: CONFIG.runtime.agentApiMistakePenaltyMoves,
      }),
    )
  })
})
