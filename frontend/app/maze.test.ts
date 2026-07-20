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
const macbookBrowserTerminalSize = { length: 61, width: 39 }

// These tests keep maze sizing, navigation tuning, and deterministic carving stable.
describe("maze", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("returns the preferred maze dimensions for a fitting viewport", () => {
    expect(getMazeDimensions(1, { length: 20, width: 20 })).toEqual({
      level: 1,
      length: 7,
      width: 10,
      area: 70,
    })
  })

  it("prefers balanced maze dimensions before viewport aspect ratio", () => {
    expect(getMazeDimensions(2, { length: 30, width: 10 })).toEqual({
      level: 2,
      length: 10,
      width: 8,
      area: 80,
    })
  })

  it("keeps growing maze dimensions for large levels when the viewport can fit them", () => {
    expect(getMazeDimensions(994, { length: 100, width: 100 })).toEqual({
      level: 994,
      width: 100,
      length: 100,
      area: 10000,
    })
  })

  it("returns no dimensions when the viewport cannot fit the maze area", () => {
    expect(getMazeDimensions(1, { length: 6, width: 10 })).toBeNull()
  })

  it("repairs isolated bad area factors without consuming the next level target", () => {
    expect(getMazeDimensions(143, macbookBrowserTerminalSize)).toEqual({
      level: 143,
      length: 44,
      width: 34,
      area: 1496,
    })
    expect(getMazeDimensions(144, macbookBrowserTerminalSize)).toEqual({
      level: 144,
      length: 50,
      width: 30,
      area: 1500,
    })
  })

  it("stops at two consecutive undrawable exact level targets", () => {
    // This modeled room keeps the 14-inch browser UX from filling every last drawable cell.
    expect(getMazeDimensions(150, macbookBrowserTerminalSize)).toEqual({
      level: 150,
      length: 40,
      width: 39,
      area: 1560,
    })
    expect(getMazeDimensions(151, macbookBrowserTerminalSize)).toBeNull()
  })

  it("tightens the navigation profile as maze area grows", () => {
    expect(getNavigationProfile({ length: 10, width: 11 })).toEqual({
      __softCorridorLimit: 8,
      __hardCorridorLimit: 10,
      __preferTurnPercent: 90,
    })

    expect(getNavigationProfile({ length: 20, width: 20 })).toEqual({
      __softCorridorLimit: 5,
      __hardCorridorLimit: 7,
      __preferTurnPercent: 75,
    })

    expect(getNavigationProfile({ length: 30, width: 30 })).toEqual({
      __softCorridorLimit: 4,
      __hardCorridorLimit: 5,
      __preferTurnPercent: 65,
    })

    expect(getNavigationProfile({ length: 60, width: 60 })).toEqual({
      __softCorridorLimit: 2,
      __hardCorridorLimit: 3,
      __preferTurnPercent: 55,
    })
  })

  it("generates a deterministic maze layout for a fixed random source", () => {
    vi.spyOn(Math, "random").mockReturnValue(0)

    const round = generateMaze({ length: 5, width: 5 }, 1)

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
