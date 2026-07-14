import { CONFIG, WALL_WEIGHTS } from "./config"
import type { WallWeight } from "./types"

const { maze } = CONFIG

// getWallCharacters resolves the glyph set for the requested traversal wall weight.
function getWallCharacters(weight: WallWeight): [string, string, string] {
  return maze.walls[weight]
}

// isWallWeight validates numeric wall styles restored from storage or tests.
export function isWallWeight(value: number): value is WallWeight {
  return WALL_WEIGHTS.includes(value as WallWeight)
}

// nextWallWeight advances to the next supported wall style and wraps at the end.
export function nextWallWeight(weight: WallWeight): WallWeight {
  const index = WALL_WEIGHTS.indexOf(weight)
  if (index === -1) {
    return WALL_WEIGHTS[0]
  }

  return WALL_WEIGHTS[(index + 1) % WALL_WEIGHTS.length]
}

// isSpaceFound treats any space-prefixed segment as traversable path.
export function isSpaceFound(item: string): boolean {
  return item.length > 0 && item.charCodeAt(0) === 32
}

// reweightMaze swaps wall glyphs without disturbing already-open path segments.
export function reweightMaze(
  data: string[][],
  currentWeight: WallWeight,
): string[][] {
  const fromChars = getWallCharacters(currentWeight)
  const toChars = getWallCharacters(nextWallWeight(currentWeight))
  const replacements = new Map<string, string>([
    [fromChars[0], toChars[0]],
    [fromChars[1], toChars[1]],
    [fromChars[2], toChars[2]],
  ])

  return data.map((row) => row.map((cell) => replacements.get(cell) ?? cell))
}
