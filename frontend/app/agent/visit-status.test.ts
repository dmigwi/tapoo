import { describe, expect, it } from "vitest"

import { cellVisitStatus } from "./context"
import { generateMaze } from "../maze"
import type { PRNGGenerator } from "../maze"
import {
  MOVE_DELTAS,
  cellCoordinateFromGridPoint,
  createMazeDimensions,
  mazeCellKey,
  openMovesFromCell,
} from "../traversal"
import type { CellCoordinate, TraversalHistoryEntry } from "../types"

// createXorshift128Generator matches app/maze.test.ts and maze/bench's Go port, so these walks run
// against real generated mazes rather than hand-built fixtures while staying reproducible.
function createXorshift128Generator(seed: number): PRNGGenerator {
  let [x, y, z, w] = [seed || 1, 362436069, 521288629, 88675123]

  return (limit: number): number => {
    if (limit <= 0) {
      return 0
    }

    const t = x ^ (x << 11)
    x = y
    y = z
    z = w
    w = (w ^ (w >>> 19)) ^ (t ^ (t >>> 8))
    return (w >>> 0) % limit
  }
}

const MAZE_SHAPES = [[8, 6], [10, 10], [7, 12], [6, 6]] as const
const SEEDS = [1, 2, 3, 7, 11, 42, 99, 1234, 555, 777]

type Walk = {
  entries: Map<string, TraversalHistoryEntry>
  neighboursOf: (cell: CellCoordinate) => CellCoordinate[]
  totalCells: number
}

// walkMaze replays a whole level the way game.ts's movePlayer maintains history - one entry per cell,
// visitCount incremented on re-entry - choosing moves the way the prompt instructs (prefer unvisited,
// otherwise explored), and calls back on every step so a test can audit mid-walk state.
function walkMaze(
  seed: number,
  numCols: number,
  numRows: number,
  onStep: (walk: Walk, current: CellCoordinate) => void,
): void {
  const dimensions = { ...createMazeDimensions({ numCols, numRows }), level: 1 }
  const round = generateMaze(dimensions, 1, undefined, createXorshift128Generator(seed))
  const entries = new Map<string, TraversalHistoryEntry>()
  const neighboursOf = (cell: CellCoordinate): CellCoordinate[] =>
    openMovesFromCell(round.maze, cell).map((move) => {
      const [rowDelta, colDelta] = MOVE_DELTAS[move]
      return { row: cell.row + rowDelta, col: cell.col + colDelta }
    })

  const enter = (cell: CellCoordinate): void => {
    const key = mazeCellKey(cell)
    const found = entries.get(key)
    if (found) {
      found.visitCount += 1
      return
    }

    entries.set(key, {
      ...cell,
      playerName: "Blue",
      visitCount: 1,
      openMoves: openMovesFromCell(round.maze, cell),
    })
  }

  const totalCells = numCols * numRows
  let current = cellCoordinateFromGridPoint(round.startPosition)
  enter(current)

  while (entries.size < totalCells) {
    onStep({ entries, neighboursOf, totalCells }, current)

    const options = neighboursOf(current).map((cell) => ({
      cell,
      status: cellVisitStatus(entries.get(mazeCellKey(cell))),
    }))
    const live = options.filter((o) => o.status === "unvisited" || o.status === "explored")
    if (live.length === 0) {
      break
    }

    current = (live.find((o) => o.status === "unvisited") ?? live[0]).cell
    enter(current)
  }
}

// leadsToUnvisited asks the question visitStatus stands in for: starting at neighbour, and without
// stepping back through the cell we are standing on, is any unvisited cell reachable? The maze has no
// cycles, so that is exactly "does anything unexplored lie that way".
function leadsToUnvisited(walk: Walk, from: CellCoordinate, standingOn: CellCoordinate): boolean {
  const seen = new Set([mazeCellKey(standingOn)])
  const queue = [from]

  while (queue.length > 0) {
    const cell = queue.shift() as CellCoordinate
    const key = mazeCellKey(cell)
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    if (!walk.entries.has(key)) {
      return true
    }

    for (const next of walk.neighboursOf(cell)) {
      if (!seen.has(mazeCellKey(next))) {
        queue.push(next)
      }
    }
  }

  return false
}

