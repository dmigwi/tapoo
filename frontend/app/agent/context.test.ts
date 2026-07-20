import { describe, expect, it, vi } from "vitest"

import { CONFIG } from "../config"
import { buildMazeActionState, executeActionWithFeedback } from "./context"
import type { MazeAction, MoveAction, State, TraversalHistoryEntry } from "../types"

function agentVisit(row: number, col: number): TraversalHistoryEntry {
  return { playerName: "Blue", row, col }
}

function selfVisit(row: number, col: number): TraversalHistoryEntry {
  return { playerName: CONFIG.runtime.interactivePlayerName, row, col }
}

const expectedAgentPrompt = [
  "Your name is Blue.",
  `playerName ${CONFIG.runtime.interactivePlayerName} always appears first in traversalHistory and marks the start cell.`,
  "Use currentCell as your current position and destinationCell as the target.",
  "Use traversalHistory entries matching your playerName to review your past moves in order.",
  "Explore carefully: prefer unvisited cells and submit shorter predictions when uncertain.",
  "Return only a JSON object matching expectedResponseSchema.",
  "Moves replay in order until the destination or the first invalid move.",
  "Every submitted move counts toward score decay, including moves after the first invalid move.",
  "Stop predicting when lastMoveStatus is reached-target or status is won.",
  "Choose the moves most likely to reach the destination with the fewest submitted moves.",
].join(" ")

const expectedResponseSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["moves"],
  properties: {
    moves: {
      type: "array",
      minItems: 1,
      items: {
        type: "string",
        enum: ["MoveUp", "MoveDown", "MoveLeft", "MoveRight"],
      },
    },
  },
}

const expectedLastSubmittedMovesSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "array",
  description: "Zero-based replay records formatted as <index>:<move>.",
  items: {
    type: "string",
    pattern: "^(0|[1-9][0-9]*):(MoveUp|MoveDown|MoveLeft|MoveRight)$",
    examples: ["0:MoveRight"],
  },
}

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
    traversalHistory: [selfVisit(0, 0)],
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
        state.traversalHistory = [selfVisit(0, 0), agentVisit(0, 1)]
      }
    }),
    model: "llama3.2",
    playerName: "Blue",
  }
}

// moveAction keeps the flattened action payload concise in expectations.
function moveAction(type: MoveAction): MazeAction {
  return { type }
}

// These tests lock down the compact command feedback returned to agent callers.
describe("cmd feedback", () => {
  it("rejects empty traversal history before building agent context", () => {
    expect(() =>
      buildMazeActionState(
        createState({ traversalHistory: [] }),
        "Blue",
        "llama3.2",
      ),
    ).toThrow("traversalHistory must include the known start cell")
  })

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
      traversalHistory: [selfVisit(0, 0)],
      lastPlayerName: "Blue",
      level: 4,
      score: 700,
      model: "llama3.2",
      stream: false,
      format: "json",
      status: "paused",
      recommendedAvgPredictionLimit: 18,
      prompt: expectedAgentPrompt,
      expectedResponseSchema,
      lastMoveStatus: "invalid-move",
      lastSubmittedMovesIndexBase: 0,
      lastSubmittedMovesSchema: expectedLastSubmittedMovesSchema,
      lastSubmittedMoves: ["0:MoveLeft"],
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
      traversalHistory: [selfVisit(0, 0)],
      lastPlayerName: "Blue",
      level: 4,
      score: 700,
      model: "llama3.2",
      stream: false,
      format: "json",
      status: "running",
      recommendedAvgPredictionLimit: 18,
      prompt: expectedAgentPrompt,
      expectedResponseSchema,
      lastMoveStatus: "invalid-move",
      lastSubmittedMovesIndexBase: 0,
      lastSubmittedMovesSchema: expectedLastSubmittedMovesSchema,
      lastSubmittedMoves: ["0:MoveRight"],
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
        state.traversalHistory = [selfVisit(0, 0), agentVisit(0, 1)]
        state.status = "won"
      }
    })

    expect(
      executeActionWithFeedback(moveAction("MoveRight"), context),
    ).toEqual({
      currentCell: { row: 0, col: 1 },
      destinationCell: { row: 0, col: 1 },
      traversalHistory: [selfVisit(0, 0), agentVisit(0, 1)],
      lastPlayerName: "Blue",
      level: 4,
      score: 700,
      model: "llama3.2",
      stream: false,
      format: "json",
      status: "won",
      recommendedAvgPredictionLimit: 18,
      prompt: expectedAgentPrompt,
      expectedResponseSchema,
      lastMoveStatus: "reached-target",
      visitedBefore: false,
      lastSubmittedMovesIndexBase: 0,
      lastSubmittedMovesSchema: expectedLastSubmittedMovesSchema,
      lastSubmittedMoves: ["0:MoveRight"],
      lastValidMoveIndex: 0,
      decayedMovesCount: 0,
    })
    expect(context.handleMove).toHaveBeenCalledWith("MoveRight", "Blue")
  })

  it("keeps traversal history stable when a move revisits an older cell", () => {
    const state = createState({
      playerPosition: { x: 3, y: 1 },
      traversalHistory: [selfVisit(0, 0), agentVisit(0, 1)],
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
      traversalHistory: [selfVisit(0, 0), agentVisit(0, 1)],
      lastPlayerName: "Blue",
      level: 4,
      score: 700,
      model: "llama3.2",
      stream: false,
      format: "json",
      status: "running",
      recommendedAvgPredictionLimit: 18,
      prompt: expectedAgentPrompt,
      expectedResponseSchema,
      lastMoveStatus: "applied",
      visitedBefore: true,
      lastSubmittedMovesIndexBase: 0,
      lastSubmittedMovesSchema: expectedLastSubmittedMovesSchema,
      lastSubmittedMoves: ["0:MoveLeft"],
      lastValidMoveIndex: 0,
      decayedMovesCount: 0,
    })
  })
})
