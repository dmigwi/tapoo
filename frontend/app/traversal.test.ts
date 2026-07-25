import { describe, expect, it } from "vitest"

import { CONFIG } from "./config"
import {
  cellCoordinateFromGridPoint,
  cloneTraversalHistory,
  createMazeDimensions,
  gridPointFromCellCoordinate,
  isMoveAction,
  isSpaceFound,
  isValidPersistedRound,
  isWallWeight,
  mazeCellKey,
  nextWallWeight,
  resolvePlayerMove,
  reweightMaze,
  traversalHistoryEntry,
  traversalHistoryIncludes,
} from "./traversal"
import type {
  MazeAction,
  PersistedRound,
  State,
  TraversalHistoryEntry,
} from "./types"

function selfVisit(row: number, col: number): TraversalHistoryEntry {
  return { playerName: "Self", row, col, openMoves: [] }
}

function createState(overrides: Partial<State> = {}): State {
  return {
    controlMode: CONFIG.runtime.controlModes.interactive,
    level: 1,
    maze: [
      ["|", "---", "-", "---", "|"],
      ["|", "   ", " ", "   ", "|"],
      ["|", "---", "-", "---", "|"],
    ],
    mazeDimensions: { numCols: 2, numRows: 1, area: 2 },
    playerPosition: { x: 1, y: 1 },
    traversalHistory: [selfVisit(0, 0)],
    finalPosition: { x: 3, y: 1 },
    status: "running",
    score: 100,
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
    cumulativeRoundCount: 0,
    clock: null,
    ...overrides,
  }
}

function createPersistedRound(
  overrides: Partial<PersistedRound> = {},
): PersistedRound {
  return {
    level: 1,
    mazeDimensions: { numCols: 2, numRows: 1, area: 2 },
    maze: [
      ["|", "---", "-", "---", "|"],
      ["|", "   ", " ", "   ", "|"],
      ["|", "---", "-", "---", "|"],
    ],
    startCell: { row: 0, col: 0 },
    traversalHistory: [selfVisit(0, 0)],
    playerPosition: { x: 1, y: 1 },
    finalPosition: { x: 3, y: 1 },
    wallWeight: 1,
    status: "running",
    score: 200,
    lastRoundScore: 0,
    remainingMs: 1500,
    ...overrides,
  }
}

