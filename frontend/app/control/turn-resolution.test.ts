import { describe, expect, it, vi } from "vitest"

import { CONFIG } from "../config"
import { hasReachedTarget } from "../status"
import type { State, TraversalHistoryEntry } from "../types"
import {
  commitAgentApiTurn,
  commitInteractiveTurn,
  refreshRunningRoundFrame,
  shouldDrawDestination,
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

describe("hasReachedTarget", () => {
  it("detects destination equality without mutating status", () => {
    const state = createState({
      playerPosition: { x: 3, y: 1 },
    })

    expect(hasReachedTarget(state)).toBe(true)
    expect(state.status).toBe("running")
  })

  it("returns false when the destination was not reached", () => {
    const state = createState()

    expect(hasReachedTarget(state)).toBe(false)
    expect(state.status).toBe("running")
  })

  it.each([
    { playerPosition: null, finalPosition: { x: 3, y: 1 } },
    { playerPosition: { x: 3, y: 1 }, finalPosition: null },
    { playerPosition: null, finalPosition: null },
  ])("returns false when either position is missing", (overrides) => {
    const state = createState(overrides)

    expect(hasReachedTarget(state)).toBe(false)
    expect(state.status).toBe("running")
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

  it("wins at zero score when the interactive move reaches the target", () => {
    const state = createState({
      playerPosition: { x: 3, y: 1 },
    })
    const applyWinSummary = vi.fn(() => {
      state.winSummary = "0% retention"
    })
    const persistNow = vi.fn()

    commitInteractiveTurn({
      state,
      applyWinSummary,
      calculateRoundScore: vi.fn(() => 0),
      persistNow,
      scheduleRoundPersistence: vi.fn(),
      renderState: vi.fn(),
    })

    expect(state.status).toBe("won")
    expect(state.score).toBe(0)
    expect(state.lastRoundScore).toBe(0)
    expect(state.winSummary).toBe("0% retention")
    expect(applyWinSummary).toHaveBeenCalledWith(2)
    expect(persistNow).toHaveBeenCalledWith("state")
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
      persistNow: vi.fn(),
      scheduleRoundPersistence,
      renderState: vi.fn(),
    })

    expect(state.score).toBe(140)
    expect(scheduleRoundPersistence).toHaveBeenCalled()
  })

  it("finalizes a depleted interactive turn as terminal state", () => {
    const state = createState({
      status: "running",
      winSummary: "stale",
    })
    const persistNow = vi.fn()
    const renderState = vi.fn()

    commitInteractiveTurn({
      state,
      applyWinSummary: vi.fn(),
      calculateRoundScore: vi.fn(() => 0),
      persistNow,
      scheduleRoundPersistence: vi.fn(),
      renderState,
    })

    expect(state.status).toBe("lost")
    expect(state.lastRoundScore).toBe(0)
    expect(state.lastAttemptRetentionUnits).toBe(0)
    expect(state.winSummary).toBe("")
    expect(persistNow).toHaveBeenCalledWith("state")
    expect(renderState).toHaveBeenCalled()
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

    commitAgentApiTurn({
      state,
      applyWinSummary: vi.fn(),
      calculateRoundScore,
      persistNow,
      renderState,
      chargedMovesCount: 2,
    })

    expect(state.turnCount).toBe(3)
    expect(state.scoreDecayUnits).toBe(3)
    expect(state.score).toBe(250)
    expect(persistNow).toHaveBeenCalledWith("round")
    expect(renderState).toHaveBeenCalled()
  })

  it("finalizes depleted agent batches as terminal state", () => {
    const state = createState({
      controlMode: CONFIG.runtime.controlModes.agentApi,
      status: "running",
      winSummary: "stale",
    })
    const persistNow = vi.fn()
    const renderState = vi.fn()

    commitAgentApiTurn({
      state,
      applyWinSummary: vi.fn(),
      calculateRoundScore: vi.fn(() => 0),
      persistNow,
      renderState,
      chargedMovesCount: 1,
    })

    expect(state.status).toBe("lost")
    expect(state.lastRoundScore).toBe(0)
    expect(state.lastAttemptRetentionUnits).toBe(0)
    expect(state.winSummary).toBe("")
    expect(persistNow).toHaveBeenCalledWith("state")
    expect(renderState).toHaveBeenCalled()
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

    commitAgentApiTurn({
      state,
      applyWinSummary,
      calculateRoundScore: vi.fn(() => 125),
      persistNow,
      renderState: vi.fn(),
      chargedMovesCount: 1,
    })

    expect(state.lastRoundScore).toBe(125)
    expect(state.status).toBe("won")
    expect(applyWinSummary).toHaveBeenCalledWith(2)
    expect(persistNow).toHaveBeenCalledWith("state")
  })

  it("wins at zero score when the agent batch reaches the target", () => {
    const state = createState({
      controlMode: CONFIG.runtime.controlModes.agentApi,
      playerPosition: { x: 3, y: 1 },
    })
    const applyWinSummary = vi.fn(() => {
      state.winSummary = "0% retention"
    })
    const persistNow = vi.fn()

    commitAgentApiTurn({
      state,
      applyWinSummary,
      calculateRoundScore: vi.fn(() => 0),
      persistNow,
      renderState: vi.fn(),
      chargedMovesCount: 1,
    })

    expect(state.status).toBe("won")
    expect(state.score).toBe(0)
    expect(state.lastRoundScore).toBe(0)
    expect(state.winSummary).toBe("0% retention")
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
    })

    expect(state.score).toBe(180)
    expect(renderState).toHaveBeenCalled()
  })

  it("tracks blink changes inside the running frame refresh", () => {
    const state = createState({
      controlMode: CONFIG.runtime.controlModes.agentApi,
      score: 200,
    })
    const renderState = vi.fn()

    refreshRunningRoundFrame({
      state,
      calculateRoundScore: vi.fn(() => 200),
      persistNow: vi.fn(),
      renderState,
    })

    expect(renderState).toHaveBeenCalledTimes(1)

    renderState.mockClear()
    refreshRunningRoundFrame({
      state,
      calculateRoundScore: vi.fn(() => 200),
      persistNow: vi.fn(),
      renderState,
    })

    expect(renderState).not.toHaveBeenCalled()
  })

  it("uses rendered destination visibility to seed the next running frame refresh", () => {
    const state = createState({
      controlMode: CONFIG.runtime.controlModes.agentApi,
      score: 200,
    })
    const renderState = vi.fn()

    expect(shouldDrawDestination(state)).toBe(true)

    refreshRunningRoundFrame({
      state,
      calculateRoundScore: vi.fn(() => 200),
      persistNow: vi.fn(),
      renderState,
    })

    expect(renderState).not.toHaveBeenCalled()
  })

  it("skips one running refresh render immediately after an interactive turn commit", () => {
    const state = createState({
      controlMode: CONFIG.runtime.controlModes.interactive,
      score: 200,
    })
    const renderState = vi.fn()
    const calculateRoundScore = vi.fn()
      .mockReturnValueOnce(190)
      .mockReturnValueOnce(180)
      .mockReturnValueOnce(170)

    commitInteractiveTurn({
      state,
      applyWinSummary: vi.fn(),
      calculateRoundScore,
      persistNow: vi.fn(),
      scheduleRoundPersistence: vi.fn(),
      renderState,
    })

    expect(renderState).toHaveBeenCalledTimes(1)

    refreshRunningRoundFrame({
      state,
      calculateRoundScore,
      persistNow: vi.fn(),
      renderState,
    })

    expect(state.score).toBe(180)
    expect(renderState).toHaveBeenCalledTimes(1)

    refreshRunningRoundFrame({
      state,
      calculateRoundScore,
      persistNow: vi.fn(),
      renderState,
    })

    expect(state.score).toBe(170)
    expect(renderState).toHaveBeenCalledTimes(2)
  })

  it("consumes the post-commit refresh latch even when that refresh has no render work", () => {
    const state = createState({
      controlMode: CONFIG.runtime.controlModes.interactive,
      score: 200,
    })
    const renderState = vi.fn()
    const calculateRoundScore = vi.fn()
      .mockReturnValueOnce(190)
      .mockReturnValueOnce(190)
      .mockReturnValueOnce(180)

    commitInteractiveTurn({
      state,
      applyWinSummary: vi.fn(),
      calculateRoundScore,
      persistNow: vi.fn(),
      scheduleRoundPersistence: vi.fn(),
      renderState,
    })

    refreshRunningRoundFrame({
      state,
      calculateRoundScore,
      persistNow: vi.fn(),
      renderState,
    })

    expect(renderState).toHaveBeenCalledTimes(1)

    refreshRunningRoundFrame({
      state,
      calculateRoundScore,
      persistNow: vi.fn(),
      renderState,
    })

    expect(state.score).toBe(180)
    expect(renderState).toHaveBeenCalledTimes(2)
  })

  it("clears the post-commit refresh latch when the next frame is not running", () => {
    const state = createState({
      controlMode: CONFIG.runtime.controlModes.interactive,
      score: 200,
    })
    const renderState = vi.fn()
    const calculateRoundScore = vi.fn()
      .mockReturnValueOnce(190)
      .mockReturnValueOnce(180)

    commitInteractiveTurn({
      state,
      applyWinSummary: vi.fn(),
      calculateRoundScore,
      persistNow: vi.fn(),
      scheduleRoundPersistence: vi.fn(),
      renderState,
    })

    state.status = "paused"
    refreshRunningRoundFrame({
      state,
      calculateRoundScore,
      persistNow: vi.fn(),
      renderState,
    })

    state.status = "running"
    refreshRunningRoundFrame({
      state,
      calculateRoundScore,
      persistNow: vi.fn(),
      renderState,
    })

    expect(state.score).toBe(180)
    expect(renderState).toHaveBeenCalledTimes(2)
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
    })

    expect(state.status).toBe("lost")
    expect(persistNow).toHaveBeenCalledWith("state")
    expect(renderState).toHaveBeenCalled()
  })

  it("does not suppress a terminal loss render after a turn commit", () => {
    const state = createState({
      controlMode: CONFIG.runtime.controlModes.interactive,
      score: 200,
    })
    const persistNow = vi.fn()
    const renderState = vi.fn()
    const calculateRoundScore = vi.fn()
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(0)

    commitInteractiveTurn({
      state,
      applyWinSummary: vi.fn(),
      calculateRoundScore,
      persistNow,
      scheduleRoundPersistence: vi.fn(),
      renderState,
    })

    refreshRunningRoundFrame({
      state,
      calculateRoundScore,
      persistNow,
      renderState,
    })

    expect(state.status).toBe("lost")
    expect(persistNow).toHaveBeenCalledWith("state")
    expect(renderState).toHaveBeenCalledTimes(2)
  })
})
