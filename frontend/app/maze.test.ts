import { describe, expect, it } from "vitest"

import {
  generateMaze,
  getNavigationProfile,
  getMazeDimensions,
} from "./maze"
import { encodeMazeForLog } from "./logs"
import type { PRNGGenerator } from "./maze"
import { createMazeDimensions, openMovesFromCell } from "./traversal"
import type { BaseDimensions, LevelDimensions } from "./types"

// createXorshift128Generator is a small, deterministic PRNGGenerator for tests — a real varied
// pseudorandom sequence, reproducible from a fixed seed, standing in for getPRNGInt. This replaces
// mocking crypto.getRandomValues directly, which coupled tests to getPRNGInt's own internal
// rejection-sampling/Uint32Array details rather than just the PRNGGenerator contract every caller
// actually depends on.
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

// This modeled terminal room approximates a 14-inch MacBook-class browser viewport:
// physical panel 3024x1964px, CSS viewport about 1512x982px after device scaling,
// 10 measured PT Mono sample characters about 60 CSS px, and one text row about 11 CSS px.
// After app insets are removed, the browser maze receives 61 columns by 39 rows of room.
const macbookBrowserTerminalSize = { numCols: 61, numRows: 39 }

function createLevelDimensions(level: number, dimensions: BaseDimensions): LevelDimensions {
  return { ...createMazeDimensions(dimensions), level }
}

