import { describe, expect, it, vi } from "vitest"

import { CONFIG } from "../config"
import { executeActionWithFeedback } from "./context"
import type { MazeAction, MoveAction, State, TraversalHistoryEntry } from "../types"

function visit(row: number, col: number): TraversalHistoryEntry {
  return { playerName: "Blue", row, col }
}

const expectedAgentPrompt = [
  "Your name is Blue.",
  `playerName ${CONFIG.runtime.interactivePlayerName} always appears first in traversalHistory and marks the start cell.`,
  "Use currentCell as your current position and destinationCell as the target.",
  "Use traversalHistory entries matching your playerName to review your past moves in order.",
  "Explore carefully: prefer unvisited cells and submit shorter predictions when uncertain.",
  "Return only the expected JSON moves payload using allowedMoves.",
  "Moves replay in order until the destination or the first invalid move.",
  "Every submitted move counts toward score decay, including moves after the first invalid move.",
  "Choose the moves most likely to reach the destination with the fewest submitted moves.",
].join(" ")

// createState builds a compact agent-facing runtime state for movement feedback tests.
function createState(overrides: Partial<State> = {}): State {
  return {
    controlMode: CONFIG.runtime.controlModes.agentApi,
    level: 4,
    mazeDimensions: { length: 2, width: 1, area: 2 },
    maze: [
      ["|", "---", "|", "---", "|"],
      ["|", "   ", " ", "   ", "|"],
      ["|", "---", "|", "---", "|"],
    ],
    playerPosition: { x: 1, y: 1 },
    traversalHistory: [visit(0, 0)],
    finalPosition: { x: 3, y: 1 },
    status: "running",
    score: 700,
    lastRoundScore: 0,
    lastAttemptRetentionUnits: null,
    bestWinRetentionUnits: null,
    lastWinRequestCount: null,
    bestWinRequestCount: null,
    winSummary: "",
    canResume: false,
    wallWeight: 1,
    scoreDecayUnits: 0,
    agentRequestCount: 0,
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
        state.traversalHistory = [visit(0, 0), visit(0, 1)]
      }
    }),
    playerName: "Blue",
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
      currentCell: { row: 0, col: 0 },
      destinationCell: { row: 0, col: 1 },
      traversalHistory: [visit(0, 0)],
      playerName: "Blue",
      level: 4,
      score: 700,
      model: "",
      stream: false,
      format: "json",
      status: "paused",
      allowedMoves: ["MoveUp", "MoveDown", "MoveLeft", "MoveRight"],
      recommendedAvgPredictionLimit: 18,
      prompt: expectedAgentPrompt,
      expectedResponseFormat: {
        validPredictionFormat: {
          moves: ["MoveRight", "MoveDown"],
        },
      },
      lastMoveStatus: "invalid-move",
      submittedMovesIndexBase: 0,
      submittedMovesPattern: "<index>:<MoveAction>",
      submittedMoves: ["0:MoveLeft"],
      lastValidMoveIndex: null,
      decayedMovesCount: 0,
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
      currentCell: { row: 0, col: 0 },
      destinationCell: { row: 0, col: 1 },
      traversalHistory: [visit(0, 0)],
      playerName: "Blue",
      level: 4,
      score: 700,
      model: "",
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
      lastMoveStatus: "invalid-move",
      submittedMovesIndexBase: 0,
      submittedMovesPattern: "<index>:<MoveAction>",
      submittedMoves: ["0:MoveRight"],
      lastValidMoveIndex: null,
      decayedMovesCount: 0,
    })
    expect(context.handleMove).not.toHaveBeenCalled()
  })

  it("reports when a move reaches the destination", () => {
    const state = createState()
    const context = createContext(state)
    context.handleMove.mockImplementationOnce((action: MoveAction) => {
      if (action === "MoveRight") {
        state.playerPosition = { x: 3, y: 1 }
        state.traversalHistory = [visit(0, 0), visit(0, 1)]
        state.status = "won"
      }
    })

    expect(
      executeActionWithFeedback(moveAction("MoveRight"), context),
    ).toEqual({
      currentCell: { row: 0, col: 1 },
      destinationCell: { row: 0, col: 1 },
      traversalHistory: [visit(0, 0), visit(0, 1)],
      playerName: "Blue",
      level: 4,
      score: 700,
      model: "",
      stream: false,
      format: "json",
      status: "won",
      allowedMoves: ["MoveUp", "MoveDown", "MoveLeft", "MoveRight"],
      recommendedAvgPredictionLimit: 18,
      prompt: expectedAgentPrompt,
      expectedResponseFormat: {
        validPredictionFormat: {
          moves: ["MoveRight", "MoveDown"],
        },
      },
      lastMoveStatus: "reached-target",
      visitedBefore: false,
      submittedMovesIndexBase: 0,
      submittedMovesPattern: "<index>:<MoveAction>",
      submittedMoves: ["0:MoveRight"],
      lastValidMoveIndex: 0,
      decayedMovesCount: 0,
    })
    expect(context.handleMove).toHaveBeenCalledWith("MoveRight", "Blue")
  })

  it("keeps traversal history stable when a move revisits an older cell", () => {
    const state = createState({
      playerPosition: { x: 3, y: 1 },
      traversalHistory: [visit(0, 0), visit(0, 1)],
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
      currentCell: { row: 0, col: 0 },
      destinationCell: { row: 0, col: 1 },
      traversalHistory: [visit(0, 0), visit(0, 1)],
      playerName: "Blue",
      level: 4,
      score: 700,
      model: "",
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
      lastMoveStatus: "applied",
      visitedBefore: true,
      submittedMovesIndexBase: 0,
      submittedMovesPattern: "<index>:<MoveAction>",
      submittedMoves: ["0:MoveLeft"],
      lastValidMoveIndex: 0,
      decayedMovesCount: 0,
    })
  })
})
