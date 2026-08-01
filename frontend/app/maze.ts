import { CONFIG } from "./config"
import { createMazeDimensions, isSpaceFound } from "./traversal"
import type {
  BaseDimensions,
  MazeDimensions,
  CellAddress,
  CellNeighbors,
  Direction,
  LevelDimensions,
  NavigationProfile,
  PathStep,
  RenderGridPoint,
  RoundState,
  WallWeight,
} from "./types"

const { generation, maze: mazeConfig, scoring } = CONFIG

// getRandomNo returns a bounded, cryptographically random index for maze generation. Using
// crypto.getRandomValues rather than Math.random keeps maze layouts genuinely unpredictable —
// worthwhile even for a game, since a guessable layout would blunt the challenge, and it means
// no swap is needed later if the project grows into a context where that unpredictability
// becomes a real security property rather than just a gameplay one.
function getRandomNo(limit: number): number {
  if (limit <= 0) {
    return 0
  }

  // Rejection sampling avoids modulo bias: values landing in the partial final range above the
  // largest multiple of `limit` are discarded and re-rolled rather than folded in unevenly.
  const range = 2 ** 32
  const rejectionThreshold = range - (range % limit)
  const buffer = new Uint32Array(1)

  let value: number
  do {
    crypto.getRandomValues(buffer)
    value = buffer[0]
  } while (value >= rejectionThreshold)

  return value % limit
}

// absInt normalizes signed values when comparing candidate dimensions.
function absInt(value: number): number {
  return value < 0 ? -value : value
}

// getWallCharacters resolves the glyph set for the requested wall weight.
function getWallCharacters(weight: WallWeight): [string, string, string] {
  return mazeConfig.walls[weight]
}

// generateMazeArea turns a level number into the target maze area. Exported so the benchmark can
// find which level a case belongs to using this function rather than restating seed and diff.
export function generateMazeArea(level: number): number {
  return level * generation.diff + generation.seed
}

// appendFittingDimensions records factor pairs that still fit the viewport.
function appendFittingDimensions(
  candidates: BaseDimensions[],
  numCols: number,
  numRows: number,
  terminalSize: BaseDimensions,
): BaseDimensions[] {
  // Reject very skinny factor pairs even when they fit, because they make poor playable mazes.
  if (numCols < mazeConfig.minMazeSideCells || numRows < mazeConfig.minMazeSideCells) {
    return candidates
  }

  if (terminalSize.numCols >= numCols && terminalSize.numRows >= numRows) {
    candidates.push({ numCols, numRows })
  }

  const rotatedDimensions = { numCols: numRows, numRows: numCols }
  // Also try the same factor pair rotated, because a wide viewport may fit numRows x numCols better.
  if (
    numCols !== numRows &&
    terminalSize.numCols >= rotatedDimensions.numCols &&
    terminalSize.numRows >= rotatedDimensions.numRows
  ) {
    candidates.push(rotatedDimensions)
  }

  return candidates
}

// fittingDimensionsForArea enumerates all viewport-safe factor pairs for an area.
function fittingDimensionsForArea(
  area: number,
  terminalSize: BaseDimensions,
): BaseDimensions[] {
  const candidates: BaseDimensions[] = []

  for (
    let divisor = Math.floor(Math.sqrt(area));
    divisor >= mazeConfig.minMazeSideCells;
    divisor -= 1
  ) {
    if (area % divisor !== 0) {
      continue
    }

    appendFittingDimensions(candidates, divisor, Math.floor(area / divisor), terminalSize)
  }

  return candidates
}

// aspectMismatchScore measures how far a candidate is from the viewport aspect ratio.
function aspectMismatchScore(
  candidate: BaseDimensions,
  terminalSize: BaseDimensions,
): number {
  return absInt(
    candidate.numCols * terminalSize.numRows - candidate.numRows * terminalSize.numCols,
  )
}

// isPreferredMazeDimensions ranks one candidate against the current best fit.
function isPreferredMazeDimensions(
  candidate: BaseDimensions,
  currentBest: BaseDimensions,
  terminalSize: BaseDimensions,
): boolean {
  // Prefer the less skewed (close to square) shape so the maze stays balanced and playable.
  const candidateSkew = absInt(candidate.numCols - candidate.numRows)
  const bestSkew = absInt(currentBest.numCols - currentBest.numRows)
  if (candidateSkew !== bestSkew) {
    return candidateSkew < bestSkew
  }

  // When skew ties, choose the shape that better matches the viewport.
  const candidatePenalty = aspectMismatchScore(candidate, terminalSize)
  const bestPenalty = aspectMismatchScore(currentBest, terminalSize)
  if (candidatePenalty !== bestPenalty) {
    return candidatePenalty < bestPenalty
  }

  // Remaining ties are equivalent enough that the first deterministic candidate should stay selected.
  return false
}

