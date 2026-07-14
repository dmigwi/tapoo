import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createAgentMode } from "./agent"
import { CONFIG, coreDecayIntervalPerCellMs } from "../config"
import type { MazeAction, MazeActionDispatchOptions } from "../types"

const agentMovePollIntervalMs =
  coreDecayIntervalPerCellMs("agent-api") * CONFIG.timing.agentMovePollSlackFactor

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
      json: vi.fn().mockResolvedValue({ direction: "MoveRight" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const dispatch = vi
      .fn()
      .mockReturnValueOnce({
        expectedResponseType: "MoveAction",
        instruction: "Choose the next MoveAction.",
        lastCommand: { type: "MoveRight" },
        lastCommandStatus: "applied",
        lastCommandMessage: "MoveRight applied.",
        visitedBefore: false,
      })

    const readAgentContext = vi
      .fn()
      .mockReturnValue({
        currentCell: { row: 0, col: 0 },
        destinationCell: { row: 0, col: 2 },
        level: 4,
        score: 800,
        status: "running",
        traversalHistory: [{ row: 0, col: 0 }],
      })

    const mode = createAgentMode(elements)

    mode.bindActionDispatch(dispatch, readAgentContext)
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
      expectedResponseType: null,
      instruction: null,
      lastCommand: null,
      lastCommandMessage: null,
      lastCommandStatus: null,
      level: 4,
      score: 800,
      status: "running",
      traversalHistory: [{ row: 0, col: 0 }],
      visitedBefore: null,
    })
    expect(dispatch).toHaveBeenCalledWith(
      { type: "MoveRight" },
      { wantFeedback: true },
    )
    expect(mode.readLastActionState()).toEqual({
      expectedResponseType: "MoveAction",
      instruction: "Choose the next MoveAction.",
      lastCommand: { type: "MoveRight" },
      lastCommandStatus: "applied",
      lastCommandMessage: "MoveRight applied.",
      visitedBefore: false,
    })
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
    const readAgentContext = vi.fn().mockReturnValue({
      currentCell: { row: 0, col: 0 },
      destinationCell: { row: 0, col: 1 },
      level: 1,
      score: 100,
      status: "paused",
      traversalHistory: [{ row: 0, col: 0 }],
    })

    const mode = createAgentMode(elements)

    mode.bindActionDispatch(dispatch, readAgentContext)
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

    expect(dispatch).toHaveBeenNthCalledWith(1, { type: "cycle-walls" })
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: "proceed" })
    expect(dispatch).toHaveBeenNthCalledWith(3, { type: "pause" })
    expect(dispatch).toHaveBeenNthCalledWith(4, { type: "cycle-walls" })
    expect(dispatch).toHaveBeenNthCalledWith(5, { type: "proceed" })
    expect(dispatch).toHaveBeenNthCalledWith(6, { type: "pause" })
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
      json: vi.fn().mockResolvedValue({ direction: "MoveRight" }),
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
          expectedResponseType: "MoveAction" as const,
          instruction: "Choose the next MoveAction.",
          lastCommand: { type: "MoveRight" as const },
          lastCommandStatus: "applied" as const,
          lastCommandMessage: "MoveRight applied.",
          visitedBefore: false,
        }
      }

      return null
    })
    const readAgentContext = vi.fn(() => ({
      currentCell: { row: 0, col: 0 },
      destinationCell: { row: 0, col: 2 },
      level: 1,
      score: 100,
      status,
      traversalHistory: [{ row: 0, col: 0 }],
    }))

    const mode = createAgentMode(elements)

    mode.bindActionDispatch(dispatch, readAgentContext)
    await vi.advanceTimersByTimeAsync(agentMovePollIntervalMs)
    expect(fetchMock).not.toHaveBeenCalled()

    elements.touchButtons[0].click()
    await vi.advanceTimersByTimeAsync(agentMovePollIntervalMs)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenNthCalledWith(1, { type: "proceed" })
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: "MoveRight" }, { wantFeedback: true })
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
    const readAgentContext = vi.fn().mockReturnValue({
      currentCell: null,
      destinationCell: null,
      level: 1,
      score: 0,
      status: "boot",
      traversalHistory: [],
    })

    const mode = createAgentMode(elements)

    mode.bindActionDispatch(firstDispatch, readAgentContext)
    mode.bindActionDispatch(secondDispatch, readAgentContext)
    elements.touchButtons[0].click()

    expect(firstDispatch).not.toHaveBeenCalled()
    expect(secondDispatch).toHaveBeenCalledWith({ type: "pause" })
  })
})
