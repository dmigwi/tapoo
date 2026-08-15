import { describe, expect, it, vi } from "vitest"

import { CONFIG } from "../config"
import type { State, TraversalHistoryEntry } from "../types"
import {
  commitAgentApiTurn,
  commitInteractiveTurn,
  handleLoss,
  hasReachedDestination,
  handleWinCheck,
  refreshRunningRoundFrame,
} from "./turn-resolution"

function selfVisit(row: number, col: number): TraversalHistoryEntry {
  return { playerName: CONFIG.runtime.interactivePlayerName, row, col, openMoves: [] }
}

function createClock(): State["clock"] {
  return {
    levelDurationMs: 1_000,
    startedAt: 0,
    pausedAt: 0,
    pausedDuration: 0,
    isPaused: false,
    pause: vi.fn(),
    resume: vi.fn(),
    elapsed: vi.fn(() => 0),
    blink: vi.fn(() => true),
    remaining: vi.fn(() => 1_000),
  }
}

function createState(overrides: Partial<State> = {}): State {
  return {
    turnCount: 0,
    cumulativeRoundCount: 0,
    bestWinTraversalSpeedUnits: null,
    bestWinRetentionUnits: null,
    clock: createClock(),
    controlMode: CONFIG.runtime.controlModes.interactive,
    finalPosition: { x: 3, y: 1 },
    lastAttemptRetentionUnits: null,
    lastRoundScore: 0,
    lastWinTraversalSpeedUnits: null,
    level: 1,
    maze: null,
    mazeDimensions: { numCols: 2, numRows: 1, area: 2 },
    startPosition: { x: 1, y: 1 },
    playerPosition: { x: 1, y: 1 },
    score: 200,
    scoreDecayUnits: 0,
    status: "running",
    traversalHistory: [selfVisit(0, 0)],
    wallWeight: 1,
    winSummary: "",
    ...overrides,
  }
}

describe("handleWinCheck", () => {
  it("detects destination equality without mutating status", () => {
    const state = createState({
      playerPosition: { x: 3, y: 1 },
    })

    expect(hasReachedDestination(state)).toBe(true)
    expect(state.status).toBe("running")
  })

  it("marks the round won when playerPosition reaches finalPosition", () => {
    const state = createState({
      playerPosition: { x: 3, y: 1 },
    })

    expect(handleWinCheck(state)).toBe(true)
    expect(state.status).toBe("won")
  })

  it("leaves status unchanged when the destination was not reached", () => {
    const state = createState()

    expect(handleWinCheck(state)).toBe(false)
    expect(state.status).toBe("running")
  })
})

describe("handleLoss", () => {
  it("finalizes a depleted running round", () => {
    const state = createState({
      score: 50,
      status: "running",
      winSummary: "stale",
    })
    const calculateRoundScore = vi.fn(() => 0)
    const persistNow = vi.fn()
    const renderState = vi.fn()

    handleLoss({
      state,
      calculateRoundScore,
      persistNow,
      renderState,
    })

    expect(calculateRoundScore).toHaveBeenCalledWith(2)
    expect(state.status).toBe("lost")
    expect(state.score).toBe(0)
    expect(state.lastRoundScore).toBe(0)
    expect(state.lastAttemptRetentionUnits).toBe(0)
    expect(state.winSummary).toBe("")
    expect(persistNow).toHaveBeenCalledWith("state")
    expect(renderState).toHaveBeenCalled()
  })

  it("ignores non-running rounds", () => {
    const state = createState({ status: "won" })
    const calculateRoundScore = vi.fn(() => 0)

    handleLoss({
      state,
      calculateRoundScore,
      persistNow: vi.fn(),
      renderState: vi.fn(),
    })

    expect(calculateRoundScore).not.toHaveBeenCalled()
    expect(state.status).toBe("won")
  })
})