describe("visitStatus navigation guarantees", () => {
  // The property behind telling an agent a backtracking or oscillating move cannot lead to the
  // destination: those labels must never close off a direction that still leads somewhere. Without
  // this, that instruction could strand an agent that had no other option.
  it("never labels a direction dead while unexplored ground still lies that way", () => {
    let labelsChecked = 0
    let saidDeadButLive = 0
    const examples: string[] = []

    for (const seed of SEEDS) {
      for (const [numCols, numRows] of MAZE_SHAPES) {
        walkMaze(seed, numCols, numRows, (walk, current) => {
          for (const neighbour of walk.neighboursOf(current)) {
            const status = cellVisitStatus(walk.entries.get(mazeCellKey(neighbour)))
            if (status !== "backtracking" && status !== "oscillating") {
              continue
            }

            labelsChecked += 1
            if (leadsToUnvisited(walk, neighbour, current)) {
              saidDeadButLive += 1
              if (examples.length < 3) {
                examples.push(`seed ${seed} ${numCols}x${numRows}: ${mazeCellKey(neighbour)} read ${status}`)
              }
            }
          }
        })
      }
    }

    // Guards against the assertion below passing because nothing was ever labelled dead.
    expect(labelsChecked).toBeGreaterThan(150)
    expect(saidDeadButLive, `dead-labelled directions that still led to unexplored ground: ${examples.join("; ")}`)
      .toBe(0)
  })

  // The counterpart to the guarantee above: a live option always exists while the maze is unfinished,
  // so "prefer unvisited, otherwise move through explored" can always be followed.
  it("always leaves an unvisited or explored neighbour while any cell is unreached", () => {
    for (const seed of SEEDS) {
      for (const [numCols, numRows] of MAZE_SHAPES) {
        walkMaze(seed, numCols, numRows, (walk, current) => {
          const statuses = walk.neighboursOf(current).map((cell) =>
            cellVisitStatus(walk.entries.get(mazeCellKey(cell))),
          )
          const live = statuses.filter((s) => s === "unvisited" || s === "explored")

          expect(
            live.length,
            `seed ${seed} ${numCols}x${numRows} stranded at ${mazeCellKey(current)} with ` +
              `${walk.entries.size}/${walk.totalCells} reached; neighbours: ${statuses.join(", ")}`,
          ).toBeGreaterThan(0)
        })
      }
    }
  })
})

// classifyCellType (context.ts) labels structure from exit count; cellVisitStatus labels progress
// from visits against that same count. These pin how the two line up, so the tool description and the
// code cannot drift apart unnoticed.
describe("cellType and visitStatus relationship", () => {
  const MOVES: TraversalHistoryEntry["openMoves"] = ["MoveUp", "MoveRight", "MoveDown", "MoveLeft"]
  const cellWith = (exits: number, visitCount: number): TraversalHistoryEntry => ({
    row: 0, col: 0, playerName: "Blue", visitCount, openMoves: MOVES.slice(0, exits),
  })

  it("never reads explored for a dead-end, whatever its visit count", () => {
    // explored needs 0 < visitCount < openMoves.length. A dead-end has one exit, so that window is
    // 0 < v < 1 - empty for integers, which is why a dead-end reads backtracking from its first visit.
    for (let visitCount = 1; visitCount <= 6; visitCount += 1) {
      expect(cellVisitStatus(cellWith(1, visitCount))).not.toBe("explored")
    }

    expect(cellVisitStatus(cellWith(1, 1))).toBe("backtracking")
    expect(cellVisitStatus(cellWith(1, 2))).toBe("oscillating")
    // Only absence of an entry reads unvisited - never a count.
    expect(cellVisitStatus(undefined)).toBe("unvisited")
  })

  it("keeps a cell explored for one fewer visit than it has exits", () => {
    // The wider the cell, the longer it legitimately stays a live route.
    const lastExploredVisit = { corridor: 1, junction3: 2, junction4: 3 }

    for (const [name, exits] of [["corridor", 2], ["junction3", 3], ["junction4", 4]] as const) {
      for (let visitCount = 1; visitCount <= lastExploredVisit[name]; visitCount += 1) {
        expect(cellVisitStatus(cellWith(exits, visitCount)), `${name} v${visitCount}`).toBe("explored")
      }

      expect(cellVisitStatus(cellWith(exits, exits)), `${name} v${exits}`).toBe("backtracking")
      expect(cellVisitStatus(cellWith(exits, exits + 1)), `${name} v${exits + 1}`).toBe("oscillating")
    }
  })
})
