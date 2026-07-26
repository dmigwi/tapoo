import { afterEach, describe, expect, it, vi } from "vitest"

import {
  generateMaze,
  getNavigationProfile,
  getMazeDimensions,
} from "./maze"

// This modeled terminal room approximates a 14-inch MacBook-class browser viewport:
// physical panel 3024x1964px, CSS viewport about 1512x982px after device scaling,
// 10 measured PT Mono sample characters about 60 CSS px, and one text row about 11 CSS px.
// After app insets are removed, the browser maze receives 61 columns by 39 rows of room.
const macbookBrowserTerminalSize = { numCols: 61, numRows: 39 }

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
    expect(getNavigationProfile({ numCols: 10, numRows: 11 })).toEqual({
      __softCorridorLimit: 8,
      __hardCorridorLimit: 10,
      __preferTurnPercent: 90,
    })

    expect(getNavigationProfile({ numCols: 20, numRows: 20 })).toEqual({
      __softCorridorLimit: 5,
      __hardCorridorLimit: 7,
      __preferTurnPercent: 75,
    })

    expect(getNavigationProfile({ numCols: 30, numRows: 30 })).toEqual({
      __softCorridorLimit: 4,
      __hardCorridorLimit: 5,
      __preferTurnPercent: 65,
    })

    expect(getNavigationProfile({ numCols: 60, numRows: 60 })).toEqual({
      __softCorridorLimit: 2,
      __hardCorridorLimit: 3,
      __preferTurnPercent: 55,
    })
  })

  it("generates a deterministic maze layout for a fixed random source", () => {
    vi.spyOn(Math, "random").mockReturnValue(0)

    const round = generateMaze({ numCols: 5, numRows: 5 }, 1)

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