describe("commitInteractiveTurn", () => {
  it("persists a won interactive turn as terminal state", () => {
    const state = createState({
      playerPosition: { x: 3, y: 1 },
      score: 150,
    })
    const calculateRoundScore = vi.fn(() => 180)
    const applyWinSummary = vi.fn(() => {
      state.winSummary = "resolved"
    })
    const persistNow = vi.fn()
    const scheduleRoundPersistence = vi.fn()
    const renderState = vi.fn()

    commitInteractiveTurn({
      state,
      applyWinSummary,
      calculateRoundScore,
      handleLoss: vi.fn(),
      persistNow,
      scheduleRoundPersistence,
      renderState,
    })

    expect(calculateRoundScore).toHaveBeenCalledWith(2)
    expect(state.score).toBe(180)
    expect(state.lastRoundScore).toBe(180)
    expect(state.status).toBe("won")
    expect(applyWinSummary).toHaveBeenCalledWith(2)
    expect(persistNow).toHaveBeenCalledWith("state")
    expect(scheduleRoundPersistence).not.toHaveBeenCalled()
    expect(renderState).toHaveBeenCalled()
  })

  it("schedules persistence for a non-terminal interactive move", () => {
    const state = createState({
      status: "running",
      score: 150,
    })
    const calculateRoundScore = vi.fn(() => 140)
    const scheduleRoundPersistence = vi.fn()

    commitInteractiveTurn({
      state,
      applyWinSummary: vi.fn(),
      calculateRoundScore,
      handleLoss: vi.fn(),
      persistNow: vi.fn(),
      scheduleRoundPersistence,
      renderState: vi.fn(),
    })

    expect(state.score).toBe(140)
    expect(scheduleRoundPersistence).toHaveBeenCalled()
  })
})

describe("commitAgentApiTurn", () => {
  it("applies decay and persists a non-terminal agent batch", () => {
    const state = createState({
      controlMode: CONFIG.runtime.controlModes.agentApi,
      score: 300,
      scoreDecayUnits: 1,
      turnCount: 2,
    })
    const calculateRoundScore = vi.fn(() => 250)
    const persistNow = vi.fn()
    const renderState = vi.fn()
    const handleLossMock = vi.fn()

    commitAgentApiTurn(2, {
      state,
      applyWinSummary: vi.fn(),
      calculateRoundScore,
      persistNow,
      renderState,
      handleLoss: handleLossMock,
    })

    expect(state.turnCount).toBe(3)
    expect(state.scoreDecayUnits).toBe(3)
    expect(state.score).toBe(250)
    expect(persistNow).toHaveBeenCalledWith("round")
    expect(handleLossMock).not.toHaveBeenCalled()
    expect(renderState).toHaveBeenCalled()
  })

  it("delegates depleted agent batches to loss handling", () => {
    const state = createState({
      controlMode: CONFIG.runtime.controlModes.agentApi,
      status: "running",
    })
    const handleLossMock = vi.fn()

    commitAgentApiTurn(1, {
      state,
      applyWinSummary: vi.fn(),
      calculateRoundScore: vi.fn(() => 0),
      persistNow: vi.fn(),
      renderState: vi.fn(),
      handleLoss: handleLossMock,
    })

    expect(handleLossMock).toHaveBeenCalled()
  })

  it("finalizes a won agent batch before any loss handling", () => {
    const state = createState({
      controlMode: CONFIG.runtime.controlModes.agentApi,
      playerPosition: { x: 3, y: 1 },
    })
    const applyWinSummary = vi.fn(() => {
      state.winSummary = "resolved"
    })
    const persistNow = vi.fn()

    commitAgentApiTurn(1, {
      state,
      applyWinSummary,
      calculateRoundScore: vi.fn(() => 125),
      persistNow,
      renderState: vi.fn(),
      handleLoss: vi.fn(),
    })

    expect(state.lastRoundScore).toBe(125)
    expect(state.status).toBe("won")
    expect(applyWinSummary).toHaveBeenCalledWith(2)
    expect(persistNow).toHaveBeenCalledWith("state")
  })
})

describe("refreshRunningRoundFrame", () => {
  it("re-renders when interactive score changes during a running frame", () => {
    const state = createState({
      controlMode: CONFIG.runtime.controlModes.interactive,
      score: 200,
    })
    const renderState = vi.fn()

    refreshRunningRoundFrame({
      state,
      calculateRoundScore: vi.fn(() => 180),
      persistNow: vi.fn(),
      renderState,
      lastBlinkVisible: true,
    })

    expect(state.score).toBe(180)
    expect(renderState).toHaveBeenCalled()
  })

  it("delegates depleted running frames to loss handling", () => {
    const state = createState({
      controlMode: CONFIG.runtime.controlModes.interactive,
      score: 100,
      status: "running",
    })
    const persistNow = vi.fn()
    const renderState = vi.fn()

    refreshRunningRoundFrame({
      state,
      calculateRoundScore: vi.fn(() => 0),
      persistNow,
      renderState,
      lastBlinkVisible: true,
    })

    expect(state.status).toBe("lost")
    expect(persistNow).toHaveBeenCalledWith("state")
    expect(renderState).toHaveBeenCalled()
  })
})