// chooseBestMazeDimensions picks the most balanced candidate for the viewport.
function chooseBestMazeDimensions(
  candidates: BaseDimensions[],
  terminalSize: BaseDimensions,
): BaseDimensions {
  let best = candidates[0]

  for (const candidate of candidates.slice(1)) {
    if (isPreferredMazeDimensions(candidate, best, terminalSize)) {
      best = candidate
    }
  }

  return best
}

// resolveMazeArea keeps isolated bad factor pairs playable without borrowing the next level.
function resolveMazeArea(
  level: number,
  terminalSize: BaseDimensions,
): BaseDimensions[] | null {
  // Each visible level owns the area band from its raw target up to the next level's target.
  const area = generateMazeArea(level)
  const areaLimit = generateMazeArea(level + 1)
  const terminalArea = terminalSize.numRows * terminalSize.numCols
  if (area > terminalArea) {
    return null
  }

  const exactCandidates = fittingDimensionsForArea(area, terminalSize)
  if (exactCandidates.length > 0) {
    return exactCandidates
  }

  // We only get here after the current exact target missed.
  // If the next exact target also misses, stop early to preserve UI room for controls and seats.
  const nextExactCandidates = fittingDimensionsForArea(areaLimit, terminalSize)
  if (nextExactCandidates.length === 0) {
    return null
  }

  // Repair isolated bad factors inside this level's band without consuming the next level's area.
  for (
    let candidateArea = area + 1;
    candidateArea < areaLimit && candidateArea <= terminalArea;
    candidateArea += 1
  ) {
    const candidates = fittingDimensionsForArea(candidateArea, terminalSize)
    if (candidates.length > 0) {
      return candidates
    }
  }

  return null
}

// getMazeDimensions finds the best playable dimensions for a level and viewport.
export function getMazeDimensions(
  level: number,
  terminalSize: BaseDimensions,
): LevelDimensions | null {
  const candidates = resolveMazeArea(level, terminalSize)
  if (candidates === null) {
    return null
  }

  const selected = chooseBestMazeDimensions(candidates, terminalSize)
  return { ...createMazeDimensions(selected), level }
}

// createPlayingField builds the initial fully-walled maze grid.
function createPlayingField(
  dimensions: BaseDimensions,
  weight: WallWeight,
): string[][] {
  const chars = getWallCharacters(weight)
  const rows = mazeConfig.renderCellStep * dimensions.numRows + 1
  const horizontalOpening = " ".repeat(mazeConfig.wallOpening.horizontal)
  const data: string[][] = []

  for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
    const row: string[] = []

    for (
      let columnIndex = 0;
      columnIndex <= dimensions.numCols;
      columnIndex += 1
    ) {
      row.push(chars[0])

      if (columnIndex !== dimensions.numCols && rowIndex % 2 === 0) {
        row.push(chars[1])
      } else if (columnIndex !== dimensions.numCols) {
        row.push(horizontalOpening)
      }
    }

    data.push(row)
  }

  return data
}

// getCellAddress maps a cell number to its wall and center coordinates.
function getCellAddress(
  dimensions: MazeDimensions,
  cellNo: number,
): CellAddress | null {
  if (cellNo <= 0 || cellNo > dimensions.area) {
    return null
  }

  const row = (Math.floor((cellNo - 1) / dimensions.numCols) + 1) * mazeConfig.renderCellStep
  const column = (((cellNo - 1) % dimensions.numCols) + 1) * mazeConfig.renderCellStep

  return {
    __topLeft: { x: column - mazeConfig.renderCellStep, y: row - mazeConfig.renderCellStep },
    __topCenter: { x: column - 1, y: row - mazeConfig.renderCellStep },
    __topRight: { x: column, y: row - mazeConfig.renderCellStep },
    __middleLeft: { x: column - mazeConfig.renderCellStep, y: row - 1 },
    __middleCenter: { x: column - 1, y: row - 1 },
    __middleRight: { x: column, y: row - 1 },
    __bottomLeft: { x: column - mazeConfig.renderCellStep, y: row },
    __bottomCenter: { x: column - 1, y: row },
    __bottomRight: { x: column, y: row },
  }
}

