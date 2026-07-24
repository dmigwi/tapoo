import { CONFIG, WALL_WEIGHTS } from "./config"
import { isRunningStatus } from "./status"
import type {
  BaseDimensions,
  CellCoordinate,
  MazeAction,
  MazeDimensions,
  MoveAction,
  PersistedRound,
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

export const MOVE_ACTIONS = Object.keys(MOVE_DELTAS) as MoveAction[]

// --- Coordinate geometry ---
// Converting between the two position spaces: logical cells and rendered maze-grid points.

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

// isCellCoordinate validates one zero-based logical cell coordinate.
export function isCellCoordinate(value: unknown): value is CellCoordinate {
  if (
    typeof value !== "object" ||
    value === null ||
    !("row" in value) ||
    !("col" in value)
  ) {
    return false
  }

  const row = value.row
  const col = value.col

  return (
    typeof row === "number" &&
    typeof col === "number" &&
    Number.isInteger(row) &&
    Number.isInteger(col) &&
    row >= 0 &&
    col >= 0
  )
}

// cloneCellCoordinate copies one logical maze-cell coordinate.
export function cloneCellCoordinate(cell: CellCoordinate): CellCoordinate {
  return {
    row: cell.row,
    col: cell.col,
  }
}

// cloneRenderGridPoint copies one rendered-grid coordinate.
export function cloneRenderGridPoint(point: RenderGridPoint): RenderGridPoint {
  return {
    x: point.x,
    y: point.y,
  }
}

// --- Maze dimensions ---

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

// --- Wall style ---
// Aesthetic wall cycling and maze grid operations.

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

// cloneMazeRows copies the mutable rendered maze table one row at a time.
export function cloneMazeRows(mazeRows: string[][]): string[][] {
  return mazeRows.map((row) => [...row])
}

// --- Maze traversability ---
// Determining which cells and directions are passable.

// isSpaceFound treats any space-prefixed segment as traversable path.
export function isSpaceFound(item: string): boolean {
  return item.length > 0 && item.charCodeAt(0) === 32
}

// isTraversableGridPoint verifies that a rendered-grid point still lands on open path.
export function isTraversableGridPoint(
  data: string[][],
  position: RenderGridPoint,
): boolean {
  const { x, y } = position
  if (y < 0 || y >= data.length) {
    return false
  }

  if (x < 0 || x >= data[y].length) {
    return false
  }

  return isSpaceFound(data[y][x])
}

// isWallProbeOpen reports whether the rendered wall cell one step in direction (dr, dc) from
// grid point (y, x) is traversable. Performs array bounds checking so callers need not.
function isWallProbeOpen(mazeData: string[][], y: number, x: number, dr: number, dc: number): boolean {
  const probeY = y + dr
  const probeX = x + dc
  return (
    probeY >= 0 &&
    probeY < mazeData.length &&
    probeX >= 0 &&
    probeX < mazeData[probeY].length &&
    isSpaceFound(mazeData[probeY][probeX])
  )
}

// openMovesFromCell returns the passable exits from a logical cell by probing the rendered maze wall.
// Returns an empty array when maze data is unavailable (e.g. in unit tests without a generated maze).
export function openMovesFromCell(
  mazeData: string[][] | null,
  cell: CellCoordinate,
): MoveAction[] {
  if (!mazeData) {
    return []
  }
  const { x, y } = gridPointFromCellCoordinate(cell)
  return MOVE_ACTIONS.filter((move) => {
    const [dr, dc] = MOVE_DELTAS[move]
    return isWallProbeOpen(mazeData, y, x, dr, dc)
  })
}

// --- Move vocabulary and player movement ---

// isMoveAction reports whether one semantic action is a traversable maze move.
export function isMoveAction(
  action: MazeAction,
): action is Extract<MazeAction, { type: MoveAction }> {
  return action.type in MOVE_DELTAS
}

export type ResolvedPlayerMove =
  | { canMove: false }
  | {
      canMove: true
      nextCell: CellCoordinate
      nextGridPoint: RenderGridPoint
      visitedBefore: boolean
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

  if (nextY <= 0 || nextY > state.mazeDimensions.width * maze.cellSpan) {
    return { canMove: false }
  }

  if (nextX <= 0 || nextX > state.mazeDimensions.length * maze.cellSpan) {
    return { canMove: false }
  }

  if (!isWallProbeOpen(state.maze, y, x, rowDelta, columnDelta)) {
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

// --- Traversal history ---
// Recording, querying, and cloning the ordered sequence of player cell visits.

// isTraversalHistoryEntry validates one named visit record restored from storage.
export function isTraversalHistoryEntry(value: unknown): value is TraversalHistoryEntry {
  if (
    !isCellCoordinate(value) ||
    !("playerName" in value) ||
    typeof value.playerName !== "string" ||
    value.playerName.length === 0 ||
    !("openMoves" in value) ||
    !Array.isArray(value.openMoves)
  ) {
    return false
  }
  return (value.openMoves as unknown[]).every((m) => typeof m === "string" && m in MOVE_DELTAS)
}

// traversalHistoryEntry records one logical-cell visit for the player who made the move.
export function traversalHistoryEntry(
  cell: CellCoordinate,
  playerName: string,
  mazeData: string[][] | null,
): TraversalHistoryEntry {
  return {
    ...cell,
    playerName,
    openMoves: openMovesFromCell(mazeData, cell),
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

// cloneTraversalHistory preserves first-visit order while detaching callers from shared entries.
export function cloneTraversalHistory(
  history: TraversalHistoryEntry[],
): TraversalHistoryEntry[] {
  if (history.length === 0) {
    throw new Error("traversalHistory must include the known start cell")
  }

  return history.map(({ playerName, row, col, openMoves }) => ({ 
    playerName, row, col, openMoves: [...openMoves] 
  }))
}

// startCellFromTraversalHistory derives the persisted start cell from the first chronological visit.
export function startCellFromTraversalHistory(
  history: TraversalHistoryEntry[],
): CellCoordinate | null {
  const [startCell] = history
  return startCell ? cloneCellCoordinate(startCell) : null
}

// --- Persistence validation ---

// isValidPersistedRound verifies that a restored round is internally consistent.
export function isValidPersistedRound(snapshot: PersistedRound): boolean {
  // Reject impossible round metadata before trusting nested maze data.
  if (
    snapshot.level < 1 ||
    !isWallWeight(snapshot.wallWeight) ||
    snapshot.mazeDimensions.length <= 0 ||
    snapshot.mazeDimensions.width <= 0 ||
    snapshot.mazeDimensions.area !== snapshot.mazeDimensions.length * snapshot.mazeDimensions.width
  ) {
    return false
  }

  // The stored maze grid must match the dimensions used to generate it.
  const expectedRows = maze.cellSpan * snapshot.mazeDimensions.width + 1
  const expectedColumns = snapshot.mazeDimensions.length * 2 + 1
  if (snapshot.maze.length !== expectedRows) {
    return false
  }

  if (
    !snapshot.maze.every(
      (row) => Array.isArray(row) && row.length === expectedColumns,
    )
  ) {
    return false
  }

  // Player and destination positions must both point at open maze cells.
  if (!isTraversableGridPoint(snapshot.maze, snapshot.playerPosition)) {
    return false
  }

  if (!isTraversableGridPoint(snapshot.maze, snapshot.finalPosition)) {
    return false
  }

  // Traversal history must start with the saved round start cell.
  if (
    !isCellCoordinate(snapshot.startCell) ||
    !Array.isArray(snapshot.traversalHistory) ||
    snapshot.traversalHistory.length === 0
  ) {
    return false
  }

  // The saved start cell must still be traversable in the stored maze.
  if (
    !isTraversableGridPoint(
      snapshot.maze,
      gridPointFromCellCoordinate(snapshot.startCell),
    )
  ) {
    return false
  }

  const firstVisitedCell = snapshot.traversalHistory[0]
  if (
    !isTraversalHistoryEntry(firstVisitedCell) ||
    mazeCellKey(firstVisitedCell) !== mazeCellKey(snapshot.startCell)
  ) {
    return false
  }

  const visitedCellKeys = new Set<string>()
  for (const visitedCell of snapshot.traversalHistory) {
    // History is append-only and unique, so duplicates indicate corrupted state.
    if (!isTraversalHistoryEntry(visitedCell)) {
      return false
    }

    const visitedCellKey = mazeCellKey(visitedCell)
    if (visitedCellKeys.has(visitedCellKey)) {
      return false
    }

    visitedCellKeys.add(visitedCellKey)
    if (!isTraversableGridPoint(snapshot.maze, gridPointFromCellCoordinate(visitedCell))) {
      return false
    }
  }

  return true
}
