import { describe, expect, it } from "vitest"

import { mazeAdjacencyHash } from "./adjacency"
import type { LevelDimensions } from "../app/types"

// A real generated 2x1-cell maze (generateMaze, seed 1) - the only possible topology for two cells
// is a single open passage between them, so this is deterministic regardless of generator.
const openMaze = [
  ["|", "---", "-", "---", "|"],
  ["|", "   ", " ", "   ", "|"],
  ["|", "---", "-", "---", "|"],
]

const dimensions: LevelDimensions = { area: 2, level: 1, numCols: 2, numRows: 1 }

describe("mazeAdjacencyHash", () => {
  it("returns a 0x-prefixed 16-hex-digit hash, deterministically for the same grid", () => {
    const first = mazeAdjacencyHash(openMaze, dimensions)
    const second = mazeAdjacencyHash(openMaze, dimensions)

    expect(first).toBe(second)
    expect(first).toMatch(/^0x[0-9a-f]{16}$/)
  })

  // Proves the hash actually discriminates rather than only ever separating wildly-different mazes:
  // two grids that are byte-for-byte identical except for one single passage being open in one and
  // closed in the other must hash differently. Without this, a check that only ever compares gross
  // mismatches could pass even with a bug that's far too lenient.
  it("differs when a single passage changes between two otherwise identical mazes", () => {
    const closedMaze = openMaze.map((row) => [...row])
    // The shared wall between cell (0,0) and cell (0,1) - a single space (open) becomes "|" (closed).
    closedMaze[1][2] = "|"

    expect(mazeAdjacencyHash(closedMaze, dimensions)).not.toBe(
      mazeAdjacencyHash(openMaze, dimensions),
    )
  })
})