// getCellNeighbors returns the adjacent cell numbers around one cell.
function getCellNeighbors(
  dimensions: MazeDimensions,
  cellNo: number,
): CellNeighbors {
  if (cellNo <= 0 || cellNo > dimensions.area) {
    return { __bottom: 0, __left: 0, __right: 0, __top: 0 }
  }

  const column = (cellNo - 1) % dimensions.numCols
  const neighbors: CellNeighbors = {
    __bottom: 0,
    __left: 0,
    __right: 0,
    __top: 0,
  }

  if (column < dimensions.numCols - 1) {
    neighbors.__right = cellNo + 1
  }

  if (column > 0) {
    neighbors.__left = cellNo - 1
  }

  if (cellNo - dimensions.numCols > 0) {
    neighbors.__top = cellNo - dimensions.numCols
  }

  if (cellNo + dimensions.numCols <= dimensions.area) {
    neighbors.__bottom = cellNo + dimensions.numCols
  }

  return neighbors
}

// countNeighbors counts how many edges a cell exposes to the grid.
function countNeighbors(neighbors: CellNeighbors): number {
  let count = 0

  if (neighbors.__bottom !== 0) {
    count += 1
  }

  if (neighbors.__left !== 0) {
    count += 1
  }

  if (neighbors.__right !== 0) {
    count += 1
  }

  if (neighbors.__top !== 0) {
    count += 1
  }

  return count
}

// getPresentNeighbors filters neighboring cells down to the unvisited options.
function getPresentNeighbors(
  dimensions: MazeDimensions,
  cellNo: number,
  visited: boolean[],
): number[] {
  const neighbors = getCellNeighbors(dimensions, cellNo)
  const present: number[] = []

  if (neighbors.__bottom !== 0 && !visited[neighbors.__bottom]) {
    present.push(neighbors.__bottom)
  }

  if (neighbors.__left !== 0 && !visited[neighbors.__left]) {
    present.push(neighbors.__left)
  }

  if (neighbors.__right !== 0 && !visited[neighbors.__right]) {
    present.push(neighbors.__right)
  }

  if (neighbors.__top !== 0 && !visited[neighbors.__top]) {
    present.push(neighbors.__top)
  }

  return present
}

// countPresentNeighbors reports how many of a cell's neighbors are still unvisited. The
// least-neighbors bias calls this once per candidate on every generation step and only needs the
// count, so it avoids the intermediate array getPresentNeighbors would allocate.
function countPresentNeighbors(
  dimensions: MazeDimensions,
  cellNo: number,
  visited: boolean[],
): number {
  const neighbors = getCellNeighbors(dimensions, cellNo)
  let count = 0

  if (neighbors.__bottom !== 0 && !visited[neighbors.__bottom]) {
    count += 1
  }

  if (neighbors.__left !== 0 && !visited[neighbors.__left]) {
    count += 1
  }

  if (neighbors.__right !== 0 && !visited[neighbors.__right]) {
    count += 1
  }

  if (neighbors.__top !== 0 && !visited[neighbors.__top]) {
    count += 1
  }

  return count
}

// getNavigationProfile maps maze area into the same smooth difficulty curve used
// by the Go runtime. Smaller mazes keep longer corridors, while larger mazes
// tighten the limits until they reach the hardest supported profile.
export function getNavigationProfile(
  dimensions: MazeDimensions,
): NavigationProfile {
  const difficultyFactor = navigationDifficultyFactor(dimensions.area)

  return {
    __maxCorridorLength: interpolateNavigationValue(
      generation.navigation.friendlyProfile.__maxCorridorLength,
      generation.navigation.hardestProfile.__maxCorridorLength,
      difficultyFactor,
    ),
    __leastNeighborsBias: interpolateNavigationValue(
      generation.navigation.friendlyProfile.__leastNeighborsBias,
      generation.navigation.hardestProfile.__leastNeighborsBias,
      difficultyFactor,
    ),
  }
}

// navigationDifficultyFactor normalizes maze area into a 0..1 difficulty value.
function navigationDifficultyFactor(area: number): number {
  if (area <= generation.navigation.friendlyMaxArea) {
    return 0
  }

  if (area >= generation.navigation.hardestArea) {
    return 1
  }

  const normalizedArea = (area - generation.navigation.friendlyMaxArea) /
    (generation.navigation.hardestArea - generation.navigation.friendlyMaxArea)

  return Math.sqrt(normalizedArea)
}

// interpolateNavigationValue blends between the friendly and hardest profile values.
function interpolateNavigationValue(
  friendly: number,
  hardest: number,
  difficultyFactor: number,
): number {
  return Math.round(friendly + (hardest - friendly) * difficultyFactor)
}

