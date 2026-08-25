import { describe, expect, it } from "vitest"

import { CONFIG } from "./config"
import {
  cellCoordinateFromGridPoint,
  cloneTraversalHistory,
  createMazeDimensions,
  findTraversalHistoryEntry,
  gridPointFromCellCoordinate,
  isMoveAction,
  isSpaceFound,
  isTraversalHistoryEntry,
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
  MoveAction,
  PersistedRound,
  State,
  TraversalHistoryEntry,
  WallWeight,
} from "./types"

// The two lists below are built from a record keyed by the union rather than written as an annotated
// array, because `const x: MoveAction[] = [...]` only asks that each element belong to the union and
// never that the list be complete — a stale list stays valid as the union grows, and the tests that
// walk it keep their old coverage in silence. A missing key is a compile error instead.
function valuesOf<T extends string>(members: Record<T, true>): T[] {
  return Object.keys(members) as T[]
}

// numericValuesOf is the same guarantee for number-keyed unions, where Object.keys hands back the
// numeric keys as strings and has to be converted back.
function numericValuesOf<T extends number>(members: Record<T, true>): T[] {
  return Object.keys(members).map(Number) as T[]
}

const ALL_MOVE_ACTIONS = valuesOf<MoveAction>({
  "MoveUp": true,
  "MoveDown": true,
  "MoveLeft": true,
  "MoveRight": true,
})

const ALL_WALL_WEIGHTS = numericValuesOf<WallWeight>({
  1: true,
  2: true,
  3: true,
})

function selfVisit(row: number, col: number): TraversalHistoryEntry {
  return { playerName: "Self", row, col, openMoves: [], visitCount: 1 }
}