// These tests cover the traversal-only helpers kept separate from maze generation.
describe("traversal", () => {
  it("accepts supported wall weights and cycles them in order", () => {
    expect(isWallWeight(1)).toBe(true)
    expect(isWallWeight(2)).toBe(true)
    expect(isWallWeight(3)).toBe(true)
    expect(isWallWeight(4)).toBe(false)

    expect(nextWallWeight(1)).toBe(2)
    expect(nextWallWeight(2)).toBe(3)
    expect(nextWallWeight(3)).toBe(1)
  })

  it("treats maze paths as space-prefixed segments", () => {
    expect(isSpaceFound("   ")).toBe(true)
    expect(isSpaceFound(" wall")).toBe(true)
    expect(isSpaceFound("|")).toBe(false)
    expect(isSpaceFound("")).toBe(false)
  })

  it("reweights maze walls without changing open paths", () => {
    const regularMaze = [
      ["|", "---", "|"],
      ["|", "   ", "|"],
      ["|", "-", "|"],
    ]

    expect(reweightMaze(regularMaze, 1)).toEqual([
      ["╏", "╍╍╍", "╏"],
      ["╏", "   ", "╏"],
      ["╏", "╍", "╏"],
    ])
  })

  it("classifies only movement actions as maze moves", () => {
    expect(isMoveAction({ type: "MoveRight" })).toBe(true)
    expect(isMoveAction({ type: "pause" })).toBe(false)
    expect(isMoveAction({ type: "await-agent" })).toBe(false)
    expect(isMoveAction({ type: "Unknown" } as unknown as MazeAction)).toBe(false)
  })

  it("converts between render-grid points and logical cell coordinates", () => {
    expect(cellCoordinateFromGridPoint({ x: 1, y: 1 })).toEqual({ row: 0, col: 0 })
    expect(cellCoordinateFromGridPoint({ x: 3, y: 1 })).toEqual({ row: 0, col: 1 })
    expect(gridPointFromCellCoordinate({ row: 2, col: 3 })).toEqual({ x: 7, y: 5 })
  })

  it("creates maze dimensions with their logical cell area", () => {
    expect(createMazeDimensions({ numCols: 4, numRows: 3 })).toEqual({
      numCols: 4,
      numRows: 3,
      area: 12,
    })
  })

  it("tracks traversal history entries by logical cell identity", () => {
    const currentVisit = traversalHistoryEntry({ row: 0, col: 1 }, "Blue", null)
    const history = [selfVisit(0, 0), currentVisit]

    expect(currentVisit).toEqual({ playerName: "Blue", row: 0, col: 1, openMoves: [] })
    expect(mazeCellKey(currentVisit)).toBe("0:1")
    expect(traversalHistoryIncludes(history, { row: 0, col: 1 })).toBe(true)
    expect(traversalHistoryIncludes(history, { row: 1, col: 0 })).toBe(false)
  })

  it("clones only traversal histories that include the known start cell", () => {
    const history = [selfVisit(0, 0), traversalHistoryEntry({ row: 0, col: 1 }, "Blue", null)]
    const clone = cloneTraversalHistory(history)

    expect(clone).toEqual(history)
    expect(clone).not.toBe(history)
    expect(clone[0]).not.toBe(history[0])
    expect(() => cloneTraversalHistory([])).toThrow(
      "traversalHistory must include the known start cell",
    )
  })

  it("resolves a valid player move without mutating state", () => {
    const state = createState()

    expect(resolvePlayerMove(state, "MoveRight")).toEqual({
      canMove: true,
      nextCell: { row: 0, col: 1 },
      nextGridPoint: { x: 3, y: 1 },
      visitedBefore: false,
    })
    expect(state.playerPosition).toEqual({ x: 1, y: 1 })
    expect(state.traversalHistory).toEqual([selfVisit(0, 0)])
  })

  it("marks revisits without duplicating traversal history", () => {
    const state = createState({
      playerPosition: { x: 3, y: 1 },
      traversalHistory: [selfVisit(0, 0), selfVisit(0, 1)],
    })

    expect(resolvePlayerMove(state, "MoveLeft")).toEqual({
      canMove: true,
      nextCell: { row: 0, col: 0 },
      nextGridPoint: { x: 1, y: 1 },
      visitedBefore: true,
    })
    expect(state.traversalHistory).toEqual([selfVisit(0, 0), selfVisit(0, 1)])
  })

  it("rejects movement when the round is not running, blocked, or out of bounds", () => {
    expect(resolvePlayerMove(createState({ status: "paused" }), "MoveRight")).toEqual({
      canMove: false,
    })

    expect(
      resolvePlayerMove(
        createState({
          maze: [
            ["|", "---", "-", "---", "|"],
            ["|", "   ", "|", "   ", "|"],
            ["|", "---", "-", "---", "|"],
          ],
        }),
        "MoveRight",
      ),
    ).toEqual({ canMove: false })

    expect(resolvePlayerMove(createState(), "MoveLeft")).toEqual({
      canMove: false,
    })
  })

  it("accepts internally consistent persisted rounds", () => {
    expect(isValidPersistedRound(createPersistedRound())).toBe(true)
  })

  it("rejects persisted rounds with impossible dimensions or blocked positions", () => {
    expect(
      isValidPersistedRound(
        createPersistedRound({
          mazeDimensions: { numCols: 2, numRows: 1, area: 999 },
        }),
      ),
    ).toBe(false)

    expect(
      isValidPersistedRound(
        createPersistedRound({
          playerPosition: { x: 2, y: 0 },
        }),
      ),
    ).toBe(false)
  })

  it("rejects persisted traversal history that is empty, duplicated, or starts elsewhere", () => {
    expect(
      isValidPersistedRound(
        createPersistedRound({
          traversalHistory: [],
        }),
      ),
    ).toBe(false)

    expect(
      isValidPersistedRound(
        createPersistedRound({
          traversalHistory: [selfVisit(0, 0), selfVisit(0, 0)],
        }),
      ),
    ).toBe(false)

    expect(
      isValidPersistedRound(
        createPersistedRound({
          traversalHistory: [selfVisit(0, 1)],
        }),
      ),
    ).toBe(false)
  })
})
