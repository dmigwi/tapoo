import { afterEach, describe, expect, it, vi } from "vitest"

import {
  generateMaze,
  getNavigationProfile,
  getMazeDimensions,
} from "./maze"

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
    })
  })

  it("prefers balanced maze dimensions before viewport aspect ratio", () => {
    expect(getMazeDimensions(2, { length: 30, width: 10 })).toEqual({
      level: 2,
      length: 10,
      width: 8,
    })
  })

  it("keeps growing maze dimensions for large levels when the viewport can fit them", () => {
    expect(getMazeDimensions(994, { length: 100, width: 100 })).toEqual({
      level: 994,
      width: 100,
      length: 100,
    })
  })

  it("returns no dimensions when the viewport cannot fit the maze area", () => {
    expect(getMazeDimensions(1, { length: 6, width: 10 })).toBeNull()
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
