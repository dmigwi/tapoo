import { CONFIG } from "./config"
import { isSpaceFound } from "./traversal"
import type {
  BaseDimensions,
  CellAddress,
  CellNeighbors,
  Direction,
  LevelDimensions,
  NavigationProfile,
  PathStep,
  Position,
  RoundState,
  WallWeight,
} from "./types"

// getRandomNo returns a bounded pseudo-random index for maze generation.
function getRandomNo(limit: number): number {
  if (limit <= 0) {
    return 0
  }

  return Math.floor(Math.random() * limit)
}

// absInt normalizes signed values when comparing candidate dimensions.
function absInt(value: number): number {
  return value < 0 ? -value : value
}

// minInt returns the smaller edge when ranking competing dimensions.
function minInt(left: number, right: number): number {
  return left < right ? left : right
}

// getWallCharacters resolves the glyph set for the requested wall weight.
function getWallCharacters(weight: WallWeight): [string, string, string] {
  return CONFIG.walls[weight]
}

// generateMazeArea turns a level number into the target maze area.
function generateMazeArea(level: number): number {
  return level * CONFIG.diff + CONFIG.seed
}

// appendFittingDimensions records factor pairs that still fit the viewport.
function appendFittingDimensions(
  candidates: BaseDimensions[],
  length: number,
  width: number,
  terminalSize: BaseDimensions,
): BaseDimensions[] {
  if (length < CONFIG.minMazeDimension || width < CONFIG.minMazeDimension) {
    return candidates
  }

  if (terminalSize.length >= length && terminalSize.width >= width) {
    candidates.push({ length, width })
  }

  if (
    length !== width &&
    terminalSize.length >= width &&
    terminalSize.width >= length
  ) {
    candidates.push({ length: width, width: length })
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
    divisor >= CONFIG.minMazeDimension;
    divisor -= 1
  ) {
    if (area % divisor !== 0) {
      continue
    }

    appendFittingDimensions(
      candidates,
      divisor,
      Math.floor(area / divisor),
      terminalSize,
    )
  }

  return candidates
}

// aspectMismatchScore measures how far a candidate is from the viewport aspect ratio.
function aspectMismatchScore(
  candidate: BaseDimensions,
  terminalSize: BaseDimensions,
): number {
  return absInt(
    candidate.length * terminalSize.width -
      candidate.width * terminalSize.length,
  )
}

// isPreferredMazeDimensions ranks one candidate against the current best fit.
function isPreferredMazeDimensions(
  candidate: BaseDimensions,
  currentBest: BaseDimensions,
  terminalSize: BaseDimensions,
): boolean {
  const candidatePenalty = aspectMismatchScore(candidate, terminalSize)
  const bestPenalty = aspectMismatchScore(currentBest, terminalSize)
  if (candidatePenalty !== bestPenalty) {
    return candidatePenalty < bestPenalty
  }

  const candidateSkew = absInt(candidate.length - candidate.width)
  const bestSkew = absInt(currentBest.length - currentBest.width)
  if (candidateSkew !== bestSkew) {
    return candidateSkew < bestSkew
  }

  const candidateMinEdge = minInt(candidate.length, candidate.width)
  const bestMinEdge = minInt(currentBest.length, currentBest.width)
  if (candidateMinEdge !== bestMinEdge) {
    return candidateMinEdge > bestMinEdge
  }

  if (candidate.length !== currentBest.length) {
    return candidate.length > currentBest.length
  }

  return candidate.width > currentBest.width
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

// getMazeDimensions finds the best playable dimensions for a level and viewport.
export function getMazeDimensions(
  level: number,
  terminalSize: BaseDimensions,
): LevelDimensions | null {
  const area = generateMazeArea(level)
  if (area > terminalSize.width * terminalSize.length) {
    return null
  }

  const candidates = fittingDimensionsForArea(area, terminalSize)
  if (candidates.length === 0) {
    return null
  }

  const selected = chooseBestMazeDimensions(candidates, terminalSize)
  return { ...selected, level }
}

// createPlayingField builds the initial fully-walled maze grid.
function createPlayingField(
  dimensions: BaseDimensions,
  weight: WallWeight,
): string[][] {
  const chars = getWallCharacters(weight)
  const rows = CONFIG.cellSpan * dimensions.width + 1
  const path = " ".repeat(CONFIG.cellPathWidth)
  const data: string[][] = []

  for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
    const row: string[] = []

    for (
      let columnIndex = 0;
      columnIndex <= dimensions.length;
      columnIndex += 1
    ) {
      row.push(chars[0])

      if (columnIndex !== dimensions.length && rowIndex % 2 === 0) {
        row.push(chars[1])
      } else if (columnIndex !== dimensions.length) {
        row.push(path)
      }
    }

    data.push(row)
  }

  return data
}

