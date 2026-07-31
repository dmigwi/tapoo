import { afterEach, describe, expect, it, vi } from "vitest"

import {
  generateMaze,
  getNavigationProfile,
  getMazeDimensions,
} from "./maze"
import { createMazeDimensions, openMovesFromCell } from "./traversal"
import type { BaseDimensions, LevelDimensions } from "./types"

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
  afterEach(() => {
    vi.restoreAllMocks()
  })

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
    // work. Overriding the profile pins one 20x14 grid and moves only the bias, which is the one
    // arrangement that attributes the change to the knob.
    const junctionFraction = (bias: number): number => {
      const dimensions = createLevelDimensions(1, { numCols: 20, numRows: 14 })
      const { maze } = generateMaze(dimensions, 1, {
        __maxCorridorLength: 8,
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
    // benchmark in maze/levels_bench_test.go reports the full distribution behind these means.
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
    vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
      if (array instanceof Uint32Array) {
        array.fill(0)
      }
      return array
    })

    const round = generateMaze(createLevelDimensions(1, { numCols: 5, numRows: 5 }), 1)

    expect(round).toMatchSnapshot()
    expect(round.startPosition).not.toEqual(round.finalPosition)
    expect(round.maze[round.startPosition.y][round.startPosition.x]).toBe(
      "   ",
    )
    expect(round.maze[round.finalPosition.y][round.finalPosition.x]).toBe(
      "   ",
    )
  })
})
