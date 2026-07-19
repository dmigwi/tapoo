import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createAgentMode } from "./agent"
import { CONFIG } from "../config"
import {
  loadPersistedAgentApiConfigs,
  savePersistedAgentApiConfigs,
} from "../storage"
import type {
  AgentApiConfig,
  Elements,
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
      id: 1,
      playerName: "Blue",
      model: "llama3.2",
      endpoint: "/configured-agents/blue/move",
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

function createAgentFormElements(): Elements {
  const agentSeatRoster = document.createElement("div")
  const agentConfigForm = document.createElement("form")
  const agentConfigTitle = document.createElement("strong")
  const agentConfigPlayerName = document.createElement("input")
  const agentConfigModel = document.createElement("input")
  const agentConfigEndpoint = document.createElement("input")
  const agentConfigEnabledLabel = document.createElement("label")
  const agentConfigEnabled = document.createElement("input")
  const agentConfigEnabledText = document.createElement("span")
  const agentConfigClose = document.createElement("button")
  const agentConfigStatus = document.createElement("p")
  const agentDeleteDialog = document.createElement("section")
  const agentDeleteTitle = document.createElement("strong")
  const agentDeleteTarget = document.createElement("p")
  const agentDeleteEnabledLabel = document.createElement("label")
  const agentDeleteEnabled = document.createElement("input")
  const agentDeleteEnabledText = document.createElement("span")
  const agentDeleteApply = document.createElement("button")
  const agentDeleteConfirm = document.createElement("input")
  const agentDeleteClose = document.createElement("button")

  agentSeatRoster.hidden = true
  agentConfigForm.hidden = true
  agentConfigForm.noValidate = true
  agentDeleteDialog.hidden = true
  agentConfigEnabledLabel.className = "agent-config-form__toggle"
  agentDeleteEnabledLabel.className = "agent-config-form__toggle"
  agentDeleteEnabled.type = "checkbox"
  agentDeleteConfirm.type = "checkbox"
  agentConfigEnabled.type = "checkbox"
  agentConfigEnabled.checked = true
  agentConfigEnabledText.id = "agent-config-enabled-label"
  agentConfigEnabledLabel.append(agentConfigEnabled, agentConfigEnabledText)
  agentConfigForm.append(
    agentConfigTitle,
    agentConfigPlayerName,
    agentConfigModel,
    agentConfigEndpoint,
    agentConfigEnabledLabel,
    agentConfigClose,
    agentConfigStatus,
  )
  const app = document.createElement("div")
  agentDeleteEnabledText.id = "agent-delete-enabled-label"
  agentDeleteEnabledLabel.append(agentDeleteEnabled, agentDeleteEnabledText)
  agentDeleteDialog.append(
    agentDeleteTitle,
    agentDeleteTarget,
    agentDeleteEnabledLabel,
    agentDeleteApply,
    agentDeleteConfirm,
    agentDeleteClose,
  )
  app.append(agentSeatRoster, agentConfigForm, agentDeleteDialog)

  return {
    app,
    body: document.createElement("div"),
    controls: [],
    measure: document.createElement("div"),
    screen: document.createElement("div"),
    touchButtons: [],
    touchControls: document.createElement("div"),
    agentSeatRoster,
    agentConfigForm,
    agentConfigTitle,
    agentConfigPlayerName,
    agentConfigModel,
    agentConfigEndpoint,
    agentConfigEnabled,
    agentConfigEnabledLabel: agentConfigEnabledText,
    agentConfigClose,
    agentConfigStatus,
    agentDeleteDialog,
    agentDeleteTitle,
    agentDeleteTarget,
    agentDeleteEnabled,
    agentDeleteEnabledLabel: agentDeleteEnabledText,
    agentDeleteApply,
    agentDeleteConfirm,
    agentDeleteClose,
  }
}

function clickAddSeat(elements: Elements, seatId = "1"): void {
  const button = elements.agentSeatRoster?.querySelector<HTMLButtonElement>(
    `[data-agent-seat-add="${seatId}"]`,
  )
  if (!button) {
    throw new Error(`expected empty ${seatId} add button`)
  }

  button.click()
}

function clickDeleteSeat(elements: Elements, seatId: string): void {
  const button = elements.agentSeatRoster?.querySelector<HTMLButtonElement>(
    `[data-agent-seat-delete="${seatId}"]`,
  )
  if (!button) {
    throw new Error(`expected occupied ${seatId} delete button`)
  }

  button.click()
}

function createMemoryStorage(): Storage {
  const entries = new Map<string, string>()

  return {
    get length() {
      return entries.size
    },
    clear: vi.fn(() => {
      entries.clear()
    }),
    getItem: vi.fn((key: string) => entries.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(entries.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      entries.delete(key)
    }),
    setItem: vi.fn((key: string, value: string) => {
      entries.set(key, value)
    }),
  }
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
    vi.stubGlobal("localStorage", createMemoryStorage())
    window.localStorage.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    window.localStorage.clear()
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
      "/configured-agents/blue/move",
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
        key: "Enter",
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

  it("renders compact seats for configured and empty agent slots", () => {
    savePersistedAgentApiConfigs([
      {
        id: 1,
        playerName: "Blue",
        model: "llama3.2",
        endpoint: "/agents/blue/move",
        enabled: true,
      },
      {
        id: 2,
        playerName: "Grey",
        model: "gemma4",
        endpoint: "/agents/grey/move",
        enabled: false,
      },
    ])
    const elements = createAgentFormElements()
    vi.stubGlobal("fetch", vi.fn())

    const mode = createAgentMode(elements)
    mode.bindActionDispatch(
      vi.fn(),
      vi.fn(() => createActionState({ status: "await-agent" })),
      vi.fn(() => createActionState()),
    )

    expect(elements.agentSeatRoster?.hidden).toBe(false)
    expect(elements.agentSeatRoster?.querySelectorAll(".agent-seat")).toHaveLength(
      CONFIG.agentConfig.maxSeats,
    )
    expect(
      elements.agentSeatRoster
        ?.querySelector('[data-agent-seat-id="1"]')
        ?.getAttribute("title"),
    ).toBe("Blue")
    expect(
      elements.agentSeatRoster
        ?.querySelector('[data-agent-seat-id="2"]')
        ?.getAttribute("title"),
    ).toBe("Grey")
    expect(
      elements.agentSeatRoster
        ?.querySelector('[data-agent-seat-id="2"]')
        ?.classList.contains("agent-seat--disabled"),
    ).toBe(true)
    expect(
      elements.agentSeatRoster?.querySelectorAll("[data-agent-seat-add]"),
    ).toHaveLength(CONFIG.agentConfig.maxSeats - 2)
  })

  it("opens delete confirmation for an inactive occupied seat", () => {
    savePersistedAgentApiConfigs([
      {
        id: 1,
        playerName: "Blue",
        model: "llama3.2",
        endpoint: "/agents/blue/move",
        enabled: true,
      },
      {
        id: 2,
        playerName: "Red",
        model: "gemma4",
        endpoint: "/agents/red/move",
        enabled: true,
      },
    ])
    const elements = createAgentFormElements()
    const dispatch = vi.fn()
    vi.stubGlobal("fetch", vi.fn())

    const mode = createAgentMode(elements)
    mode.bindActionDispatch(
      dispatch,
      vi.fn(() => createActionState({ status: "running" })),
      vi.fn(() => createActionState()),
    )

    clickDeleteSeat(elements, "2")

    expect(dispatch).toHaveBeenCalledWith(
      { type: "pause" },
      { playerName: "Self" },
    )
    expect(elements.agentDeleteDialog?.hidden).toBe(false)
    expect(elements.agentDeleteTitle?.textContent).toBe(
      "Manage player Red in seat 02",
    )
    expect(elements.agentDeleteTarget?.textContent).toBe("Delete now?")
    expect(elements.agentDeleteConfirm?.checked).toBe(false)

    elements.agentDeleteConfirm.checked = true
    elements.agentDeleteConfirm.dispatchEvent(new Event("change"))
    expect(elements.agentDeleteEnabled?.disabled).toBe(true)
    expect(
      elements.agentDeleteEnabled
        ?.closest(".agent-config-form__toggle")
        ?.classList.contains("agent-config-form__toggle--disabled"),
    ).toBe(true)

    elements.agentDeleteConfirm.checked = false
    elements.agentDeleteConfirm.dispatchEvent(new Event("change"))
    expect(elements.agentDeleteEnabled?.disabled).toBe(false)
  })

  it("deletes only the selected non-current agent after confirmation", () => {
    savePersistedAgentApiConfigs([
      {
        id: 1,
        playerName: "Blue",
        model: "llama3.2",
        endpoint: "/agents/blue/move",
        enabled: true,
      },
      {
        id: 2,
        playerName: "Red",
        model: "gemma4",
        endpoint: "/agents/red/move",
        enabled: true,
      },
    ])
    const elements = createAgentFormElements()
    vi.stubGlobal("fetch", vi.fn())

    const mode = createAgentMode(elements)
    mode.bindActionDispatch(
      vi.fn(),
      vi.fn(() => createActionState({ status: "await-agent" })),
      vi.fn(() => createActionState()),
    )

    clickDeleteSeat(elements, "2")
    elements.agentDeleteConfirm.checked = true
    elements.agentDeleteApply?.click()

    expect(loadPersistedAgentApiConfigs()).toEqual([
      expect.objectContaining({ id: 1, playerName: "Blue" }),
    ])
    expect(elements.agentSeatRoster?.querySelector('[data-agent-seat-add="2"]')).not.toBeNull()
  })

  it("updates an occupied agent enabled state from the manage dialog", () => {
    savePersistedAgentApiConfigs([
      {
        id: 1,
        playerName: "Blue",
        model: "llama3.2",
        endpoint: "/agents/blue/move",
        enabled: false,
      },
    ])
    const elements = createAgentFormElements()
    vi.stubGlobal("fetch", vi.fn())

    const mode = createAgentMode(elements)
    mode.bindActionDispatch(
      vi.fn(),
      vi.fn(() => createActionState({ status: "await-agent" })),
      vi.fn(() => createActionState()),
    )

    clickDeleteSeat(elements, "1")
    expect(elements.agentDeleteEnabled?.checked).toBe(false)
    expect(elements.agentDeleteEnabledLabel?.textContent).toBe(
      CONFIG.agentConfig.agentDisabledLabel,
    )

    elements.agentDeleteEnabled.checked = true
    elements.agentDeleteEnabled.dispatchEvent(new Event("change"))
    expect(elements.agentDeleteEnabledLabel?.textContent).toBe(
      CONFIG.agentConfig.agentEnabledLabel,
    )
    elements.agentDeleteApply?.click()

    expect(loadPersistedAgentApiConfigs()).toEqual([
      expect.objectContaining({ id: 1, enabled: true }),
    ])
    expect(elements.agentDeleteDialog?.hidden).toBe(true)
    expect(
      elements.agentSeatRoster
        ?.querySelector('[data-agent-seat-id="1"]')
        ?.classList.contains("agent-seat--disabled"),
    ).toBe(false)
  })

  it("marks the currently playing agent seat and disables direct deletion", async () => {
    savePersistedAgentApiConfigs([
      {
        id: 1,
        playerName: "Blue",
        model: "llama3.2",
        endpoint: "/agents/blue/move",
        enabled: true,
      },
      {
        id: 2,
        playerName: "Red",
        model: "gemma4",
        endpoint: "/agents/red/move",
        enabled: true,
      },
    ])
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ moves: ["MoveRight"] }),
    })
    vi.stubGlobal("fetch", fetchMock)
    const elements = createAgentFormElements()

    const mode = createAgentMode(elements)
    mode.bindActionDispatch(
      vi.fn(() => createActionState({ lastMoveStatus: "applied" })),
      vi.fn(() => createActionState({ status: "running" })),
      vi.fn(() => createActionState()),
    )

    await vi.advanceTimersByTimeAsync(agentMovePollIntervalMs)

    expect(
      elements.agentSeatRoster
        ?.querySelector('[data-agent-seat-id="1"]')
        ?.classList.contains("agent-seat--active"),
    ).toBe(true)
    expect(
      elements.agentSeatRoster?.querySelector('[data-agent-seat-delete="1"]'),
    ).toBeNull()
    expect(
      elements.agentSeatRoster?.querySelector<HTMLButtonElement>(
        '[data-agent-seat-id="1"]',
      )?.disabled,
    ).toBe(true)
  })

  it("opens the agent configuration form from an empty seat", () => {
    const elements = createAgentFormElements()
    const focusPlayerName = vi.fn()
    elements.agentConfigPlayerName.focus = focusPlayerName
    vi.stubGlobal("fetch", vi.fn())

    const mode = createTestAgentMode(elements)
    mode.bindActionDispatch(
      vi.fn(),
      vi.fn(() => createActionState({ status: "await-agent" })),
      vi.fn(() => createActionState()),
    )

    clickAddSeat(elements, "2")

    expect(elements.agentConfigForm?.hidden).toBe(false)
    expect(elements.agentConfigTitle?.textContent).toBe("Add agent to seat 02")
    expect(elements.agentConfigEnabledLabel?.textContent).toBe(
      CONFIG.agentConfig.agentEnabledLabel,
    )

    elements.agentConfigEnabled.checked = false
    elements.agentConfigEnabled.dispatchEvent(new Event("change"))

    expect(elements.agentConfigEnabledLabel?.textContent).toBe(
      CONFIG.agentConfig.agentDisabledLabel,
    )
    expect(
      elements.agentConfigEnabled
        ?.closest(".agent-config-form__toggle")
        ?.classList.contains("agent-config-form__toggle--off"),
    ).toBe(true)
    expect(
      elements.body.classList.contains("terminal-body--agent-form-active"),
    ).toBe(true)
    expect(focusPlayerName).toHaveBeenCalled()
  })

  it("keeps focus inside the agent configuration form while it is open", () => {
    const elements = createAgentFormElements()
    const focus = vi.fn()
    elements.app.focus = focus
    vi.stubGlobal("fetch", vi.fn())

    const mode = createTestAgentMode(elements)
    mode.bindActionDispatch(
      vi.fn(),
      vi.fn(() => createActionState({ status: "await-agent" })),
      vi.fn(() => createActionState()),
    )

    clickAddSeat(elements, "2")
    focus.mockClear()
    elements.agentConfigPlayerName.click()

    expect(elements.agentConfigForm?.hidden).toBe(false)
    expect(focus).not.toHaveBeenCalled()
  })

  it("ignores session shortcuts while typing in the agent configuration form", () => {
    const elements = createAgentFormElements()
    const dispatch = vi.fn()
    vi.stubGlobal("fetch", vi.fn())
    document.body.append(elements.app)

    const mode = createTestAgentMode(elements)
    mode.bindActionDispatch(
      dispatch,
      vi.fn(() => createActionState({ status: "await-agent" })),
      vi.fn(() => createActionState()),
    )

    clickAddSeat(elements, "2")
    for (const event of [
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }),
      new KeyboardEvent("keydown", { key: "b", ctrlKey: true, bubbles: true, cancelable: true }),
    ]) {
      elements.agentConfigPlayerName.dispatchEvent(event)
    }

    expect(dispatch).not.toHaveBeenCalled()
    expect(elements.agentConfigForm?.hidden).toBe(false)
    elements.app.remove()
  })

  it("closes the active agent form with Escape without dispatching pause", () => {
    const elements = createAgentFormElements()
    const dispatch = vi.fn()
    vi.stubGlobal("fetch", vi.fn())
    document.body.append(elements.app)

    const mode = createTestAgentMode(elements)
    mode.bindActionDispatch(
      dispatch,
      vi.fn(() => createActionState({ status: "await-agent" })),
      vi.fn(() => createActionState()),
    )

    clickAddSeat(elements, "2")
    elements.agentConfigPlayerName.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    )

    expect(dispatch).not.toHaveBeenCalled()
    expect(elements.agentConfigForm?.hidden).toBe(true)
    expect(
      elements.body.classList.contains("terminal-body--agent-form-active"),
    ).toBe(false)
    elements.app.remove()
  })

  it("pauses a running agent game before opening the add form", () => {
    const elements = createAgentFormElements()
    const dispatch = vi.fn()
    vi.stubGlobal("fetch", vi.fn())

    const mode = createTestAgentMode(elements)
    mode.bindActionDispatch(
      dispatch,
      vi.fn(() => createActionState({ status: "running" })),
      vi.fn(() => createActionState()),
    )

    clickAddSeat(elements, "2")

    expect(dispatch).toHaveBeenCalledWith(
      { type: "pause" },
      { playerName: "Self" },
    )
    expect(elements.agentConfigForm?.hidden).toBe(false)
    expect(
      elements.body.classList.contains("terminal-body--agent-form-active"),
    ).toBe(true)
  })

  it("closes and resets the agent configuration form from the close button", () => {
    const elements = createAgentFormElements()
    elements.agentConfigPlayerName.value = "Draft"
    elements.agentConfigStatus.textContent = "Working"
    vi.stubGlobal("fetch", vi.fn())

    const mode = createTestAgentMode(elements)
    mode.bindActionDispatch(
      vi.fn(),
      vi.fn(() => createActionState({ status: "await-agent" })),
      vi.fn(() => createActionState()),
    )

    clickAddSeat(elements, "2")
    elements.agentConfigClose.click()

    expect(elements.agentConfigForm?.hidden).toBe(true)
    expect(elements.agentConfigPlayerName.value).toBe("")
    expect(elements.agentConfigEnabled.checked).toBe(true)
    expect(elements.agentConfigStatus.textContent).toBe("")
    expect(
      elements.body.classList.contains("terminal-body--agent-form-active"),
    ).toBe(false)
  })

  it("closes the agent configuration form when the dimmed outer area is clicked", () => {
    const elements = createAgentFormElements()
    vi.stubGlobal("fetch", vi.fn())

    const mode = createTestAgentMode(elements)
    mode.bindActionDispatch(
      vi.fn(),
      vi.fn(() => createActionState({ status: "await-agent" })),
      vi.fn(() => createActionState()),
    )

    clickAddSeat(elements, "2")
    elements.body.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    )

    expect(elements.agentConfigForm?.hidden).toBe(true)
    expect(
      elements.body.classList.contains("terminal-body--agent-form-active"),
    ).toBe(false)
  })

  it("persists a newly configured agent from an empty seat", () => {
    const elements = createAgentFormElements()
    const readAgentConfigs = vi.fn(loadPersistedAgentApiConfigs)
    elements.agentConfigPlayerName.value = "Scout"
    elements.agentConfigModel.value = "gemma4"
    elements.agentConfigEndpoint.value = "localhost:5000"
    vi.stubGlobal("fetch", vi.fn())

    const mode = createAgentMode(elements, readAgentConfigs)
    mode.bindActionDispatch(
      vi.fn(),
      vi.fn(() => createActionState({ status: "await-agent" })),
      vi.fn(() => createActionState()),
    )

    clickAddSeat(elements, "1")
    elements.agentConfigForm?.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    )

    expect(loadPersistedAgentApiConfigs()).toEqual([
      expect.objectContaining({
        id: 1,
        playerName: "Scout",
        model: "gemma4",
        endpoint: "http://localhost:5000/",
        enabled: true,
      }),
    ])
    expect(elements.agentConfigForm.hidden).toBe(true)
    expect(elements.agentConfigStatus.textContent).toBe("")
    expect(
      elements.agentSeatRoster?.querySelector('[data-agent-seat-id="1"]')
        ?.getAttribute("title"),
    ).toBe("Scout")
  })

  it("shows required-field errors at the bottom of the agent form", () => {
    const elements = createAgentFormElements()
    const readAgentConfigs = vi.fn((): AgentApiConfig[] => [])
    elements.agentConfigPlayerName.value = "Scout"
    elements.agentConfigModel.value = ""
    elements.agentConfigEndpoint.value = "https://agents.example/scout/move"
    vi.stubGlobal("fetch", vi.fn())

    const mode = createAgentMode(elements, readAgentConfigs)
    mode.bindActionDispatch(
      vi.fn(),
      vi.fn(() => createActionState({ status: "await-agent" })),
      vi.fn(() => createActionState()),
    )

    clickAddSeat(elements, "1")
    elements.agentConfigForm?.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    )

    expect(loadPersistedAgentApiConfigs()).toEqual([])
    expect(elements.agentConfigStatus?.textContent).toBe(
      CONFIG.agentConfig.invalidMessage,
    )
    expect(
      elements.agentConfigStatus?.classList.contains(
        "agent-config-form__status--error",
      ),
    ).toBe(true)
  })

  it("shows required-field errors when every agent input is empty", () => {
    const elements = createAgentFormElements()
    const readAgentConfigs = vi.fn((): AgentApiConfig[] => [])
    vi.stubGlobal("fetch", vi.fn())

    const mode = createAgentMode(elements, readAgentConfigs)
    mode.bindActionDispatch(
      vi.fn(),
      vi.fn(() => createActionState({ status: "await-agent" })),
      vi.fn(() => createActionState()),
    )

    clickAddSeat(elements, "1")
    elements.agentConfigForm?.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    )

    expect(loadPersistedAgentApiConfigs()).toEqual([])
    expect(elements.agentConfigStatus?.textContent).toBe(
      CONFIG.agentConfig.invalidMessage,
    )
    expect(
      elements.agentConfigStatus?.classList.contains(
        "agent-config-form__status--error",
      ),
    ).toBe(true)
  })

  it("rejects agent endpoints that are not http or https URLs", () => {
    const elements = createAgentFormElements()
    const readAgentConfigs = vi.fn((): AgentApiConfig[] => [])
    elements.agentConfigPlayerName.value = "Scout"
    elements.agentConfigModel.value = "gemma4"
    elements.agentConfigEndpoint.value = "/agents/scout/move"
    vi.stubGlobal("fetch", vi.fn())

    const mode = createAgentMode(elements, readAgentConfigs)
    mode.bindActionDispatch(
      vi.fn(),
      vi.fn(() => createActionState({ status: "await-agent" })),
      vi.fn(() => createActionState()),
    )

    clickAddSeat(elements, "1")
    elements.agentConfigForm?.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    )

    expect(loadPersistedAgentApiConfigs()).toEqual([])
    expect(elements.agentConfigStatus?.textContent).toBe(
      CONFIG.agentConfig.invalidEndpointMessage,
    )
    expect(
      elements.agentConfigStatus?.classList.contains(
        "agent-config-form__status--error",
      ),
    ).toBe(true)
  })

  it("shows player-name length errors outside the compact label range", () => {
    const elements = createAgentFormElements()
    const readAgentConfigs = vi.fn((): AgentApiConfig[] => [])
    elements.agentConfigPlayerName.value = "TooLongName"
    elements.agentConfigModel.value = "gemma4"
    elements.agentConfigEndpoint.value = "https://agents.example/long/move"
    vi.stubGlobal("fetch", vi.fn())

    const mode = createAgentMode(elements, readAgentConfigs)
    mode.bindActionDispatch(
      vi.fn(),
      vi.fn(() => createActionState({ status: "await-agent" })),
      vi.fn(() => createActionState()),
    )

    clickAddSeat(elements, "1")
    elements.agentConfigForm?.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    )

    expect(loadPersistedAgentApiConfigs()).toEqual([])
    expect(elements.agentConfigStatus?.textContent).toBe(
      CONFIG.agentConfig.playerNameLengthMessage,
    )
    expect(
      elements.agentConfigStatus?.classList.contains(
        "agent-config-form__status--error",
      ),
    ).toBe(true)
  })

  it("shows a player-name error when the configured player already exists", () => {
    const elements = createAgentFormElements()
    const readAgentConfigs = vi.fn((): AgentApiConfig[] => [
      {
        id: 1,
        playerName: "Scout",
        model: "llama3.2",
        endpoint: "https://agents.example/scout/move",
        enabled: true,
      },
    ])
    elements.agentConfigPlayerName.value = " scout "
    elements.agentConfigModel.value = "gemma4"
    elements.agentConfigEndpoint.value = "https://agents.example/scout-copy/move"
    vi.stubGlobal("fetch", vi.fn())

    const mode = createAgentMode(elements, readAgentConfigs)
    mode.bindActionDispatch(
      vi.fn(),
      vi.fn(() => createActionState({ status: "await-agent" })),
      vi.fn(() => createActionState()),
    )

    clickAddSeat(elements, "2")
    elements.agentConfigForm?.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    )

    expect(loadPersistedAgentApiConfigs()).toEqual([])
    expect(elements.agentConfigStatus?.textContent).toBe(
      CONFIG.agentConfig.duplicatePlayerNameMessage,
    )
    expect(
      elements.agentConfigStatus?.classList.contains(
        "agent-config-form__status--error",
      ),
    ).toBe(true)
  })

  it("persists a disabled agent when the form toggle is off", () => {
    const elements = createAgentFormElements()
    const readAgentConfigs = vi.fn((): AgentApiConfig[] => [])
    elements.agentConfigPlayerName.value = "Observer"
    elements.agentConfigModel.value = "llama3.2"
    elements.agentConfigEndpoint.value = "https://agents.example/observer/move"
    elements.agentConfigEnabled.checked = false
    vi.stubGlobal("fetch", vi.fn())

    const mode = createAgentMode(elements, readAgentConfigs)
    mode.bindActionDispatch(
      vi.fn(),
      vi.fn(() => createActionState({ status: "await-agent" })),
      vi.fn(() => createActionState()),
    )

    clickAddSeat(elements, "1")
    elements.agentConfigForm?.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    )

    expect(loadPersistedAgentApiConfigs()).toEqual([
      expect.objectContaining({
        playerName: "Observer",
        enabled: false,
      }),
    ])
    expect(elements.agentConfigEnabled.checked).toBe(true)
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
