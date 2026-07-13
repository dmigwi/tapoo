import { describe, expect, it, vi } from "vitest"

import { executeCommandWithFeedback } from "./cmd-feedback"
import type { MoveAction, State } from "./types"

// createState builds a compact agent-facing runtime state for command feedback tests.
function createState(overrides: Partial<State> = {}): State {
  return {
    controlMode: "agent-api",
    level: 4,
    dims: { length: 2, width: 1 },
    maze: [
      ["|", "---", "|", "---", "|"],
      ["|", "   ", " ", "   ", "|"],
      ["|", "---", "|", "---", "|"],
    ],
    playerPosition: [1, 1],
    finalPosition: [1, 3],
    status: "running",
    score: 700,
    lastRoundScore: 0,
    lastAttemptRetention: null,
    bestWinRetention: null,
    winSummary: "",
    canResume: false,
    wallWeight: 1,
    clock: null,
    ...overrides,
  }
}

// createClock supplies the pause/resume shape expected by feedback precondition checks.
function createClock(): State["clock"] {
  return {
    pause: vi.fn(),
    resume: vi.fn(),
    elapsed: vi.fn(),
    blink: vi.fn(),
    remaining: vi.fn(),
  } as unknown as State["clock"]
}

// createContext provides the minimal runtime hooks consumed by command feedback execution.
function createContext(state: State) {
  return {
    state,
    handleMove: vi.fn((action: MoveAction) => {
      if (action === "MoveRight") {
        state.playerPosition = [1, 3]
      }
    }),
    pauseGame: vi.fn(() => {
      state.status = "paused"
      state.canResume = true
    }),
    resumeOrProceed: vi.fn(),
    cycleWallWeight: vi.fn(),
    restartGame: vi.fn(() => {
      state.level = 1
      state.score = 100
      state.status = "running"
      state.wallWeight = 1
    }),
  }
}

