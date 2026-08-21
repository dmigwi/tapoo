import { fnv1a64Checksum } from "../app/logs"
import { openMovesFromCell } from "../app/traversal"
import type { CellCoordinate, LevelDimensions } from "../app/types"

// cellAdjacencyMask reports which of a cell's four directions have an open passage, as a 4-bit mask
// in a fixed Up(1)/Right(2)/Down(4)/Left(8) order — the same order maze/bench/levels_bench_test.go's
// adjacencyMask uses. Built on openMovesFromCell so it shares the exact same open-passage check the
// rest of the codebase already relies on, rather than a second copy of it.
export function cellAdjacencyMask(maze: string[][], cell: CellCoordinate): number {
  let mask = 0
  for (const move of openMovesFromCell(maze, cell)) {
    switch (move) {
      case "MoveUp":
        mask |= 1
        break
      case "MoveRight":
        mask |= 2
        break
      case "MoveDown":
        mask |= 4
        break
      case "MoveLeft":
        mask |= 8
        break
    }
  }

  return mask
}

// mazeAdjacencyHash reduces a maze's decoded adjacency (not its glyph rendering) to one hash: every
// cell's cellAdjacencyMask, row-major, as one hex digit each, hashed with fnv1a64Checksum
// (frontend/app/logs.ts) — the exact same algorithm maze/bench/levels_bench_test.go's
// mazeAdjacencyHash uses via Go's stdlib hash/fnv, verified to produce byte-identical output for the
// same input bytes, so the two ports can compare these hashes directly.
export function mazeAdjacencyHash(maze: string[][], dimensions: LevelDimensions): string {
  let structure = ""
  for (let row = 0; row < dimensions.numRows; row += 1) {
    for (let col = 0; col < dimensions.numCols; col += 1) {
      structure += cellAdjacencyMask(maze, { row, col }).toString(16)
    }
  }

  return fnv1a64Checksum(structure)
}
