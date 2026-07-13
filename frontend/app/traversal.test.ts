import { describe, expect, it } from "vitest"

import {
  isSpaceFound,
  isWallWeight,
  nextWallWeight,
  reweightMaze,
} from "./traversal"

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
})
