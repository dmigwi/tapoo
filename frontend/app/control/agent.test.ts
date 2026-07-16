import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createAgentMode } from "./agent"
import { CONFIG } from "../config"
import type {
  AgentApiConfig,
  MazeAction,
  MazeActionDispatchOptions,
  MazeActionState,
  TraversalHistoryEntry,
} from "../types"

const agentMovePollIntervalMs = CONFIG.timing.agentApiCoreDecayIntervalPerCellMs
const expectedAgentPrompt = [
  "Your name is Blue.",
  "Use traversalHistory entries matching your playerName to review your past moves in order,",
  "then use the provided context to predict the next valid moves.",
  "Valid moves advance you until the first invalid move stops replay.",
  "Every submitted prediction counts toward score decay until the destination is reached.",
  "Locate the randomized path between the current position and destination with the highest score retention.",
].join("\n")

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

function createTestAgentMode(elements: Parameters<typeof createAgentMode>[0]) {
  return createAgentMode(elements, enabledAgentConfigs)
}

function visit(row: number, col: number): TraversalHistoryEntry {
  return { playerName: "Blue", row, col }
}

function createButton({
  action,
  move,
}: {
  action?: string
  move?: string
}): HTMLButtonElement {
  const button = document.createElement("button")

  if (action) {
    button.dataset.action = action
  }

  if (move) {
    button.dataset.move = move
  }

  return button
}

function createActionState(
  overrides: Partial<MazeActionState> = {},
): MazeActionState {
  return {
    currentCell: { row: 0, col: 0 },
    destinationCell: { row: 0, col: 2 },
    traversalHistory: [visit(0, 0)],
    playerName: "Blue",
    level: 4,
    score: 800,
    model: "llama3.2",
    stream: false,
    format: "json",
    status: "running",
    allowedMoves: ["MoveUp", "MoveDown", "MoveLeft", "MoveRight"],
    recommendedAvgPredictionLimit: 18,
    prompt: expectedAgentPrompt,
    expectedResponseFormat: {
      validPredictionFormat: {
        moves: ["MoveRight", "MoveDown"],
      },
    },
    lastMoveStatus: null,
    submittedMovesIndexBase: 0,
    submittedMovesPattern: "<index>:<MoveAction>",
    submittedMoves: [],
    lastValidMoveIndex: null,
    decayedMovesCount: 0,
    ...overrides,
  }
}

