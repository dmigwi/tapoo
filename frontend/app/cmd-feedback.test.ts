import { describe, expect, it, vi } from "vitest"

import { executeActionWithFeedback } from "./cmd-feedback"
import type { MazeAction, MoveAction, State } from "./types"

// createState builds a compact agent-facing runtime state for movement feedback tests.
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
    playerPosition: { x: 1, y: 1 },
    traversalHistory: [{ row: 0, col: 0 }],
    finalPosition: { x: 3, y: 1 },
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

// createContext provides the minimal runtime hooks consumed by movement feedback execution.
function createContext(state: State) {
  return {
    executeCommand: vi.fn(),
    state,
    handleMove: vi.fn((action: MoveAction) => {
      if (action === "MoveRight") {
        state.playerPosition = { x: 3, y: 1 }
        state.traversalHistory = [{ row: 0, col: 0 }, { row: 0, col: 1 }]
      }
    }),
  }
}

// moveAction keeps the flattened action payload concise in expectations.
function moveAction(type: MoveAction): MazeAction {
  return { type }
}

// These tests lock down the compact command feedback returned to agent callers.
describe("cmd feedback", () => {
  it("reports when movement is unavailable", () => {
    const state = createState({
      status: "paused",
      clock: createClock(),
    })
    const context = createContext(state)

    expect(
      executeActionWithFeedback(moveAction("MoveLeft"), context),
    ).toEqual({
      expectedResponseType: "MoveAction",
      instruction: "Choose a different MoveAction.",
      lastCommand: { type: "MoveLeft" },
      lastCommandStatus: "invalid",
      lastCommandMessage: "MoveLeft unavailable.",
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
      executeActionWithFeedback(moveAction("MoveRight"), context),
    ).toEqual({
      expectedResponseType: "MoveAction",
      instruction: "Choose a different MoveAction.",
      lastCommand: { type: "MoveRight" },
      lastCommandStatus: "invalid",
      lastCommandMessage: "MoveRight blocked.",
    })
    expect(context.handleMove).not.toHaveBeenCalled()
  })

  it("reports when a move reaches the destination", () => {
    const state = createState()
    const context = createContext(state)
    context.handleMove.mockImplementationOnce((action: MoveAction) => {
      if (action === "MoveRight") {
        state.playerPosition = { x: 3, y: 1 }
        state.traversalHistory = [{ row: 0, col: 0 }, { row: 0, col: 1 }]
        state.status = "won"
      }
    })

    expect(
      executeActionWithFeedback(moveAction("MoveRight"), context),
    ).toEqual({
      expectedResponseType: "MoveAction",
      instruction: "Choose the next MoveAction.",
      lastCommand: { type: "MoveRight" },
      lastCommandStatus: "reached-target",
      lastCommandMessage: "MoveRight reached target.",
      visitedBefore: false,
    })
    expect(context.handleMove).toHaveBeenCalledWith("MoveRight")
  })

  it("keeps traversal history stable when a move revisits an older cell", () => {
    const state = createState({
      playerPosition: { x: 3, y: 1 },
      traversalHistory: [{ row: 0, col: 0 }, { row: 0, col: 1 }],
    })
    const context = createContext(state)
    context.handleMove.mockImplementationOnce((action: MoveAction) => {
      if (action === "MoveLeft") {
        state.playerPosition = { x: 1, y: 1 }
      }
    })

    expect(
      executeActionWithFeedback(moveAction("MoveLeft"), context),
    ).toEqual({
      expectedResponseType: "MoveAction",
      instruction: "Choose the next MoveAction.",
      lastCommand: { type: "MoveLeft" },
      lastCommandStatus: "applied",
      lastCommandMessage: "MoveLeft applied.",
      visitedBefore: true,
    })
  })
})
