import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createAgentMode } from "./agent"
import { CONFIG } from "../config"
import { logTapooDiagnostic, tapooResetLogs } from "../logs"
import {
  loadTapooLog,
  loadPersistedAgentApiConfigs,
  savePersistedAgentApiConfigs,
} from "../storage"
import type {
  AgentApiConfig,
  AgentElements,
  Elements,
  MazeAction,
  MazeActionDispatchOptions,
  MazeActionResult,
  GameStatus,
  State,
  TraversalHistoryEntry,
} from "../types"

function enabledAgentConfigs(): AgentApiConfig[] {
  return [
    {
      id: 1,
      playerName: "Blue",
      model: "llama3.2",
      endpoint: new URL("https://agents.example/blue/move"),
      api: "ollama",
      enabled: true,
    },
  ]
}

function createTestAgentMode(elements: Parameters<typeof createAgentMode>[0]) {
  return createAgentMode(elements, enabledAgentConfigs)
}

async function flushImmediateAgentTurn(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

function visit(row: number, col: number): TraversalHistoryEntry {
  return { playerName: "Blue", row, col, openMoves: [] }
}

function selfVisit(row: number, col: number): TraversalHistoryEntry {
  return { playerName: CONFIG.runtime.interactivePlayerName, row, col, openMoves: [] }
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

// AgentFormElements is the return shape of createAgentFormElements: every agent-api overlay
// handle is populated, so tests can address them without re-checking each optional ref. Declaring
// it as Required<AgentElements> rather than Elements also makes the fixture fail to compile if a
// new agent handle is added to the type without being built here.
type AgentFormElements = Elements & Required<AgentElements>

function createAgentFormElements(): AgentFormElements {
  const agentSeatsBody = document.createElement("div")
  const tapooLogsReset = document.createElement("button")
  const tapooLogsDownload = document.createElement("button")
  const agentSeatRoster = document.createElement("div")
  const agentConfigForm = document.createElement("form")
  const agentConfigTitle = document.createElement("strong")
  const agentConfigPlayerName = document.createElement("input")
  const agentConfigModel = document.createElement("input")
  const agentConfigApi = document.createElement("select")
  const agentConfigEndpoint = document.createElement("input")
  const agentConfigCredential = document.createElement("input")
  const agentConfigCredentialLabel = document.createElement("span")
  const agentConfigCredentialRequired = document.createElement("span")
  const agentConfigApiVersionField = document.createElement("label")
  const agentConfigApiVersion = document.createElement("input")
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
  agentSeatsBody.hidden = true
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
  ;["ollama", "openai", "anthropic"].forEach((value) => {
    const option = document.createElement("option")
    option.value = value
    agentConfigApi.append(option)
  })
  agentConfigApi.value = "ollama"
  agentConfigCredentialRequired.hidden = true
  agentConfigApiVersionField.hidden = true
  agentConfigApiVersionField.append(agentConfigApiVersion)
  agentConfigForm.append(
    agentConfigTitle,
    agentConfigPlayerName,
    agentConfigModel,
    agentConfigApi,
    agentConfigEndpoint,
    agentConfigCredential,
    agentConfigCredentialLabel,
    agentConfigCredentialRequired,
    agentConfigApiVersionField,
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
  app.append(agentSeatsBody, agentConfigForm, agentDeleteDialog)
  agentSeatsBody.append(tapooLogsReset, tapooLogsDownload, agentSeatRoster)

  return {
    app,
    body: document.createElement("div"),
    controls: [],
    measure: document.createElement("div"),
    screen: document.createElement("div"),
    touchButtons: [],
    touchControls: document.createElement("div"),
    agentSeatsBody,
    tapooLogsReset,
    tapooLogsDownload,
    agentSeatRoster,
    agentConfigForm,
    agentConfigTitle,
    agentConfigPlayerName,
    agentConfigModel,
    agentConfigApi,
    agentConfigEndpoint,
    agentConfigCredential,
    agentConfigCredentialLabel,
    agentConfigCredentialRequired,
    agentConfigApiVersionField,
    agentConfigApiVersion,
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

type AgentControlFixture = State & MazeActionResult & Record<string, unknown>

type AgentRoundLogDetails = {
  agent: {
    model: string
    playerName: string
  }
  lastActionResult: Pick<MazeActionResult, "lastMoveStatus">
  lastRoundScore: number
  level: number
  outcome: "won" | "lost"
  score: number
  uniqueCellsVisited: number
  winSummary: string
}

type AgentRoundLogEntry = {
  details: AgentRoundLogDetails
  payload: string
  type: string
}

function createControlFixture(
  overrides: Partial<AgentControlFixture> = {},
): AgentControlFixture {
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
    level: 4,
    maze: null,
    mazeDimensions: { numCols: 3, numRows: 1, area: 3 },
    startPosition: { x: 1, y: 1 },
    playerPosition: { x: 1, y: 1 },
    score: 800,
    scoreDecayUnits: 0,
    status: "running",
    traversalHistory: [selfVisit(0, 0)],
    wallWeight: 1,
    winSummary: "",
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
    tapooResetLogs("agent-api")
    vi.restoreAllMocks()
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
      json: vi.fn().mockResolvedValue({
        message: {
          role: "assistant",
          content: "{\"moves\":[\"MoveRight\",\"MoveDown\"]}",
        },
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const dispatch = vi
      .fn()
      .mockReturnValueOnce(createControlFixture({
        currentCell: { row: 0, col: 1 },
        traversalHistory: [selfVisit(0, 0), visit(0, 1)],
        lastMoveStatus: "applied",
        lastSubmittedMoves: ["0:MoveRight"],
        lastAppliedMoveIndex: 0,
        visitedBefore: false,
      }))
      .mockReturnValueOnce(createControlFixture({
        currentCell: { row: 1, col: 1 },
        traversalHistory: [selfVisit(0, 0), visit(0, 1), visit(1, 1)],
        lastMoveStatus: "applied",
        lastSubmittedMoves: ["0:MoveDown"],
        lastAppliedMoveIndex: 0,
        visitedBefore: false,
      }))

    const readState = vi.fn().mockReturnValue(createControlFixture())
    const commitAgentTurn = vi.fn((chargedMovesCount: number) =>
      createControlFixture({
        currentCell: { row: 1, col: 1 },
        score: 800 - chargedMovesCount * 100,
      }),
    )

    const mode = createTestAgentMode(elements)

    mode.bindActionDispatch(dispatch, readState, commitAgentTurn)
    await flushImmediateAgentTurn()

    expect(fetchMock).toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://agents.example/blue/move"),
      expect.objectContaining({
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
      }),
    )
    const request = fetchMock.mock.calls[0][1] as RequestInit

    if (typeof request.body !== "string") {
      throw new Error("expected agent request body to be serialized json")
    }

    expect(JSON.parse(request.body)).toEqual(expect.objectContaining({
      model: "llama3.2",
      stream: false,
      think: false,
    }))
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
      1,
    )
    expect(commitAgentTurn).toHaveBeenCalledTimes(1)
    expect(mode.readLastActionResult()).toEqual(
      expect.objectContaining({
        currentCell: { row: 1, col: 1 },
        lastMoveStatus: "applied",
        lastSubmittedMoves: ["0:MoveRight", "1:MoveDown"],
        lastAppliedMoveIndex: 1,
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
      json: vi.fn().mockResolvedValue({
        message: { role: "assistant", content: "{\"moves\":[\"MoveRight\"]}" },
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const dispatch = vi.fn().mockReturnValueOnce(createControlFixture({
      currentCell: { row: 0, col: 1 },
      traversalHistory: [selfVisit(0, 0), visit(0, 1)],
      lastMoveStatus: "applied",
      lastSubmittedMoves: ["0:MoveRight"],
      lastAppliedMoveIndex: 0,
      visitedBefore: false,
    }))

    const readState = vi.fn().mockReturnValue(createControlFixture())
    const commitAgentTurn = vi.fn((chargedMovesCount: number) =>
      createControlFixture({
        currentCell: { row: 0, col: 1 },
        score: 800 - chargedMovesCount * 100,
      }),
    )

    const mode = createTestAgentMode(elements)

    mode.bindActionDispatch(dispatch, readState, commitAgentTurn)
    await flushImmediateAgentTurn()

    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(commitAgentTurn).toHaveBeenCalledWith(1)
    expect(mode.readLastActionResult()).toEqual(
      expect.objectContaining({
        currentCell: { row: 0, col: 1 },
        lastMoveStatus: "applied",
        lastSubmittedMoves: ["0:MoveRight"],
        lastAppliedMoveIndex: 0,
        chargedMovesCount: 1,
      }),
    )
  })

  it("logs final round payload when an agent wins the level", async () => {
    const elements = createAgentFormElements()
    savePersistedAgentApiConfigs(enabledAgentConfigs())
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          message: { role: "assistant", content: "{\"moves\":[\"MoveRight\"]}" },
        }),
      }),
    )

    let state = createControlFixture({ status: "running", score: 800 })
    const dispatch = vi.fn(() =>
      createControlFixture({
        currentCell: { row: 0, col: 1 },
        lastMoveStatus: "reached-target",
      }),
    )
    const commitAgentTurn = vi.fn(() => {
      state = createControlFixture({
        turnCount: 1,
        cumulativeRoundCount: 1,
        lastRoundScore: 700,
        score: 700,
        status: "won",
        winSummary: "New record",
      })
    })

    const mode = createAgentMode(elements)
    mode.bindActionDispatch(dispatch, () => state, commitAgentTurn)
    await flushImmediateAgentTurn()

    const logEntries = loadTapooLog<AgentRoundLogEntry>(CONFIG.runtime.controlModes.agentApi)
    const lastEntry = logEntries[logEntries.length - 1]
    expect(lastEntry.payload).toBe("Agent level won.")
    expect(lastEntry.type).toBe("info")
    expect(lastEntry.details.outcome).toBe("won")
    expect(lastEntry.details.level).toBe(4)
    expect(lastEntry.details.score).toBe(700)
    expect(lastEntry.details.lastRoundScore).toBe(700)
    expect(lastEntry.details.winSummary).toBe("New record")
    expect(lastEntry.details.agent.playerName).toBe("Blue")
    expect(lastEntry.details.agent.model).toBe("llama3.2")
    expect(lastEntry.details.lastActionResult.lastMoveStatus).toBe("reached-target")
    // Summarised rather than embedded: the entry carries the visited-cell count, not the trail.
    // The fixture records only the start cell, so the count is 1.
    expect(lastEntry.details.uniqueCellsVisited).toBe(1)
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
        message: {
          role: "assistant",
          content: "{\"moves\":[\"MoveRight\",\"MoveDown\",\"MoveLeft\"]}",
        },
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const dispatch = vi
      .fn()
      .mockReturnValueOnce(createControlFixture({
        currentCell: { row: 0, col: 1 },
        traversalHistory: [selfVisit(0, 0), visit(0, 1)],
        lastMoveStatus: "applied",
        lastSubmittedMoves: ["0:MoveRight"],
        lastAppliedMoveIndex: 0,
        visitedBefore: false,
      }))
      .mockReturnValueOnce(createControlFixture({
        currentCell: { row: 0, col: 1 },
        traversalHistory: [selfVisit(0, 0), visit(0, 1)],
        lastMoveStatus: "invalid-move",
        lastSubmittedMoves: ["1:MoveDown"],
        lastAppliedMoveIndex: 0,
        visitedBefore: true,
      }))

    const readState = vi.fn().mockReturnValue(createControlFixture())
    const commitAgentTurn = vi.fn((chargedMovesCount: number) =>
      createControlFixture({
        currentCell: { row: 0, col: 1 },
        score: 800 - chargedMovesCount * 100,
      }),
    )

    const mode = createTestAgentMode(elements)

    mode.bindActionDispatch(dispatch, readState, commitAgentTurn)
    await flushImmediateAgentTurn()

    expect(dispatch).toHaveBeenCalledTimes(2)
    expect(commitAgentTurn).toHaveBeenCalledWith(
      3,
    )
    expect(mode.readLastActionResult()).toEqual(
      expect.objectContaining({
        currentCell: { row: 0, col: 1 },
        lastMoveStatus: "invalid-move",
        lastSubmittedMoves: ["0:MoveRight", "1:MoveDown", "2:MoveLeft"],
        lastAppliedMoveIndex: 0,
        chargedMovesCount: 3,
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
        message: {
          role: "assistant",
          content: "{\"moves\":[\"MoveRight\",\"MoveDown\",\"MoveLeft\"]}",
        },
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const dispatch = vi.fn().mockReturnValueOnce(createControlFixture({
      currentCell: { row: 0, col: 1 },
      destinationCell: { row: 0, col: 1 },
      traversalHistory: [selfVisit(0, 0), visit(0, 1)],
      lastMoveStatus: "reached-target",
      lastSubmittedMoves: ["0:MoveRight"],
      lastAppliedMoveIndex: 0,
      visitedBefore: false,
      status: "won",
    }))

    const readState = vi.fn().mockReturnValue(createControlFixture())
    const commitAgentTurn = vi.fn((chargedMovesCount: number) =>
      createControlFixture({
        currentCell: { row: 0, col: 1 },
        destinationCell: { row: 0, col: 1 },
        score: 800 - chargedMovesCount * 100,
        status: "won",
      }),
    )

    const mode = createTestAgentMode(elements)

    mode.bindActionDispatch(dispatch, readState, commitAgentTurn)
    await flushImmediateAgentTurn()

    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith(
      { type: "MoveRight" },
      { wantFeedback: true, playerName: "Blue" },
    )
    expect(commitAgentTurn).toHaveBeenCalledWith(1)
    expect(mode.readLastActionResult()).toEqual(
      expect.objectContaining({
        currentCell: { row: 0, col: 1 },
        destinationCell: { row: 0, col: 1 },
        lastMoveStatus: "reached-target",
        lastSubmittedMoves: ["0:MoveRight", "1:MoveDown", "2:MoveLeft"],
        lastAppliedMoveIndex: 0,
        chargedMovesCount: 1,
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
    const readState = vi.fn().mockReturnValue(
      createControlFixture({
        destinationCell: { row: 0, col: 1 },
        level: 1,
        score: 100,
        status: "paused",
      }),
    )

    const mode = createTestAgentMode(elements)

    mode.bindActionDispatch(dispatch, readState, vi.fn(() => createControlFixture()))
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
    expect(mode.readLastActionResult()).toBeNull()
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

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                function: {
	                  name: "get_maze_positions",
                  arguments: {},
                },
              },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          message: { role: "assistant", content: "{\"moves\":[\"MoveRight\"]}" },
        }),
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
          ...createControlFixture({
            level: 1,
            score: 100,
            lastMoveStatus: "applied",
            lastSubmittedMoves: ["0:MoveRight"],
            lastAppliedMoveIndex: 0,
            visitedBefore: false,
          }),
        }
      }

      return null
    })
    const readState = vi.fn(() =>
      createControlFixture({
        level: 1,
        score: 100,
        status,
      }),
    )
    const commitAgentTurn = vi.fn(() => createControlFixture({ level: 1, score: 100, status }))

    const mode = createTestAgentMode(elements)

    mode.bindActionDispatch(dispatch, readState, commitAgentTurn)
    await flushImmediateAgentTurn()
    expect(fetchMock).not.toHaveBeenCalled()

    elements.touchButtons[0].click()
    await flushImmediateAgentTurn()

    expect(fetchMock).toHaveBeenCalled()
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

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                function: {
	                  name: "get_maze_positions",
                  arguments: {},
                },
              },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          message: { role: "assistant", content: "{\"moves\":[\"MoveRight\"]}" },
        }),
      })
    vi.stubGlobal("fetch", fetchMock)

    const dispatch = vi.fn().mockReturnValue(createControlFixture({
      currentCell: { row: 0, col: 1 },
      lastMoveStatus: "applied",
      lastSubmittedMoves: ["0:MoveRight"],
      lastAppliedMoveIndex: 0,
    }))
    const readState = vi.fn(() => createControlFixture({ level: 1 }))
    const commitAgentTurn = vi.fn(() => createControlFixture({ level: 1 }))
    const mode = createTestAgentMode(elements)

    mode.bindActionDispatch(dispatch, readState, commitAgentTurn)
    mode.recordActionResult(createControlFixture({
      currentCell: { row: 9, col: 9 },
      level: 99,
      lastMoveStatus: "reached-target",
      lastSubmittedMoves: ["0:MoveRight"],
    }))
    mode.clearActionResult()

    await flushImmediateAgentTurn()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const request = fetchMock.mock.calls[1][1] as RequestInit
    if (typeof request.body !== "string") {
      throw new Error("expected agent request body to be serialized json")
    }

    const requestBody = JSON.parse(request.body) as { messages: { content?: string }[] }
    const toolResult = JSON.parse(requestBody.messages.at(-1)?.content ?? "") as {
      currentCell: { row: number; col: number }
      destinationCell: { row: number; col: number }
    }

    expect(toolResult).toEqual({
      currentCell: { row: 0, col: 0 },
      destinationCell: { row: 0, col: 2 },
    })
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
      vi.fn(() => createControlFixture()),
      vi.fn(() => createControlFixture()),
    )
    await flushImmediateAgentTurn()

    expect(disableAgentAfterNetworkError).toHaveBeenCalledWith(
      enabledAgentConfigs()[0],
    )
    expect(mode.readLastActionResult()).toEqual(
      expect.objectContaining({
        lastMoveStatus: "network-error",
        chargedMovesCount: 0,
      }),
    )
  })

  it("renders compact seats for configured and empty agent slots", () => {
    savePersistedAgentApiConfigs([
      {
        id: 1,
        playerName: "Blue",
        model: "llama3.2",
        endpoint: new URL("https://agents.example/agents/blue/move"),
        api: "ollama",
        enabled: true,
      },
      {
        id: 2,
        playerName: "Grey",
        model: "gemma4",
        endpoint: new URL("https://agents.example/agents/grey/move"),
        api: "ollama",
        enabled: false,
      },
    ])
    const elements = createAgentFormElements()
    vi.stubGlobal("fetch", vi.fn())

    const mode = createAgentMode(elements)
    mode.bindActionDispatch(
      vi.fn(),
      vi.fn(() => createControlFixture({ status: "await-agent" })),
      vi.fn(() => createControlFixture()),
    )

    expect(elements.agentSeatRoster?.hidden).toBe(false)
    expect(elements.agentSeatRoster?.querySelectorAll(".agent-seat")).toHaveLength(
      CONFIG.agentConfig.maxSeats,
    )
    expect(
      elements.agentSeatRoster
        ?.querySelector('[data-agent-seat-id="1"]')
        ?.getAttribute("title"),
    ).toBe("Blue the Trailblazer")
    expect(
      elements.agentSeatRoster
        ?.querySelector('[data-agent-seat-id="2"]')
        ?.getAttribute("title"),
    ).toBe("Grey the Trailblazer")
    expect(
      elements.agentSeatRoster
        ?.querySelector('[data-agent-seat-id="2"]')
        ?.classList.contains("agent-seat--disabled"),
    ).toBe(true)
    expect(
      elements.agentSeatRoster?.querySelectorAll("[data-agent-seat-add]"),
    ).toHaveLength(CONFIG.agentConfig.maxSeats - 2)
  })

  it("keeps log side buttons separate from maze actions", () => {
    const elements = createAgentFormElements()
    const dispatch = vi.fn()
    const createObjectURL = vi.fn(() => "blob:tapoo-logs")
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL,
      revokeObjectURL: vi.fn(),
    })
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    vi.stubGlobal("fetch", vi.fn())

    const mode = createAgentMode(elements, () => [])
    mode.bindActionDispatch(
      dispatch,
      vi.fn(() => createControlFixture({ status: "await-agent" })),
      vi.fn(() => createControlFixture()),
    )

    expect(elements.agentSeatsBody?.hidden).toBe(false)
    expect(elements.tapooLogsReset?.disabled).toBe(true)
    expect(elements.tapooLogsDownload?.disabled).toBe(true)
    logTapooDiagnostic("agent-api", "info", "downloadable log")
    expect(elements.tapooLogsDownload?.disabled).toBe(false)
    elements.tapooLogsReset?.click()
    logTapooDiagnostic("agent-api", "info", "downloadable log")
    elements.tapooLogsDownload?.click()

    expect(dispatch).not.toHaveBeenCalled()
    expect(createObjectURL).toHaveBeenCalledTimes(1)
  })

  it("enables reset logs only while in-memory logs exist", () => {
    const elements = createAgentFormElements()
    vi.stubGlobal("fetch", vi.fn())

    const mode = createAgentMode(elements, () => [])
    mode.bindActionDispatch(
      vi.fn(),
      vi.fn(() => createControlFixture({ status: "await-agent" })),
      vi.fn(() => createControlFixture()),
    )

    expect(elements.tapooLogsReset?.disabled).toBe(true)
    expect(elements.tapooLogsDownload?.disabled).toBe(true)

    logTapooDiagnostic("agent-api", "info", "agent request")

    expect(elements.tapooLogsReset?.disabled).toBe(false)
    expect(elements.tapooLogsDownload?.disabled).toBe(false)

    elements.tapooLogsReset?.click()

    expect(elements.tapooLogsReset?.disabled).toBe(true)
    expect(elements.tapooLogsDownload?.disabled).toBe(true)
    expect(
      elements.tapooLogsReset?.classList.contains("tapoo-logs-control--acknowledged"),
    ).toBe(true)
  })

  it("opens delete confirmation for an inactive occupied seat", () => {
    savePersistedAgentApiConfigs([
      {
        id: 1,
        playerName: "Blue",
        model: "llama3.2",
        endpoint: new URL("https://agents.example/agents/blue/move"),
        api: "ollama",
        enabled: true,
      },
      {
        id: 2,
        playerName: "Red",
        model: "gemma4",
        endpoint: new URL("https://agents.example/agents/red/move"),
        api: "ollama",
        enabled: true,
      },
    ])
    const elements = createAgentFormElements()
    const dispatch = vi.fn()
    vi.stubGlobal("fetch", vi.fn())

    const mode = createAgentMode(elements)
    mode.bindActionDispatch(
      dispatch,
      vi.fn(() => createControlFixture({ status: "running" })),
      vi.fn(() => createControlFixture()),
    )

    clickDeleteSeat(elements, "2")

    expect(dispatch).toHaveBeenCalledWith(
      { type: "pause" },
      { playerName: "Self" },
    )
    expect(elements.agentDeleteDialog?.hidden).toBe(false)
    expect(elements.agentDeleteTitle?.textContent).toBe(
      "Manage Red the Trailblazer (gemma4) in seat 02",
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
        endpoint: new URL("https://agents.example/agents/blue/move"),
        api: "ollama",
        enabled: true,
      },
      {
        id: 2,
        playerName: "Red",
        model: "gemma4",
        endpoint: new URL("https://agents.example/agents/red/move"),
        api: "ollama",
        enabled: true,
      },
    ])
    const elements = createAgentFormElements()
    vi.stubGlobal("fetch", vi.fn())

    const mode = createAgentMode(elements)
    mode.bindActionDispatch(
      vi.fn(),
      vi.fn(() => createControlFixture({ status: "await-agent" })),
      vi.fn(() => createControlFixture()),
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
        endpoint: new URL("https://agents.example/agents/blue/move"),
        api: "ollama",
        enabled: false,
      },
    ])
    const elements = createAgentFormElements()
    vi.stubGlobal("fetch", vi.fn())

    const mode = createAgentMode(elements)
    mode.bindActionDispatch(
      vi.fn(),
      vi.fn(() => createControlFixture({ status: "await-agent" })),
      vi.fn(() => createControlFixture()),
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
        endpoint: new URL("https://agents.example/agents/blue/move"),
        api: "ollama",
        enabled: true,
      },
      {
        id: 2,
        playerName: "Red",
        model: "gemma4",
        endpoint: new URL("https://agents.example/agents/red/move"),
        api: "ollama",
        enabled: true,
      },
    ])
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        message: { role: "assistant", content: "{\"moves\":[\"MoveRight\"]}" },
      }),
    })
    vi.stubGlobal("fetch", fetchMock)
    const elements = createAgentFormElements()

    const mode = createAgentMode(elements)
    mode.bindActionDispatch(
      vi.fn(() => createControlFixture({ lastMoveStatus: "applied" })),
      vi.fn(() => createControlFixture({ status: "running" })),
      vi.fn(() => createControlFixture()),
    )

    await flushImmediateAgentTurn()
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

  it("clears the active agent seat when the maze stops running", async () => {
    savePersistedAgentApiConfigs([
      {
        id: 1,
        playerName: "Blue",
        model: "llama3.2",
        endpoint: new URL("https://agents.example/agents/blue/move"),
        api: "ollama",
        enabled: true,
      },
    ])
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        message: { role: "assistant", content: "{\"moves\":[\"MoveRight\"]}" },
      }),
    }))
    const elements = createAgentFormElements()
    elements.touchButtons = [createButton({ action: "pause" })]
    let status: GameStatus = "running"

    const mode = createAgentMode(elements)
    const dispatch = vi.fn((action: { type: string }) => {
      if (action.type === "pause") {
        status = "paused"
      }

      return createControlFixture({ lastMoveStatus: "applied", status })
    })
    mode.bindActionDispatch(
      dispatch,
      vi.fn(() => createControlFixture({ status })),
      vi.fn(() => createControlFixture()),
    )

    await flushImmediateAgentTurn()
    expect(
      elements.agentSeatRoster
        ?.querySelector('[data-agent-seat-id="1"]')
        ?.classList.contains("agent-seat--active"),
    ).toBe(true)

    elements.touchButtons[0].click()

    expect(
      elements.agentSeatRoster
        ?.querySelector('[data-agent-seat-id="1"]')
        ?.classList.contains("agent-seat--active"),
    ).toBe(false)
    expect(
      elements.agentSeatRoster?.querySelector('[data-agent-seat-delete="1"]'),
    ).not.toBeNull()

    clickDeleteSeat(elements, "1")

    expect(elements.agentDeleteDialog?.hidden).toBe(false)
    expect(elements.agentDeleteTitle?.textContent).toBe(
      "Manage Blue the Backtracker (llama3.2) in seat 01",
    )
  })

  it("opens the agent configuration form from an empty seat", () => {
    const elements = createAgentFormElements()
    const focusPlayerName = vi.fn()
    elements.agentConfigPlayerName.focus = focusPlayerName
    vi.stubGlobal("fetch", vi.fn())

    const mode = createTestAgentMode(elements)
    mode.bindActionDispatch(
      vi.fn(),
      vi.fn(() => createControlFixture({ status: "await-agent" })),
      vi.fn(() => createControlFixture()),
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
      vi.fn(() => createControlFixture({ status: "await-agent" })),
      vi.fn(() => createControlFixture()),
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
      vi.fn(() => createControlFixture({ status: "await-agent" })),
      vi.fn(() => createControlFixture()),
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
      vi.fn(() => createControlFixture({ status: "await-agent" })),
      vi.fn(() => createControlFixture()),
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

  it("closes the manage/delete dialog with Escape without dispatching pause", () => {
    // The delete dialog focuses a <button> (agentDeleteApply), unlike the add/edit form which
    // focuses an <input>. Escape must still close it rather than falling through to the global
    // session shortcut, regardless of which element type currently holds focus.
    savePersistedAgentApiConfigs([
      {
        id: 1,
        playerName: "Blue",
        model: "llama3.2",
        endpoint: new URL("https://agents.example/agents/blue/move"),
        api: "ollama",
        enabled: true,
      },
    ])
    const elements = createAgentFormElements()
    const dispatch = vi.fn()
    vi.stubGlobal("fetch", vi.fn())
    document.body.append(elements.app)

    const mode = createTestAgentMode(elements)
    mode.bindActionDispatch(
      dispatch,
      vi.fn(() => createControlFixture({ status: "await-agent" })),
      vi.fn(() => createControlFixture()),
    )

    clickDeleteSeat(elements, "1")
    dispatch.mockClear()
    elements.agentDeleteApply?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    )

    expect(dispatch).not.toHaveBeenCalled()
    expect(elements.agentDeleteDialog?.hidden).toBe(true)
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
      vi.fn(() => createControlFixture({ status: "running" })),
      vi.fn(() => createControlFixture()),
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
      vi.fn(() => createControlFixture({ status: "await-agent" })),
      vi.fn(() => createControlFixture()),
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
      vi.fn(() => createControlFixture({ status: "await-agent" })),
      vi.fn(() => createControlFixture()),
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
    elements.agentConfigEndpoint.value = "localhost:5000/api/chat"
    vi.stubGlobal("fetch", vi.fn())

    const mode = createAgentMode(elements, readAgentConfigs)
    mode.bindActionDispatch(
      vi.fn(),
      vi.fn(() => createControlFixture({ status: "await-agent" })),
      vi.fn(() => createControlFixture()),
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
        endpoint: new URL("http://localhost:5000/api/chat"),
        api: "ollama",
        enabled: true,
      }),
    ])
    expect(elements.agentConfigForm.hidden).toBe(true)
    expect(elements.agentConfigStatus.textContent).toBe("")
    expect(
      elements.agentSeatRoster?.querySelector('[data-agent-seat-id="1"]')
        ?.getAttribute("title"),
    ).toBe("Scout the Trailblazer")
  })

  it("rejects a bare host:port endpoint that carries no request path", () => {
    const elements = createAgentFormElements()
    const readAgentConfigs = vi.fn((): AgentApiConfig[] => [])
    elements.agentConfigPlayerName.value = "Scout"
    elements.agentConfigModel.value = "gemma4"
    // No path at all — this must not be silently defaulted to a provider's conventional route;
    // the user has to type the actual path themselves.
    elements.agentConfigEndpoint.value = "localhost:5000"
    vi.stubGlobal("fetch", vi.fn())

    const mode = createAgentMode(elements, readAgentConfigs)
    mode.bindActionDispatch(
      vi.fn(),
      vi.fn(() => createControlFixture({ status: "await-agent" })),
      vi.fn(() => createControlFixture()),
    )

    clickAddSeat(elements, "1")
    elements.agentConfigForm?.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    )

    expect(elements.agentConfigStatus.textContent).toBe(CONFIG.agentConfig.invalidEndpointMessage)
    expect(elements.agentConfigForm.hidden).toBe(false)
    expect(readAgentConfigs()).toEqual([])
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
      vi.fn(() => createControlFixture({ status: "await-agent" })),
      vi.fn(() => createControlFixture()),
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
      vi.fn(() => createControlFixture({ status: "await-agent" })),
      vi.fn(() => createControlFixture()),
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
      vi.fn(() => createControlFixture({ status: "await-agent" })),
      vi.fn(() => createControlFixture()),
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
      vi.fn(() => createControlFixture({ status: "await-agent" })),
      vi.fn(() => createControlFixture()),
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
        endpoint: new URL("https://agents.example/scout/move"),
        api: "ollama",
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
      vi.fn(() => createControlFixture({ status: "await-agent" })),
      vi.fn(() => createControlFixture()),
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
      vi.fn(() => createControlFixture({ status: "await-agent" })),
      vi.fn(() => createControlFixture()),
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
    const readState = vi.fn().mockReturnValue(
      createControlFixture({
        currentCell: null,
        destinationCell: null,
        level: 1,
        score: 0,
        status: "boot",
        traversalHistory: [],
      }),
    )

    const mode = createTestAgentMode(elements)

    mode.bindActionDispatch(firstDispatch, readState, vi.fn(() => createControlFixture()))
    mode.bindActionDispatch(secondDispatch, readState, vi.fn(() => createControlFixture()))
    elements.touchButtons[0].click()

    expect(firstDispatch).not.toHaveBeenCalled()
    expect(secondDispatch).toHaveBeenCalledWith({ type: "pause" }, { playerName: "Self" })
  })

  it("handles human session controls only while the terminal app is focused", () => {
    const pauseButton = createButton({ action: "pause" })
    const elements = {
      app: document.createElement("div"),
      body: document.createElement("div"),
      controls: [],
      measure: document.createElement("div"),
      screen: document.createElement("div"),
      touchButtons: [pauseButton],
      touchControls: document.createElement("div"),
    }
    const outsideInput = document.createElement("input")
    elements.app.tabIndex = 0
    elements.app.append(pauseButton)
    document.body.append(elements.app, outsideInput)
    vi.stubGlobal("fetch", vi.fn())
    const dispatch = vi.fn()

    const mode = createTestAgentMode(elements)
    mode.bindActionDispatch(
      dispatch,
      vi.fn(() => createControlFixture({ status: "running" })),
      vi.fn(() => createControlFixture()),
    )

    outsideInput.focus()
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }))

    expect(dispatch).not.toHaveBeenCalled()

    elements.app.focus()
    pauseButton.click()
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }))

    expect(dispatch).toHaveBeenNthCalledWith(1, { type: "pause" }, { playerName: "Self" })
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: "pause" }, { playerName: "Self" })
  })
})