function createState(overrides: Partial<State> = {}): State {
  return {
    controlMode: CONFIG.runtime.controlModes.interactive,
    level: 1,
    restartLevel: 1,
    maze: [
      ["|", "---", "-", "---", "|"],
      ["|", "   ", " ", "   ", "|"],
      ["|", "---", "-", "---", "|"],
    ],
    mazeDimensions: { numCols: 2, numRows: 1, area: 2 },
    startPosition: { x: 1, y: 1 },
    playerPosition: { x: 1, y: 1 },
    traversalHistory: [selfVisit(0, 0)],
    finalPosition: { x: 3, y: 1 },
    status: "running",
    score: 100,
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

const persistedRoundMaze = [
  ["|", "---", "-", "---", "|"],
  ["|", "   ", " ", "   ", "|"],
  ["|", "---", "-", "---", "|"],
]

function createPersistedRound(
  overrides: Partial<PersistedRound> = {},
): PersistedRound {
  return {
    level: 1,
    mazeDimensions: { numCols: 2, numRows: 1, area: 2 },
    maze: persistedRoundMaze,
    startCell: { row: 0, col: 0 },
    // openMoves must reflect the actual maze above, since isValidPersistedRound now recomputes
    // and cross-checks it against the restored maze rather than trusting the stored value.
    traversalHistory: [traversalHistoryEntry({ row: 0, col: 0 }, "Self", persistedRoundMaze)],
    startPosition: { x: 1, y: 1 },
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
  it("accepts every supported wall weight and cycles through all of them", () => {
    ALL_WALL_WEIGHTS.forEach((weight) => {
      expect(isWallWeight(weight)).toBe(true)
    })
    expect(isWallWeight(0)).toBe(false)
    expect(isWallWeight(ALL_WALL_WEIGHTS.length + 1)).toBe(false)

    // Stepping once per weight has to visit each exactly once and land back on the start. Spelling
    // the rotation out as 1→2→3→1 would keep passing if a fourth weight were added but left out of
    // the cycle, stranding a weight the wall button could never reach.
    const visited: WallWeight[] = []
    let weight = ALL_WALL_WEIGHTS[0]
    ALL_WALL_WEIGHTS.forEach(() => {
      weight = nextWallWeight(weight)
      visited.push(weight)
    })

    expect([...visited].sort()).toEqual([...ALL_WALL_WEIGHTS].sort())
    expect(weight).toBe(ALL_WALL_WEIGHTS[0])
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
    // Every MoveAction has to be accepted, not just a sample: isMoveAction gates agent-supplied
    // moves against MOVE_DELTAS, so a move added to the union but never given a delta would be
    // rejected at runtime while the type says it is legal.
    ALL_MOVE_ACTIONS.forEach((move) => {
      expect(isMoveAction({ type: move })).toBe(true)
    })

    expect(isMoveAction({ type: "pause" })).toBe(false)
    expect(isMoveAction({ type: "await-agent" })).toBe(false)
    expect(isMoveAction({ type: "Unknown" } as unknown as MazeAction)).toBe(false)
  })

  it("rejects inherited Object.prototype keys as maze moves", () => {
    // MOVE_DELTAS is a plain object, so a naive `in` check would treat inherited keys like
    // "constructor" or "toString" as valid moves even though they were never assigned as own
    // properties. An agent response of {"moves":["constructor"]} must not slip past validation.
    expect(isMoveAction({ type: "constructor" } as unknown as MazeAction)).toBe(false)
    expect(isMoveAction({ type: "toString" } as unknown as MazeAction)).toBe(false)
    expect(isMoveAction({ type: "hasOwnProperty" } as unknown as MazeAction)).toBe(false)
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

    expect(currentVisit).toEqual({ playerName: "Blue", row: 0, col: 1, openMoves: [], visitCount: 1 })
    expect(mazeCellKey(currentVisit)).toBe("0:1")
    expect(traversalHistoryIncludes(history, { row: 0, col: 1 })).toBe(true)
    expect(traversalHistoryIncludes(history, { row: 1, col: 0 })).toBe(false)
  })

  it("finds the single entry recording a cell so callers can bump its visitCount", () => {
    const revisited = { ...selfVisit(0, 1), visitCount: 3 }
    const history = [selfVisit(0, 0), revisited]

    // Returns the live entry, not a copy — game.ts mutates visitCount straight through it.
    expect(findTraversalHistoryEntry(history, { row: 0, col: 1 })).toBe(revisited)
    expect(findTraversalHistoryEntry(history, { row: 9, col: 9 })).toBeUndefined()
  })

  it("clones only traversal histories that include the known start cell", () => {
    // The first entry carries a visitCount above 1 deliberately: cloneTraversalHistory copies fields
    // by explicit destructuring, so a clone that hardcoded or dropped the count would still pass
    // against an all-ones fixture.
    const history = [
      { ...selfVisit(0, 0), visitCount: 4 },
      traversalHistoryEntry({ row: 0, col: 1 }, "Blue", null),
    ]
    const clone = cloneTraversalHistory(history)

    expect(clone).toEqual(history)
    expect(clone[0].visitCount).toBe(4)
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

  it("rejects a persisted round whose stored openMoves no longer match the restored maze", () => {
    // A stale or tampered snapshot could claim exits that don't exist in the actual maze; since
    // that history is later sent to agents as ground truth, it must be cross-checked, not trusted.
    expect(
      isValidPersistedRound(
        createPersistedRound({
          traversalHistory: [{ playerName: "Self", row: 0, col: 0, openMoves: ["MoveDown"], visitCount: 1 }],
        }),
      ),
    ).toBe(false)
  })

  it("rejects a traversal history entry whose openMoves include inherited Object.prototype keys", () => {
    // Same prototype-pollution concern as isMoveAction: openMoves is restored from persisted or
    // agent-supplied data, so "constructor" must not be accepted as a valid move direction.
    expect(
      isTraversalHistoryEntry({
        playerName: "Self", row: 0, col: 0, openMoves: ["constructor"], visitCount: 1,
      }),
    ).toBe(false)
    expect(
      isTraversalHistoryEntry({
        playerName: "Self", row: 0, col: 0, openMoves: ["MoveRight"], visitCount: 1,
      }),
    ).toBe(true)
  })

  it("rejects a traversal history entry whose visitCount is missing or below one", () => {
    // An entry only exists once its cell has been stood on, so anything under 1 is corrupt rather
    // than merely unset — accepting it would understate how worked-over the cell is, which is
    // exactly what agent/context.ts reads to derive visitStatus.
    const validEntry = { playerName: "Self", row: 0, col: 0, openMoves: ["MoveRight"] }

    expect(isTraversalHistoryEntry({ ...validEntry })).toBe(false)
    expect(isTraversalHistoryEntry({ ...validEntry, visitCount: 0 })).toBe(false)
    expect(isTraversalHistoryEntry({ ...validEntry, visitCount: -1 })).toBe(false)
    expect(isTraversalHistoryEntry({ ...validEntry, visitCount: 1.5 })).toBe(false)
    expect(isTraversalHistoryEntry({ ...validEntry, visitCount: "2" })).toBe(false)
    expect(isTraversalHistoryEntry({ ...validEntry, visitCount: 3 })).toBe(true)
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
          startPosition: { x: 2, y: 0 },
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

  it("rejects a persisted round whose start position disagrees with its start cell", () => {
    expect(
      isValidPersistedRound(
        createPersistedRound({
          startPosition: { x: 3, y: 1 },
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
