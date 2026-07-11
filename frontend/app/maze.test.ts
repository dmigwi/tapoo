import { afterEach, describe, expect, it, vi } from "vitest"

import {
  generateMaze,
  getMazeDimensions,
  isSpaceFound,
  isWallWeight,
  nextWallWeight,
  reweightMaze,
} from "./maze"

describe("maze", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

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

  it("returns the preferred maze dimensions for a fitting viewport", () => {
    expect(getMazeDimensions(1, { length: 20, width: 20 })).toEqual({
      level: 1,
      length: 11,
      width: 10,
    })
  })

  it("returns no dimensions when the viewport cannot fit the maze area", () => {
    expect(getMazeDimensions(1, { length: 10, width: 10 })).toBeNull()
  })

  it("generates a deterministic maze layout for a fixed random source", () => {
    vi.spyOn(Math, "random").mockReturnValue(0)

    const round = generateMaze({ length: 5, width: 5 }, 1)

    expect(round).toMatchSnapshot()
    expect(round.startPosition).not.toEqual(round.finalPosition)
    expect(round.maze[round.startPosition[0]][round.startPosition[1]]).toBe(
      "   ",
    )
    expect(round.maze[round.finalPosition[0]][round.finalPosition[1]]).toBe(
      "   ",
    )
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
})