// These tests lock down the compact feedback returned to agent control callers.
describe("command feedback", () => {
  it("reports when movement is unavailable", () => {
    const state = createState({
      status: "paused",
      clock: createClock(),
    })
    const context = createContext(state)

    expect(
      executeCommandWithFeedback(
        { type: "move", move: "MoveLeft" },
        context,
      ),
    ).toEqual({
      command: "move",
      level: 4,
      message: "MoveLeft unavailable.",
      ok: false,
      score: 700,
      status: "paused",
      wallWeight: 1,
    })
    expect(context.handleMove).not.toHaveBeenCalled()
  })

  it("reports blocked movement when a wall is encountered", () => {
    const state = createState({
      maze: [
        ["|", "---", "|", "---", "|"],
        ["|", "   ", "|", "   ", "|"],
        ["|", "---", "|", "---", "|"],
      ],
    })
    const context = createContext(state)

    expect(
      executeCommandWithFeedback(
        { type: "move", move: "MoveRight" },
        context,
      ),
    ).toEqual({
      command: "move",
      level: 4,
      message: "MoveRight blocked.",
      ok: false,
      score: 700,
      status: "running",
      wallWeight: 1,
    })
    expect(context.handleMove).not.toHaveBeenCalled()
  })

  it("reports when a move reaches the destination", () => {
    const state = createState()
    const context = createContext(state)
    context.handleMove.mockImplementationOnce((action: MoveAction) => {
      if (action === "MoveRight") {
        state.playerPosition = [1, 3]
        state.status = "won"
      }
    })

    expect(
      executeCommandWithFeedback(
        { type: "move", move: "MoveRight" },
        context,
      ),
    ).toEqual({
      command: "move",
      level: 4,
      message: "MoveRight reached target.",
      ok: true,
      score: 700,
      status: "won",
      wallWeight: 1,
    })
    expect(context.handleMove).toHaveBeenCalledWith("MoveRight")
  })

  it("reports pause outcomes", () => {
    const unavailableState = createState()
    const unavailableContext = createContext(unavailableState)

    expect(
      executeCommandWithFeedback({ type: "pause" }, unavailableContext),
    ).toEqual({
      command: "pause",
      level: 4,
      message: "Pause unavailable.",
      ok: false,
      score: 700,
      status: "running",
      wallWeight: 1,
    })

    const runningState = createState({ clock: createClock() })
    const runningContext = createContext(runningState)

    expect(
      executeCommandWithFeedback({ type: "pause" }, runningContext),
    ).toEqual({
      command: "pause",
      level: 4,
      message: "Paused.",
      ok: true,
      score: 700,
      status: "paused",
      wallWeight: 1,
    })
    expect(runningContext.pauseGame).toHaveBeenCalled()
  })

  it("reports proceed outcomes for resume, next level, retry, and invalid states", () => {
    const pausedState = createState({
      status: "paused",
      canResume: true,
      clock: createClock(),
    })
    const pausedContext = createContext(pausedState)
    pausedContext.resumeOrProceed.mockImplementationOnce(() => {
      pausedState.status = "running"
      pausedState.canResume = false
    })

    expect(
      executeCommandWithFeedback({ type: "proceed" }, pausedContext),
    ).toEqual({
      command: "proceed",
      level: 4,
      message: "Resumed.",
      ok: true,
      score: 700,
      status: "running",
      wallWeight: 1,
    })

    const wonState = createState({ status: "won" })
    const wonContext = createContext(wonState)
    wonContext.resumeOrProceed.mockImplementationOnce(() => {
      wonState.level = 5
      wonState.status = "running"
      wonState.score = 100
    })

    expect(
      executeCommandWithFeedback({ type: "proceed" }, wonContext),
    ).toEqual({
      command: "proceed",
      level: 5,
      message: "Level 5 started.",
      ok: true,
      score: 100,
      status: "running",
      wallWeight: 1,
    })

    const lostState = createState({ status: "lost" })
    const lostContext = createContext(lostState)
    lostContext.resumeOrProceed.mockImplementationOnce(() => {
      lostState.status = "running"
      lostState.score = 100
    })

    expect(
      executeCommandWithFeedback({ type: "proceed" }, lostContext),
    ).toEqual({
      command: "proceed",
      level: 4,
      message: "Level 4 restarted.",
      ok: true,
      score: 100,
      status: "running",
      wallWeight: 1,
    })

    const invalidState = createState({ clock: createClock() })
    const invalidContext = createContext(invalidState)

    expect(
      executeCommandWithFeedback({ type: "proceed" }, invalidContext),
    ).toEqual({
      command: "proceed",
      level: 4,
      message: "Proceed unavailable.",
      ok: false,
      score: 700,
      status: "running",
      wallWeight: 1,
    })
  })

  it("reports wall weight changes and unchanged cycles", () => {
    const changedState = createState()
    const changedContext = createContext(changedState)
    changedContext.cycleWallWeight.mockImplementationOnce(() => {
      changedState.wallWeight = 2
    })

    expect(
      executeCommandWithFeedback({ type: "cycle-walls" }, changedContext),
    ).toEqual({
      command: "cycle-walls",
      level: 4,
      message: "Walls 2.",
      ok: true,
      score: 700,
      status: "running",
      wallWeight: 2,
    })

    const unchangedState = createState({ wallWeight: 3 })
    const unchangedContext = createContext(unchangedState)

    expect(
      executeCommandWithFeedback({ type: "cycle-walls" }, unchangedContext),
    ).toEqual({
      command: "cycle-walls",
      level: 4,
      message: "Walls unchanged.",
      ok: false,
      score: 700,
      status: "running",
      wallWeight: 3,
    })
  })

  it("reports restart feedback with the updated round state", () => {
    const state = createState({
      level: 8,
      score: 200,
      wallWeight: 3,
      status: "lost",
    })
    const context = createContext(state)

    expect(
      executeCommandWithFeedback({ type: "restart" }, context),
    ).toEqual({
      command: "restart",
      level: 1,
      message: "Progress reset.",
      ok: true,
      score: 100,
      status: "running",
      wallWeight: 1,
    })
    expect(context.restartGame).toHaveBeenCalled()
  })
})