// directionBetween converts two adjacent cells into a movement direction.
function directionBetween(
  dimensions: MazeDimensions,
  currentCell: number,
  nextCell: number,
): Direction {
  const neighbors = getCellNeighbors(dimensions, currentCell)

  switch (nextCell) {
    case neighbors.__top:
      return "MoveUp"
    case neighbors.__bottom:
      return "MoveDown"
    case neighbors.__left:
      return "MoveLeft"
    case neighbors.__right:
      return "MoveRight"
    default:
      return "none"
  }
}

// backtrackToBranch rewinds the carved path until an unvisited branch is found.
function backtrackToBranch(
  dimensions: MazeDimensions,
  path: PathStep[],
  visited: boolean[],
): { path: PathStep[]; currentCell: number; neighbors: number[] } {
  while (path.length > 0) {
    const currentCell = path[path.length - 1].__cellNo
    const neighbors = getPresentNeighbors(dimensions, currentCell, visited)

    if (neighbors.length > 0) {
      return { path, currentCell, neighbors }
    }

    path.pop()
  }

  throw new Error("maze generation failed: no branch with unvisited neighbors found")
}

// chooseNextCell applies the navigation profile to the next branch decision.
function chooseNextCell(
  dimensions: MazeDimensions,
  neighbors: number[],
  currentState: PathStep,
  profile: NavigationProfile,
  visited: boolean[],
): PathStep {
  const allChoices: PathStep[] = []
  const withinLengthLimit: PathStep[] = []

  for (const neighbor of neighbors) {
    const choice: PathStep = {
      __cellNo: neighbor,
      __moveDirection: directionBetween(dimensions, currentState.__cellNo, neighbor),
      __corridorLength: 1,
    }

    if (choice.__moveDirection === currentState.__moveDirection) {
      choice.__corridorLength += currentState.__corridorLength
    }

    allChoices.push(choice)

    // Caps how long a straight run can go before being forced to bend.
    if (choice.__corridorLength <= profile.__maxCorridorLength) {
      withinLengthLimit.push(choice)
    }
  }

  const choices = withinLengthLimit.length > 0 ? withinLengthLimit : allChoices
  if (choices.length > 1 && getRandomNo(scoring.percentScale) < profile.__leastNeighborsBias) {
    // Prefer the candidate with the fewest remaining unvisited neighbors of its own. A
    // low-neighbor-count cell gets "used up" cleanly by visiting it now, leaving nothing behind
    // for some later, unrelated branch to claim and retroactively turn this cell into a
    // junction. This is the mechanism that actually controls branching — unlike corridor length
    // or turn direction, neighbor count directly predicts whether a cell will be orphaned.
    let leastPopulated: PathStep[] = []
    let fewestRemaining = Infinity

    for (const choice of choices) {
      const remaining = countPresentNeighbors(dimensions, choice.__cellNo, visited)
      if (remaining < fewestRemaining) {
        fewestRemaining = remaining
        leastPopulated = [choice]
      } else if (remaining === fewestRemaining) {
        leastPopulated.push(choice)
      }
    }
    return leastPopulated[getRandomNo(leastPopulated.length)]
  }

  return choices[getRandomNo(choices.length)]
}

// getStartPosition prefers an edge cell so the opening feels less uniform.
function getStartPosition(dimensions: MazeDimensions): number {
  while (true) {
    const randomCellNo = getRandomNo(dimensions.area) + 1
    if (countNeighbors(getCellNeighbors(dimensions, randomCellNo)) < 4) {
      return randomCellNo
    }
  }
}

// createPath removes the wall segment between two connected cells.
function createPath(
  dimensions: MazeDimensions,
  maze: string[][],
  currentCellNo: number,
  nextCellNo: number,
): void {
  const address = getCellAddress(dimensions, currentCellNo)
  if (!address) {
    return
  }

  const horizontalOpening = " ".repeat(mazeConfig.wallOpening.horizontal)
  const verticalOpening = " ".repeat(mazeConfig.wallOpening.vertical)
  const neighbors = getCellNeighbors(dimensions, currentCellNo)

  switch (nextCellNo) {
    case neighbors.__bottom:
      maze[address.__bottomCenter.y][address.__bottomCenter.x] = horizontalOpening
      break
    case neighbors.__left:
      maze[address.__middleLeft.y][address.__middleLeft.x] = verticalOpening
      break
    case neighbors.__right:
      maze[address.__middleRight.y][address.__middleRight.x] = verticalOpening
      break
    case neighbors.__top:
      maze[address.__topCenter.y][address.__topCenter.x] = horizontalOpening
      break
  }
}

