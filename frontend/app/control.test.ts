import { describe, expect, it, vi } from "vitest"

import { CONFIG } from "./config"
import {
  executeActionWithFeedback,
} from "./control"
import type { ResolvedPlayerMove } from "./traversal"
import type {
  MazeAction,
  MazeActionResult,
  MoveAction,
  State,
  TraversalHistoryEntry,
} from "./types"

function agentVisit(row: number, col: number): TraversalHistoryEntry {
  return { playerName: "Blue", row, col, openMoves: [], visitCount: 1 }
}

function selfVisit(row: number, col: number): TraversalHistoryEntry {
  return { playerName: CONFIG.runtime.interactivePlayerName, row, col, openMoves: [], visitCount: 1 }
}

const expectedLastSubmittedMovesSchema: NonNullable<
  MazeActionResult["lastSubmittedMovesSchema"]
> = {
  type: "array",
  description: "Zero-based submitted-move entries formatted as <index>:<move>.",
  items: {
    type: "string",
    pattern: "^(0|[1-9][0-9]*):(MoveUp|MoveDown|MoveLeft|MoveRight)$",
    examples: ["0:MoveRight", "1:MoveUp", "2:MoveRight"],
  },
}

// createState builds a compact runtime state for movement feedback tests.
function createState(overrides: Partial<State> = {}): State {
  return {
    controlMode: CONFIG.runtime.controlModes.agentApi,
    level: 4,
    restartLevel: 1,
    mazeDimensions: { numCols: 2, numRows: 1, area: 2 },
    maze: [
      ["|", "---", "|", "---", "|"],
      ["|", "   ", " ", "   ", "|"],
      ["|", "---", "|", "---", "|"],
    ],
    startPosition: { x: 1, y: 1 },
    playerPosition: { x: 1, y: 1 },
    traversalHistory: [selfVisit(0, 0)],
    finalPosition: { x: 3, y: 1 },
    status: "running",
    score: 700,
    lastRoundScore: 0,
    lastAttemptRetentionUnits: null,
    bestWinRetentionUnits: null,
    lastWinTraversalSpeedUnits: null,
    bestWinTraversalSpeedUnits: null,
    winSummary: "",
    wallWeight: 1,
    scoreDecayUnits: 0,
    turnCount: 0,
    cumulativeRoundCount: 0,
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
  const movePlayer = vi.fn((moveEvaluation: ResolvedPlayerMove, playerName: string) => {
    if (!moveEvaluation.canMove) {
      return
    }

    state.playerPosition = moveEvaluation.nextGridPoint
    if (!moveEvaluation.visitedBefore) {
      state.traversalHistory = [
        ...state.traversalHistory,
        { ...moveEvaluation.nextCell, playerName, openMoves: [], visitCount: 1 },
      ]
    }
  })

  return {
    state,
    playerName: "Blue",
    handlers: {
      state,
      pauseGame: vi.fn(),
      awaitAgent: vi.fn(),
      restartGame: vi.fn(),
      resumeOrProceed: vi.fn(),
      cycleWallWeight: vi.fn(),
      movePlayer,
      recordActionResult: vi.fn(),
    },
  }
}

// moveAction keeps the flattened action payload concise in expectations.
function moveAction(type: MoveAction): MazeAction {
  return { type }
}

// These tests lock down the compact command feedback returned to agent callers.
describe("control", () => {
  it("reports when movement is unavailable", () => {
    const state = createState({
      status: "paused",
      clock: createClock(),
    })
    const context = createContext(state)

    const actionResult = executeActionWithFeedback(
      moveAction("MoveLeft"),
      context.playerName,
      context.handlers,
    )

    expect(actionResult).toEqual({
      lastPlayerName: "Blue",
      lastMoveStatus: "invalid-move",
      lastReplayStartIndex: 0,
      lastSubmittedMovesSchema: expectedLastSubmittedMovesSchema,
      lastSubmittedMoves: ["0:MoveLeft"],
      lastAppliedMoveIndex: null,
      chargedMovesCount: 0,
    })
    expect(context.handlers.movePlayer).not.toHaveBeenCalled()
    expect(context.handlers.recordActionResult).toHaveBeenCalledWith(actionResult)
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

    const actionResult = executeActionWithFeedback(
      moveAction("MoveRight"),
      context.playerName,
      context.handlers,
    )

    expect(actionResult).toEqual({
      lastPlayerName: "Blue",
      lastMoveStatus: "invalid-move",
      lastReplayStartIndex: 0,
      lastSubmittedMovesSchema: expectedLastSubmittedMovesSchema,
      lastSubmittedMoves: ["0:MoveRight"],
      lastAppliedMoveIndex: null,
      chargedMovesCount: 0,
    })
    expect(context.handlers.movePlayer).not.toHaveBeenCalled()
    expect(context.handlers.recordActionResult).toHaveBeenCalledWith(actionResult)
  })

  it("reports when a move reaches the destination", () => {
    const state = createState()
    const context = createContext(state)
    context.handlers.movePlayer.mockImplementationOnce((moveEvaluation: ResolvedPlayerMove, playerName: string) => {
      if (!moveEvaluation.canMove) {
        return
      }

      state.playerPosition = moveEvaluation.nextGridPoint
      if (!moveEvaluation.visitedBefore) {
        state.traversalHistory = [
          ...state.traversalHistory,
          { ...moveEvaluation.nextCell, playerName, openMoves: [], visitCount: 1 },
        ]
      }
      state.status = "won"
    })

    const actionResult = executeActionWithFeedback(
      moveAction("MoveRight"),
      context.playerName,
      context.handlers,
    )

    expect(actionResult).toEqual({
      lastPlayerName: "Blue",
      lastMoveStatus: "reached-target",
      visitedBefore: false,
      lastReplayStartIndex: 0,
      lastSubmittedMovesSchema: expectedLastSubmittedMovesSchema,
      lastSubmittedMoves: ["0:MoveRight"],
      lastAppliedMoveIndex: 0,
      chargedMovesCount: 0,
    })
    expect(context.handlers.movePlayer).toHaveBeenCalledWith(
      {
        canMove: true,
        nextCell: { row: 0, col: 1 },
        nextGridPoint: { x: 3, y: 1 },
        visitedBefore: false,
      },
      "Blue",
    )
    expect(context.handlers.recordActionResult).toHaveBeenCalledWith(actionResult)
  })

  it("keeps traversal history stable when a move revisits an older cell", () => {
    const state = createState({
      playerPosition: { x: 3, y: 1 },
      traversalHistory: [selfVisit(0, 0), agentVisit(0, 1)],
    })
    const context = createContext(state)
    context.handlers.movePlayer.mockImplementationOnce((moveEvaluation: ResolvedPlayerMove) => {
      if (!moveEvaluation.canMove) {
        return
      }

      state.playerPosition = moveEvaluation.nextGridPoint
    })

    const actionResult = executeActionWithFeedback(
      moveAction("MoveLeft"),
      context.playerName,
      context.handlers,
    )

    expect(actionResult).toEqual({
      lastPlayerName: "Blue",
      lastMoveStatus: "applied",
      visitedBefore: true,
      lastReplayStartIndex: 0,
      lastSubmittedMovesSchema: expectedLastSubmittedMovesSchema,
      lastSubmittedMoves: ["0:MoveLeft"],
      lastAppliedMoveIndex: 0,
      chargedMovesCount: 0,
    })
    expect(context.handlers.recordActionResult).toHaveBeenCalledWith(actionResult)
  })
})
