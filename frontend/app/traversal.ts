import { CONFIG, WALL_WEIGHTS } from "./config"
import { isRunningStatus } from "./status"
import type {
  BaseDimensions,
  CellCoordinate,
  MazeAction,
  MazeDimensions,
  MoveAction,
  RenderGridPoint,
  State,
  TraversalHistoryEntry,
  WallWeight,
} from "./types"

const { maze } = CONFIG

export const MOVE_DELTAS: Record<MoveAction, readonly [number, number]> = {
  MoveLeft: [0, -1],
  MoveRight: [0, 1],
  MoveUp: [-1, 0],
  MoveDown: [1, 0],
}

// createMazeDimensions appends the logical cell area to a validated maze shape.
export function createMazeDimensions(dimensions: BaseDimensions): MazeDimensions {
  return {
    length: dimensions.length,
    width: dimensions.width,
    area: dimensions.length * dimensions.width,
  }
}

// cloneMazeDimensions copies maze measurements before they cross storage/runtime boundaries.
export function cloneMazeDimensions(dimensions: MazeDimensions): MazeDimensions {
  return createMazeDimensions(dimensions)
}

// cloneCellCoordinate copies one logical maze-cell coordinate.
export function cloneCellCoordinate(cell: CellCoordinate): CellCoordinate {
  return {
    row: cell.row,
    col: cell.col,
  }
}

// cloneMazeRows copies the mutable rendered maze table one row at a time.
export function cloneMazeRows(mazeRows: string[][]): string[][] {
  return mazeRows.map((row) => [...row])
}

// cloneRenderGridPoint copies one rendered-grid coordinate.
export function cloneRenderGridPoint(point: RenderGridPoint): RenderGridPoint {
  return {
    x: point.x,
    y: point.y,
  }
}

// cloneTraversalHistory preserves first-visit order while detaching callers from shared entries.
export function cloneTraversalHistory(
  history: TraversalHistoryEntry[],
): TraversalHistoryEntry[] {
  if (history.length === 0) {
    throw new Error("traversalHistory must include the known start cell")
  }

  return history.map(({ playerName, row, col }) => ({ playerName, row, col }))
}

// startCellFromTraversalHistory derives the persisted start cell from the first chronological visit.
export function startCellFromTraversalHistory(
  history: TraversalHistoryEntry[],
): CellCoordinate | null {
  const [startCell] = history
  return startCell ? cloneCellCoordinate(startCell) : null
}

export type ResolvedPlayerMove =
  | { canMove: false }
  | {
      canMove: true
      nextCell: CellCoordinate
      nextGridPoint: RenderGridPoint
      visitedBefore: boolean
    }

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

// isMoveAction reports whether one semantic action is a traversable maze move.
export function isMoveAction(
  action: MazeAction,
): action is Extract<MazeAction, { type: MoveAction }> {
  return action.type in MOVE_DELTAS
}

// cellCoordinateFromGridPoint converts one rendered maze-grid point into a logical cell position.
export function cellCoordinateFromGridPoint(position: RenderGridPoint): CellCoordinate {
  return {
    row: Math.floor((position.y - 1) / maze.cellSpan),
    col: Math.floor((position.x - 1) / maze.cellSpan),
  }
}

// gridPointFromCellCoordinate expands a logical cell position back into rendered maze-grid space.
export function gridPointFromCellCoordinate(cell: CellCoordinate): RenderGridPoint {
  return {
    x: cell.col * maze.cellSpan + 1,
    y: cell.row * maze.cellSpan + 1,
  }
}

// mazeCellKey builds a stable string key for deduplicating logical maze cells.
export function mazeCellKey(cell: CellCoordinate): string {
  return `${cell.row}:${cell.col}`
}

// traversalHistoryEntry records one logical-cell visit for the player who made the move.
export function traversalHistoryEntry(
  cell: CellCoordinate,
  playerName: string,
): TraversalHistoryEntry {
  return {
    ...cell,
    playerName,
  }
}

// traversalHistoryIncludes reports whether the ordered visit history already contains a cell.
export function traversalHistoryIncludes(
  traversalHistory: TraversalHistoryEntry[],
  cell: CellCoordinate,
): boolean {
  return traversalHistory.some(
    (visitedCell) => mazeCellKey(visitedCell) === mazeCellKey(cell),
  )
}

// resolvePlayerMove applies the shared movement rules without mutating game state.
export function resolvePlayerMove(
  state: State,
  action: MoveAction,
): ResolvedPlayerMove {
  if (
    !isRunningStatus(state.status) ||
    !state.maze ||
    !state.mazeDimensions ||
    !state.playerPosition
  ) {
    return { canMove: false }
  }

  const [rowDelta, columnDelta] = MOVE_DELTAS[action]
  const { x, y } = state.playerPosition
  const nextY = y + rowDelta * maze.moveStep
  const nextX = x + columnDelta * maze.moveStep
  const probeY = y + rowDelta
  const probeX = x + columnDelta

  if (nextY <= 0 || nextY > state.mazeDimensions.width * maze.cellSpan) {
    return { canMove: false }
  }

  if (nextX <= 0 || nextX > state.mazeDimensions.length * maze.cellSpan) {
    return { canMove: false }
  }

  if (!isSpaceFound(state.maze[probeY][probeX])) {
    return { canMove: false }
  }

  const nextGridPoint = { x: nextX, y: nextY }
  const nextCell = cellCoordinateFromGridPoint(nextGridPoint)

  return {
    canMove: true,
    nextCell,
    nextGridPoint,
    visitedBefore: traversalHistoryIncludes(state.traversalHistory, nextCell),
  }
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