// getCellAddress maps a cell number to its wall and center coordinates.
function getCellAddress(
  dimensions: BaseDimensions,
  cellNo: number,
): CellAddress | null {
  if (cellNo <= 0 || cellNo > dimensions.length * dimensions.width) {
    return null
  }

  const row =
    (Math.floor((cellNo - 1) / dimensions.length) + 1) * CONFIG.cellSpan
  const column = (((cellNo - 1) % dimensions.length) + 1) * CONFIG.cellSpan

  return {
    __bottomCenter: [row, column - 1],
    __bottomLeft: [row, column - CONFIG.cellSpan],
    __bottomRight: [row, column],
    __middleCenter: [row - 1, column - 1],
    __middleLeft: [row - 1, column - CONFIG.cellSpan],
    __middleRight: [row - 1, column],
    __topCenter: [row - CONFIG.cellSpan, column - 1],
    __topLeft: [row - CONFIG.cellSpan, column - CONFIG.cellSpan],
    __topRight: [row - CONFIG.cellSpan, column],
  }
}

// getCellNeighbors returns the adjacent cell numbers around one cell.
function getCellNeighbors(
  dimensions: BaseDimensions,
  cellNo: number,
): CellNeighbors {
  if (cellNo <= 0 || cellNo > dimensions.length * dimensions.width) {
    return { __bottom: 0, __left: 0, __right: 0, __top: 0 }
  }

  const column = (cellNo - 1) % dimensions.length
  const neighbors: CellNeighbors = {
    __bottom: 0,
    __left: 0,
    __right: 0,
    __top: 0,
  }

  if (column < dimensions.length - 1) {
    neighbors.__right = cellNo + 1
  }

  if (column > 0) {
    neighbors.__left = cellNo - 1
  }

  if (cellNo - dimensions.length > 0) {
    neighbors.__top = cellNo - dimensions.length
  }

  if (cellNo + dimensions.length <= dimensions.length * dimensions.width) {
    neighbors.__bottom = cellNo + dimensions.length
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
  dimensions: BaseDimensions,
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

// getNavigationProfile maps maze area into the same smooth difficulty curve used
// by the Go runtime. Smaller mazes keep longer corridors, while larger mazes
// tighten the limits until they reach the hardest supported profile.
export function getNavigationProfile(
  dimensions: BaseDimensions,
): NavigationProfile {
  const area = dimensions.length * dimensions.width
  const difficultyFactor = navigationDifficultyFactor(area)

  return {
    __softCorridorLimit: interpolateNavigationValue(
      CONFIG.navigationFriendlyProfile.__softCorridorLimit,
      CONFIG.navigationHardestProfile.__softCorridorLimit,
      difficultyFactor,
    ),
    __hardCorridorLimit: interpolateNavigationValue(
      CONFIG.navigationFriendlyProfile.__hardCorridorLimit,
      CONFIG.navigationHardestProfile.__hardCorridorLimit,
      difficultyFactor,
    ),
    __preferTurnPercent: interpolateNavigationValue(
      CONFIG.navigationFriendlyProfile.__preferTurnPercent,
      CONFIG.navigationHardestProfile.__preferTurnPercent,
      difficultyFactor,
    ),
  }
}

// navigationDifficultyFactor normalizes maze area into a 0..1 difficulty value.
function navigationDifficultyFactor(area: number): number {
  if (area <= CONFIG.navigationFriendlyMaxArea) {
    return 0
  }

  if (area >= CONFIG.navigationHardestArea) {
    return 1
  }

  const normalizedArea =
    (area - CONFIG.navigationFriendlyMaxArea) /
    (CONFIG.navigationHardestArea - CONFIG.navigationFriendlyMaxArea)

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
  dimensions: BaseDimensions,
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
  dimensions: BaseDimensions,
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

  throw new Error("failed to backtrack to a maze branch")
}

// chooseNextCell applies the navigation profile to the next branch decision.
function chooseNextCell(
  dimensions: BaseDimensions,
  neighbors: number[],
  currentState: PathStep,
  profile: NavigationProfile,
): PathStep {
  const allChoices: PathStep[] = []
  const turnChoices: PathStep[] = []
  const withinHardLimit: PathStep[] = []

  for (const neighbor of neighbors) {
    const choice: PathStep = {
      __cellNo: neighbor,
      __moveDirection: directionBetween(
        dimensions,
        currentState.__cellNo,
        neighbor,
      ),
      __corridorLength: 1,
    }

    if (choice.__moveDirection === currentState.__moveDirection) {
      choice.__corridorLength += currentState.__corridorLength
    }

    allChoices.push(choice)

    if (choice.__moveDirection !== currentState.__moveDirection) {
      turnChoices.push(choice)
    }

    if (choice.__corridorLength <= profile.__hardCorridorLimit) {
      withinHardLimit.push(choice)
    }
  }

  let choices = allChoices

  if (withinHardLimit.length > 0) {
    choices = withinHardLimit
  }

  if (currentState.__moveDirection !== "none" && turnChoices.length > 0) {
    const turnPreferenceRoll = getRandomNo(CONFIG.percentScale)

    if (currentState.__corridorLength >= profile.__hardCorridorLimit) {
      choices = turnChoices
    } else if (
      currentState.__corridorLength >= profile.__softCorridorLimit &&
      turnPreferenceRoll < profile.__preferTurnPercent
    ) {
      choices = turnChoices
    }
  }

  return choices[getRandomNo(choices.length)]
}

// getStartPosition prefers an edge cell so the opening feels less uniform.
function getStartPosition(dimensions: BaseDimensions): number {
  const totalCells = dimensions.length * dimensions.width

  while (true) {
    const randomCellNo = getRandomNo(totalCells) + 1
    if (countNeighbors(getCellNeighbors(dimensions, randomCellNo)) < 4) {
      return randomCellNo
    }
  }
}

// createPath removes the wall segment between two connected cells.
function createPath(
  dimensions: BaseDimensions,
  maze: string[][],
  currentCellNo: number,
  nextCellNo: number,
): void {
  const address = getCellAddress(dimensions, currentCellNo)
  if (!address) {
    return
  }

  const neighbors = getCellNeighbors(dimensions, currentCellNo)

  switch (nextCellNo) {
    case neighbors.__bottom:
      maze[address.__bottomCenter[0]][address.__bottomCenter[1]] = "   "
      break
    case neighbors.__left:
      maze[address.__middleLeft[0]][address.__middleLeft[1]] = " "
      break
    case neighbors.__right:
      maze[address.__middleRight[0]][address.__middleRight[1]] = " "
      break
    case neighbors.__top:
      maze[address.__topCenter[0]][address.__topCenter[1]] = "   "
      break
  }
}

// replaceChar swaps a junction glyph only when the vertical path stays open.
function replaceChar(
  dimensions: BaseDimensions,
  point: Position,
  replacement: string,
  maze: string[][],
): void {
  let topItem = ""
  let bottomItem = ""
  let hasTop = false
  let hasBottom = false

  if (point[0] - 1 > 0) {
    topItem = maze[point[0] - 1][point[1]]
    hasTop = true
  }

  if (point[0] + 1 <= dimensions.width * CONFIG.cellSpan) {
    bottomItem = maze[point[0] + 1][point[1]]
    hasBottom = true
  }

  const row = point[0]
  const column = point[1]

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
  dimensions: BaseDimensions,
  weight: WallWeight,
  maze: string[][],
): void {
  const chars = getWallCharacters(weight)

  for (let cell = 1; cell <= dimensions.length * dimensions.width; cell += 1) {
    const address = getCellAddress(dimensions, cell)
    if (!address) {
      continue
    }

    replaceChar(dimensions, address.__bottomRight, chars[2], maze)
    replaceChar(dimensions, address.__topRight, chars[2], maze)
  }
}

// generateMaze carves the maze, then returns the grid plus start and target positions.
export function generateMaze(
  dimensions: BaseDimensions,
  weight: WallWeight,
): RoundState {
  const totalCells = dimensions.length * dimensions.width
  const navigationProfile = getNavigationProfile(dimensions)
  const visited = new Array<boolean>(totalCells + 1).fill(false)
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

  while (visitedCount < totalCells) {
    const backtrackedState = backtrackToBranch(dimensions, path, visited)
    path = backtrackedState.path
    currentCell = backtrackedState.currentCell

    const nextChoice = chooseNextCell(
      dimensions,
      backtrackedState.neighbors,
      path[path.length - 1],
      navigationProfile,
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
    startPosition: [
      startAddress.__middleCenter[0],
      startAddress.__middleCenter[1],
    ],
    finalPosition: [
      finalAddress.__middleCenter[0],
      finalAddress.__middleCenter[1],
    ],
  }
}