// These tests keep maze sizing, navigation tuning, and deterministic carving stable.
describe("maze", () => {
  it("returns the preferred maze dimensions for a fitting viewport", () => {
    expect(getMazeDimensions(1, { numCols: 20, numRows: 20 })).toEqual({
      level: 1,
      numCols: 7,
      numRows: 10,
      area: 70,
    })
  })

  it("prefers balanced maze dimensions before viewport aspect ratio", () => {
    expect(getMazeDimensions(2, { numCols: 30, numRows: 10 })).toEqual({
      level: 2,
      numCols: 10,
      numRows: 8,
      area: 80,
    })
  })

  it("keeps growing maze dimensions for large levels when the viewport can fit them", () => {
    expect(getMazeDimensions(994, { numCols: 100, numRows: 100 })).toEqual({
      level: 994,
      numRows: 100,
      numCols: 100,
      area: 10000,
    })
  })

  it("returns no dimensions when the viewport cannot fit the maze area", () => {
    expect(getMazeDimensions(1, { numCols: 6, numRows: 10 })).toBeNull()
  })

  it("repairs isolated bad area factors without consuming the next level target", () => {
    expect(getMazeDimensions(143, macbookBrowserTerminalSize)).toEqual({
      level: 143,
      numCols: 44,
      numRows: 34,
      area: 1496,
    })
    expect(getMazeDimensions(144, macbookBrowserTerminalSize)).toEqual({
      level: 144,
      numCols: 50,
      numRows: 30,
      area: 1500,
    })
  })

  it("stops at two consecutive undrawable exact level targets", () => {
    // This modeled room keeps the 14-inch browser UX from filling every last drawable cell.
    expect(getMazeDimensions(150, macbookBrowserTerminalSize)).toEqual({
      level: 150,
      numCols: 40,
      numRows: 39,
      area: 1560,
    })
    expect(getMazeDimensions(151, macbookBrowserTerminalSize)).toBeNull()
  })

  it("tightens the navigation profile as maze area grows", () => {
    expect(getNavigationProfile(createMazeDimensions({ numCols: 10, numRows: 11 }))).toEqual({
      __maxCorridorLength: 10,
      __leastNeighborsBias: 100,
    })

    expect(getNavigationProfile(createMazeDimensions({ numCols: 20, numRows: 20 }))).toEqual({
      __maxCorridorLength: 7,
      __leastNeighborsBias: 57,
    })

    expect(getNavigationProfile(createMazeDimensions({ numCols: 30, numRows: 30 }))).toEqual({
      __maxCorridorLength: 5,
      __leastNeighborsBias: 28,
    })

    expect(getNavigationProfile(createMazeDimensions({ numCols: 60, numRows: 60 }))).toEqual({
      __maxCorridorLength: 3,
      __leastNeighborsBias: 0,
    })
  })

  it("cuts junction density as __leastNeighborsBias rises, with the grid held fixed", () => {
    // The test below varies bias and area together, because getNavigationProfile derives the
    // profile from area alone — so on its own it cannot say whether the bias or the size did the
    // work. Overriding the profile pins one square 20x20 grid and moves only the bias. Square
    // because skew is not neutral either: at full bias a skewed grid branches measurably more than a
    // square of the same area, so a non-square grid would leave a second uncontrolled variable.
    const junctionFraction = (bias: number): number => {
      const dimensions = createLevelDimensions(1, { numCols: 20, numRows: 20 })
      const { maze } = generateMaze(dimensions, 1, {
        __maxCorridorLength: 7,
        __leastNeighborsBias: bias,
      })
      let junctions = 0

      for (let row = 0; row < dimensions.numRows; row += 1) {
        for (let col = 0; col < dimensions.numCols; col += 1) {
          if (openMovesFromCell(maze, { row, col }).length >= 3) {
            junctions += 1
          }
        }
      }

      return junctions / dimensions.area
    }

    const average = (bias: number): number =>
      Array.from({ length: 20 }, () => junctionFraction(bias)).reduce(
        (sum, value) => sum + value,
        0,
      ) / 20

    // Generation is random, so this asserts a wide separation rather than an exact figure. The
    // benchmark in maze/bench/levels_bench_test.go reports the full distribution behind these means.
    expect(average(100)).toBeLessThan(average(0) / 2)
  })

  it("cuts junction density for small mazes versus large ones", () => {
    // Covers the wiring players actually get, where the profile is derived rather than supplied.
    // Area and bias move together here by design, so this pins the end-to-end outcome without
    // attributing it — the test above is what isolates the knob.
    const junctionFraction = (dimensions: BaseDimensions): number => {
      const { maze } = generateMaze(createLevelDimensions(1, dimensions), 1)
      let junctions = 0
      let total = 0

      for (let row = 0; row < dimensions.numRows; row += 1) {
        for (let col = 0; col < dimensions.numCols; col += 1) {
          total += 1
          if (openMovesFromCell(maze, { row, col }).length >= 3) {
            junctions += 1
          }
        }
      }

      return junctions / total
    }

    const average = (values: number[]): number =>
      values.reduce((sum, value) => sum + value, 0) / values.length

    // Small maze: area well below friendlyMaxArea, so __leastNeighborsBias resolves to 100.
    const smallMazeJunctionFraction = average(
      Array.from({ length: 20 }, () => junctionFraction({ numCols: 10, numRows: 7 })),
    )
    // Large maze: area at/above hardestArea, so __leastNeighborsBias resolves to 0.
    const largeMazeJunctionFraction = average(
      Array.from({ length: 20 }, () => junctionFraction({ numCols: 40, numRows: 40 })),
    )

    // The gap should be substantial, not a nudge: BenchmarkMazeBranching measures roughly 0.002
    // junctions per cell at area 70 against 0.10 at area 1600.
    expect(smallMazeJunctionFraction).toBeLessThan(largeMazeJunctionFraction / 2)
  })

  it("generates a deterministic maze layout for a fixed random source", () => {
    const round = generateMaze(
      createLevelDimensions(1, { numCols: 5, numRows: 5 }),
      1,
      undefined,
      createXorshift128Generator(1),
    )

    expect(encodeMazeForLog(round.maze)).toEqual({
      index_chars: ["|", "---", "-", "   ", " ", "\n"],
      structure_checksum: "0xa5a0320f868645a2",
      structure:
        "01212101210503434303430501230103030503430343030503210301030503434303430501212103210503434303430503210301230503430343430501210121210",
    })

    expect(round.startPosition).not.toEqual(round.finalPosition)
    expect(round.startPosition).toEqual({ x: 3, y: 9 })
    expect(round.finalPosition).toEqual({ x: 1, y: 1 })
    expect(round.maze[round.startPosition.y][round.startPosition.x]).toBe("   ")
    expect(round.maze[round.finalPosition.y][round.finalPosition.x]).toBe("   ")
  })
})