// replaceChar swaps a junction glyph only when the vertical path stays open.
function replaceChar(
  dimensions: MazeDimensions,
  point: RenderGridPoint,
  replacement: string,
  maze: string[][],
): void {
  let topItem = ""
  let bottomItem = ""
  let hasTop = false
  let hasBottom = false

  if (point.y - 1 > 0) {
    topItem = maze[point.y - 1][point.x]
    hasTop = true
  }

  if (point.y + 1 <= dimensions.numRows * mazeConfig.renderCellStep) {
    bottomItem = maze[point.y + 1][point.x]
    hasBottom = true
  }

  const row = point.y
  const column = point.x

  if (!hasTop && hasBottom && isSpaceFound(bottomItem)) {
    maze[row][column] = replacement
  } else if (hasTop && !hasBottom && isSpaceFound(topItem)) {
    maze[row][column] = replacement
  } else if (
    hasTop &&
    hasBottom &&
    isSpaceFound(topItem) &&
    isSpaceFound(bottomItem)
  ) {
    maze[row][column] = replacement
  }
}

// optimizeMaze softens eligible vertical joints after the maze is carved.
function optimizeMaze(
  dimensions: MazeDimensions,
  weight: WallWeight,
  maze: string[][],
): void {
  const chars = getWallCharacters(weight)

  for (let cell = 1; cell <= dimensions.area; cell += 1) {
    const address = getCellAddress(dimensions, cell)
    if (!address) {
      continue
    }

    replaceChar(dimensions, address.__bottomRight, chars[2], maze)
    replaceChar(dimensions, address.__topRight, chars[2], maze)
  }
}

// generateMaze carves the maze, then returns the grid plus start and target positions.
//
// The target is deliberately chosen as the single farthest cell from the start, by tree
// distance, across the entire maze — not an arbitrary or independently-random pick. Because a
// perfect maze is a spanning tree, and `path` here always mirrors the exact tree-path from
// `startCell` to whichever cell the DFS currently stands on, tracking `path.length`'s running
// maximum re-derives every cell's true distance from the start as it's first visited. The
// classic graph-theory guarantee for trees is that the farthest node from any fixed point is
// always an endpoint of the tree's longest possible path (its diameter) — so `startCell` and
// `finalCell` are always as far apart as the maze's shape allows, regardless of where the
// randomly-chosen `startCell` happens to land.
// profileOverride carves under a caller-supplied profile instead of the one getNavigationProfile
// derives from area. Gameplay always omits it; it exists for measurement, since the profile is a
// pure function of area and nothing else can hold the grid fixed while moving a knob — which is what
// separates a knob's effect from the grid's own.
export function generateMaze(
  dimensions: LevelDimensions,
  weight: WallWeight,
  profileOverride?: NavigationProfile,
): RoundState {
  const navigationProfile = profileOverride ?? getNavigationProfile(dimensions)
  const visited = new Array<boolean>(dimensions.area + 1).fill(false)
  const maze = createPlayingField(dimensions, weight)
  const startCell = getStartPosition(dimensions)

  let path: PathStep[] = [
    { __cellNo: startCell, __moveDirection: "none", __corridorLength: 0 },
  ]
  let currentCell = startCell
  let visitedCount = 1
  let longestPathLength = 1
  let finalCell = startCell

  const startAddress = getCellAddress(dimensions, startCell)
  if (!startAddress) {
    throw new Error("failed to resolve start address")
  }

  visited[currentCell] = true

  while (visitedCount < dimensions.area) {
    const backtrackedState = backtrackToBranch(dimensions, path, visited)
    path = backtrackedState.path
    currentCell = backtrackedState.currentCell

    const nextChoice = chooseNextCell(
      dimensions, backtrackedState.neighbors, path[path.length - 1], navigationProfile, visited,
    )

    if (visited[nextChoice.__cellNo]) {
      continue
    }

    visited[nextChoice.__cellNo] = true
    visitedCount += 1
    createPath(dimensions, maze, currentCell, nextChoice.__cellNo)
    path.push(nextChoice)

    if (path.length > longestPathLength) {
      longestPathLength = path.length
      finalCell = nextChoice.__cellNo
    }
  }

  const finalAddress = getCellAddress(dimensions, finalCell)
  if (!finalAddress) {
    throw new Error("failed to resolve target address")
  }

  optimizeMaze(dimensions, weight, maze)

  return {
    maze,
    startPosition: {
      x: startAddress.__middleCenter.x,
      y: startAddress.__middleCenter.y,
    },
    finalPosition: {
      x: finalAddress.__middleCenter.x,
      y: finalAddress.__middleCenter.y,
    },
  }
}
