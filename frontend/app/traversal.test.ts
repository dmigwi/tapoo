import { describe, expect, it } from "vitest"

import { CONFIG } from "./config"
import {
  cellCoordinateFromGridPoint,
  createMazeDimensions,
  gridPointFromCellCoordinate,
  isMoveAction,
  isSpaceFound,
  isWallWeight,
  mazeCellKey,
  nextWallWeight,
  resolvePlayerMove,
  reweightMaze,
  traversalHistoryEntry,
  traversalHistoryIncludes,
} from "./traversal"
import type { MazeAction, State, TraversalHistoryEntry } from "./types"

function visit(row: number, col: number): TraversalHistoryEntry {
  return { playerName: "Self", row, col }
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
    mazeDimensions: { length: 2, width: 1, area: 2 },
    playerPosition: { x: 1, y: 1 },
    traversalHistory: [visit(0, 0)],
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
    clock: null,
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
    expect(createMazeDimensions({ length: 4, width: 3 })).toEqual({
      length: 4,
      width: 3,
      area: 12,
    })
  })

  it("tracks traversal history entries by logical cell identity", () => {
    const currentVisit = traversalHistoryEntry({ row: 0, col: 1 }, "Blue")
    const history = [visit(0, 0), currentVisit]

    expect(currentVisit).toEqual({ playerName: "Blue", row: 0, col: 1 })
    expect(mazeCellKey(currentVisit)).toBe("0:1")
    expect(traversalHistoryIncludes(history, { row: 0, col: 1 })).toBe(true)
    expect(traversalHistoryIncludes(history, { row: 1, col: 0 })).toBe(false)
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
    expect(state.traversalHistory).toEqual([visit(0, 0)])
  })

  it("marks revisits without duplicating traversal history", () => {
    const state = createState({
      playerPosition: { x: 3, y: 1 },
      traversalHistory: [visit(0, 0), visit(0, 1)],
    })

    expect(resolvePlayerMove(state, "MoveLeft")).toEqual({
      canMove: true,
      nextCell: { row: 0, col: 0 },
      nextGridPoint: { x: 1, y: 1 },
      visitedBefore: true,
    })
    expect(state.traversalHistory).toEqual([visit(0, 0), visit(0, 1)])
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
})