describe("agent control mode", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("polls the agent endpoint for traversal moves and dispatches them with feedback enabled", async () => {
    const elements = {
      app: document.createElement("div"),
      body: document.createElement("div"),
      controls: [],
      measure: document.createElement("div"),
      screen: document.createElement("div"),
      touchButtons: [createButton({ action: "pause" })],
      touchControls: document.createElement("div"),
    }
    elements.app.focus = vi.fn()

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ moves: ["MoveRight", "MoveDown"] }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const dispatch = vi
      .fn()
      .mockReturnValueOnce(createActionState({
        currentCell: { row: 0, col: 1 },
        traversalHistory: [visit(0, 0), visit(0, 1)],
        lastMoveStatus: "applied",
        submittedMoves: ["0:MoveRight"],
        lastValidMoveIndex: 0,
        visitedBefore: false,
      }))
      .mockReturnValueOnce(createActionState({
        currentCell: { row: 1, col: 1 },
        traversalHistory: [visit(0, 0), visit(0, 1), visit(1, 1)],
        lastMoveStatus: "applied",
        submittedMoves: ["0:MoveDown"],
        lastValidMoveIndex: 0,
        visitedBefore: false,
      }))

    const readActionState = vi.fn().mockReturnValue(createActionState())
    const commitAgentTurn = vi.fn((decayedMovesCount: number) =>
      createActionState({
        currentCell: { row: 1, col: 1 },
        score: 800 - decayedMovesCount * 100,
      }),
    )

    const mode = createTestAgentMode(elements)

    mode.bindActionDispatch(dispatch, readActionState, commitAgentTurn)
    await vi.advanceTimersByTimeAsync(agentMovePollIntervalMs)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agent/move",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      }),
    )
    const request = fetchMock.mock.calls[0][1] as RequestInit

    if (typeof request.body !== "string") {
      throw new Error("expected agent request body to be serialized json")
    }

    expect(JSON.parse(request.body)).toEqual({
      currentCell: { row: 0, col: 0 },
      destinationCell: { row: 0, col: 2 },
      playerName: "Blue",
      level: 4,
      score: 800,
      model: "llama3.2",
      stream: false,
      format: "json",
      status: "running",
      traversalHistory: [visit(0, 0)],
      allowedMoves: ["MoveUp", "MoveDown", "MoveLeft", "MoveRight"],
      recommendedAvgPredictionLimit: 18,
      prompt: expectedAgentPrompt,
      expectedResponseFormat: {
        validPredictionFormat: {
          moves: ["MoveRight", "MoveDown"],
        },
      },
      lastMoveStatus: null,
      submittedMovesIndexBase: 0,
      submittedMovesPattern: "<index>:<MoveAction>",
      submittedMoves: [],
      lastValidMoveIndex: null,
      decayedMovesCount: 0,
    })
    expect(dispatch).toHaveBeenNthCalledWith(
      1,
      { type: "MoveRight" },
      { wantFeedback: true, playerName: "Blue" },
    )
    expect(dispatch).toHaveBeenNthCalledWith(
      2,
      { type: "MoveDown" },
      { wantFeedback: true, playerName: "Blue" },
    )
    expect(commitAgentTurn).toHaveBeenCalledWith(
      2,
    )
    expect(commitAgentTurn).toHaveBeenCalledTimes(1)
    expect(mode.readLastActionState()).toEqual(
      expect.objectContaining({
        currentCell: { row: 1, col: 1 },
        lastMoveStatus: "applied",
        submittedMoves: ["0:MoveRight", "1:MoveDown"],
        lastValidMoveIndex: 1,
      }),
    )
  })

  it("keeps a single successful prediction as applied", async () => {
    const elements = {
      app: document.createElement("div"),
      body: document.createElement("div"),
      controls: [],
      measure: document.createElement("div"),
      screen: document.createElement("div"),
      touchButtons: [createButton({ action: "pause" })],
      touchControls: document.createElement("div"),
    }
    elements.app.focus = vi.fn()

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ moves: ["MoveRight"] }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const dispatch = vi.fn().mockReturnValueOnce(createActionState({
      currentCell: { row: 0, col: 1 },
      traversalHistory: [visit(0, 0), visit(0, 1)],
      lastMoveStatus: "applied",
      submittedMoves: ["0:MoveRight"],
      lastValidMoveIndex: 0,
      visitedBefore: false,
    }))

    const readActionState = vi.fn().mockReturnValue(createActionState())
    const commitAgentTurn = vi.fn((decayedMovesCount: number) =>
      createActionState({
        currentCell: { row: 0, col: 1 },
        score: 800 - decayedMovesCount * 100,
      }),
    )

    const mode = createTestAgentMode(elements)

    mode.bindActionDispatch(dispatch, readActionState, commitAgentTurn)
    await vi.advanceTimersByTimeAsync(agentMovePollIntervalMs)

    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(commitAgentTurn).toHaveBeenCalledWith(1)
    expect(mode.readLastActionState()).toEqual(
      expect.objectContaining({
        currentCell: { row: 0, col: 1 },
        lastMoveStatus: "applied",
        submittedMoves: ["0:MoveRight"],
        lastValidMoveIndex: 0,
        decayedMovesCount: 1,
      }),
    )
  })

  it("applies score decay to every submitted move in a valid prediction batch even when replay stops early", async () => {
    const elements = {
      app: document.createElement("div"),
      body: document.createElement("div"),
      controls: [],
      measure: document.createElement("div"),
      screen: document.createElement("div"),
      touchButtons: [createButton({ action: "pause" })],
      touchControls: document.createElement("div"),
    }
    elements.app.focus = vi.fn()

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        moves: ["MoveRight", "MoveDown", "MoveLeft"],
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const dispatch = vi
      .fn()
      .mockReturnValueOnce(createActionState({
        currentCell: { row: 0, col: 1 },
        traversalHistory: [visit(0, 0), visit(0, 1)],
        lastMoveStatus: "applied",
        submittedMoves: ["0:MoveRight"],
        lastValidMoveIndex: 0,
        visitedBefore: false,
      }))
      .mockReturnValueOnce(createActionState({
        currentCell: { row: 0, col: 1 },
        traversalHistory: [visit(0, 0), visit(0, 1)],
        lastMoveStatus: "invalid-move",
        submittedMoves: ["1:MoveDown"],
        lastValidMoveIndex: 0,
        visitedBefore: true,
      }))

    const readActionState = vi.fn().mockReturnValue(createActionState())
    const commitAgentTurn = vi.fn((decayedMovesCount: number) =>
      createActionState({
        currentCell: { row: 0, col: 1 },
        score: 800 - decayedMovesCount * 100,
      }),
    )

    const mode = createTestAgentMode(elements)

    mode.bindActionDispatch(dispatch, readActionState, commitAgentTurn)
    await vi.advanceTimersByTimeAsync(agentMovePollIntervalMs)

    expect(dispatch).toHaveBeenCalledTimes(2)
    expect(commitAgentTurn).toHaveBeenCalledWith(
      3,
    )
    expect(mode.readLastActionState()).toEqual(
      expect.objectContaining({
        currentCell: { row: 0, col: 1 },
        lastMoveStatus: "invalid-move",
        submittedMoves: ["0:MoveRight", "1:MoveDown", "2:MoveLeft"],
        lastValidMoveIndex: 0,
        decayedMovesCount: 3,
      }),
    )
  })

  it("stops replaying later predictions once a move reaches the target", async () => {
    const elements = {
      app: document.createElement("div"),
      body: document.createElement("div"),
      controls: [],
      measure: document.createElement("div"),
      screen: document.createElement("div"),
      touchButtons: [createButton({ action: "pause" })],
      touchControls: document.createElement("div"),
    }
    elements.app.focus = vi.fn()

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        moves: ["MoveRight", "MoveDown", "MoveLeft"],
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const dispatch = vi.fn().mockReturnValueOnce(createActionState({
      currentCell: { row: 0, col: 1 },
      destinationCell: { row: 0, col: 1 },
      traversalHistory: [visit(0, 0), visit(0, 1)],
      lastMoveStatus: "reached-target",
      submittedMoves: ["0:MoveRight"],
      lastValidMoveIndex: 0,
      visitedBefore: false,
      status: "won",
    }))

    const readActionState = vi.fn().mockReturnValue(createActionState())
    const commitAgentTurn = vi.fn((decayedMovesCount: number) =>
      createActionState({
        currentCell: { row: 0, col: 1 },
        destinationCell: { row: 0, col: 1 },
        score: 800 - decayedMovesCount * 100,
        status: "won",
      }),
    )

    const mode = createTestAgentMode(elements)

    mode.bindActionDispatch(dispatch, readActionState, commitAgentTurn)
    await vi.advanceTimersByTimeAsync(agentMovePollIntervalMs)

    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith(
      { type: "MoveRight" },
      { wantFeedback: true, playerName: "Blue" },
    )
    expect(commitAgentTurn).toHaveBeenCalledWith(3)
    expect(mode.readLastActionState()).toEqual(
      expect.objectContaining({
        currentCell: { row: 0, col: 1 },
        destinationCell: { row: 0, col: 1 },
        lastMoveStatus: "reached-target",
        submittedMoves: ["0:MoveRight", "1:MoveDown", "2:MoveLeft"],
        lastValidMoveIndex: 0,
        decayedMovesCount: 3,
      }),
    )
  })

  it("keeps local session actions human-driven without requesting feedback", () => {
    const elements = {
      app: document.createElement("div"),
      body: document.createElement("div"),
      controls: [],
      measure: document.createElement("div"),
      screen: document.createElement("div"),
      touchButtons: [
        createButton({ action: "walls" }),
        createButton({ action: "proceed" }),
        createButton({ action: "pause" }),
      ],
      touchControls: document.createElement("div"),
    }
    elements.app.focus = vi.fn()

    vi.stubGlobal("fetch", vi.fn())

    const dispatch = vi.fn()
    const readActionState = vi.fn().mockReturnValue(
      createActionState({
        destinationCell: { row: 0, col: 1 },
        level: 1,
        score: 100,
        status: "paused",
      }),
    )

    const mode = createTestAgentMode(elements)

    mode.bindActionDispatch(dispatch, readActionState, vi.fn(() => createActionState()))
    elements.touchButtons[0].click()
    elements.touchButtons[1].click()
    elements.touchButtons[2].click()
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "b",
        ctrlKey: true,
        bubbles: true,
      }),
    )
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "p",
        ctrlKey: true,
        bubbles: true,
      }),
    )
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: " ",
        bubbles: true,
      }),
    )
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
      }),
    )

    expect(dispatch).toHaveBeenNthCalledWith(1, { type: "cycle-walls" }, { playerName: "Self" })
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: "proceed" }, { playerName: "Self" })
    expect(dispatch).toHaveBeenNthCalledWith(3, { type: "pause" }, { playerName: "Self" })
    expect(dispatch).toHaveBeenNthCalledWith(4, { type: "cycle-walls" }, { playerName: "Self" })
    expect(dispatch).toHaveBeenNthCalledWith(5, { type: "proceed" }, { playerName: "Self" })
    expect(dispatch).toHaveBeenNthCalledWith(6, { type: "pause" }, { playerName: "Self" })
    expect(dispatch).toHaveBeenCalledTimes(6)
    expect(mode.readLastActionState()).toBeNull()
  })

  it("stops polling while the maze is not running and restarts after proceed", async () => {
    const elements = {
      app: document.createElement("div"),
      body: document.createElement("div"),
      controls: [],
      measure: document.createElement("div"),
      screen: document.createElement("div"),
      touchButtons: [createButton({ action: "proceed" })],
      touchControls: document.createElement("div"),
    }
    elements.app.focus = vi.fn()

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ moves: ["MoveRight"] }),
    })
    vi.stubGlobal("fetch", fetchMock)

    let status: "paused" | "running" = "paused"
    const dispatch = vi.fn((action: MazeAction, options?: MazeActionDispatchOptions) => {
      if (action.type === "proceed") {
        status = "running"
        return null
      }

      if (options?.wantFeedback) {
        return {
          ...createActionState({
            level: 1,
            score: 100,
            lastMoveStatus: "applied",
            submittedMoves: ["0:MoveRight"],
            lastValidMoveIndex: 0,
            visitedBefore: false,
          }),
        }
      }

      return null
    })
    const readActionState = vi.fn(() =>
      createActionState({
        level: 1,
        score: 100,
        status,
      }),
    )
    const commitAgentTurn = vi.fn(() => createActionState({ level: 1, score: 100, status }))

    const mode = createTestAgentMode(elements)

    mode.bindActionDispatch(dispatch, readActionState, commitAgentTurn)
    await vi.advanceTimersByTimeAsync(agentMovePollIntervalMs)
    expect(fetchMock).not.toHaveBeenCalled()

    elements.touchButtons[0].click()
    await vi.advanceTimersByTimeAsync(agentMovePollIntervalMs)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenNthCalledWith(1, { type: "proceed" }, { playerName: "Self" })
    expect(dispatch).toHaveBeenNthCalledWith(
      2,
      { type: "MoveRight" },
      { wantFeedback: true, playerName: "Blue" },
    )
  })

  it("clears stale action state from the next agent request context", async () => {
    const elements = {
      app: document.createElement("div"),
      body: document.createElement("div"),
      controls: [],
      measure: document.createElement("div"),
      screen: document.createElement("div"),
      touchButtons: [],
      touchControls: document.createElement("div"),
    }
    elements.app.focus = vi.fn()

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ moves: ["MoveRight"] }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const dispatch = vi.fn().mockReturnValue(createActionState({
      currentCell: { row: 0, col: 1 },
      lastMoveStatus: "applied",
      submittedMoves: ["0:MoveRight"],
      lastValidMoveIndex: 0,
    }))
    const readActionState = vi.fn(() => createActionState({ level: 1 }))
    const commitAgentTurn = vi.fn(() => createActionState({ level: 1 }))
    const mode = createTestAgentMode(elements)

    mode.bindActionDispatch(dispatch, readActionState, commitAgentTurn)
    mode.recordActionState(createActionState({
      currentCell: { row: 9, col: 9 },
      level: 99,
      lastMoveStatus: "reached-target",
      submittedMoves: ["0:MoveRight"],
    }))
    mode.clearActionState()

    await vi.advanceTimersByTimeAsync(agentMovePollIntervalMs)

    const request = fetchMock.mock.calls[0][1] as RequestInit
    if (typeof request.body !== "string") {
      throw new Error("expected agent request body to be serialized json")
    }

    expect(JSON.parse(request.body)).toEqual(expect.objectContaining({
      currentCell: { row: 0, col: 0 },
      level: 1,
      lastMoveStatus: null,
      submittedMoves: [],
    }))
  })

  it("records a network-disabled agent without score decay", async () => {
    const elements = {
      app: document.createElement("div"),
      body: document.createElement("div"),
      controls: [],
      measure: document.createElement("div"),
      screen: document.createElement("div"),
      touchButtons: [createButton({ action: "pause" })],
      touchControls: document.createElement("div"),
    }
    elements.app.focus = vi.fn()

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network failed")))

    const disableAgentAfterNetworkError = vi.fn()
    const mode = createAgentMode(
      elements,
      enabledAgentConfigs,
      disableAgentAfterNetworkError,
    )

    mode.bindActionDispatch(
      vi.fn(),
      vi.fn(() => createActionState()),
      vi.fn(() => createActionState()),
    )
    await vi.advanceTimersByTimeAsync(agentMovePollIntervalMs)

    expect(disableAgentAfterNetworkError).toHaveBeenCalledWith(
      enabledAgentConfigs()[0],
    )
    expect(mode.readLastActionState()).toEqual(
      expect.objectContaining({
        lastMoveStatus: "network-error",
        decayedMovesCount: 0,
      }),
    )
  })

  it("rebinds local controls without keeping stale listeners alive", () => {
    const elements = {
      app: document.createElement("div"),
      body: document.createElement("div"),
      controls: [],
      measure: document.createElement("div"),
      screen: document.createElement("div"),
      touchButtons: [createButton({ action: "pause" })],
      touchControls: document.createElement("div"),
    }
    elements.app.focus = vi.fn()

    vi.stubGlobal("fetch", vi.fn())

    const firstDispatch = vi.fn()
    const secondDispatch = vi.fn()
    const readActionState = vi.fn().mockReturnValue(
      createActionState({
        currentCell: null,
        destinationCell: null,
        level: 1,
        score: 0,
        status: "boot",
        traversalHistory: [],
      }),
    )

    const mode = createTestAgentMode(elements)

    mode.bindActionDispatch(firstDispatch, readActionState, vi.fn(() => createActionState()))
    mode.bindActionDispatch(secondDispatch, readActionState, vi.fn(() => createActionState()))
    elements.touchButtons[0].click()

    expect(firstDispatch).not.toHaveBeenCalled()
    expect(secondDispatch).toHaveBeenCalledWith({ type: "pause" }, { playerName: "Self" })
  })
})
