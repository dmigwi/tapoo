import { CONFIG, WALL_WEIGHTS } from "./config"
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

function getRandomNo(limit: number): number {
  if (limit <= 0) {
    return 0
  }

  return Math.floor(Math.random() * limit)
}

function absInt(value: number): number {
  return value < 0 ? -value : value
}

function minInt(left: number, right: number): number {
  return left < right ? left : right
}

function getWallCharacters(weight: WallWeight): [string, string, string] {
  return CONFIG.walls[weight]
}

export function isWallWeight(value: number): value is WallWeight {
  return WALL_WEIGHTS.includes(value as WallWeight)
}

export function nextWallWeight(weight: WallWeight): WallWeight {
  const index = WALL_WEIGHTS.indexOf(weight)
  if (index === -1) {
    return WALL_WEIGHTS[0]
  }

  return WALL_WEIGHTS[(index + 1) % WALL_WEIGHTS.length]
}

export function isSpaceFound(item: string): boolean {
  return item.length > 0 && item.charCodeAt(0) === 32
}

function generateMazeArea(level: number): number {
  return level * CONFIG.diff + CONFIG.seed
}

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

function aspectMismatchScore(
  candidate: BaseDimensions,
  terminalSize: BaseDimensions,
): number {
  return absInt(
    candidate.length * terminalSize.width -
      candidate.width * terminalSize.length,
  )
}

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

function getNavigationProfile(dimensions: BaseDimensions): NavigationProfile {
  const bands: Array<{ maxArea: number; profile: NavigationProfile }> = [
    {
      maxArea: 180,
      profile: {
        __softCorridorLimit: 2,
        __hardCorridorLimit: 3,
        __preferTurnPercent: 80,
      },
    },
    {
      maxArea: 300,
      profile: {
        __softCorridorLimit: 3,
        __hardCorridorLimit: 4,
        __preferTurnPercent: 70,
      },
    },
    {
      maxArea: 450,
      profile: {
        __softCorridorLimit: 4,
        __hardCorridorLimit: 5,
        __preferTurnPercent: 60,
      },
    },
    {
      maxArea: 600,
      profile: {
        __softCorridorLimit: 5,
        __hardCorridorLimit: 6,
        __preferTurnPercent: 50,
      },
    },
    {
      maxArea: 1000,
      profile: {
        __softCorridorLimit: 5,
        __hardCorridorLimit: 7,
        __preferTurnPercent: 45,
      },
    },
    {
      maxArea: 1600,
      profile: {
        __softCorridorLimit: 6,
        __hardCorridorLimit: 7,
        __preferTurnPercent: 40,
      },
    },
  ]

  const area = dimensions.length * dimensions.width
  return (
    bands.find((band) => area <= band.maxArea)?.profile ??
    {
      __softCorridorLimit: 6,
      __hardCorridorLimit: 8,
      __preferTurnPercent: 35,
    }
  )
}

function directionBetween(
  dimensions: BaseDimensions,
  currentCell: number,
  nextCell: number,
): Direction {
  const neighbors = getCellNeighbors(dimensions, currentCell)

  if (nextCell === neighbors.__top) {
    return "up"
  }

  if (nextCell === neighbors.__bottom) {
    return "down"
  }

  if (nextCell === neighbors.__left) {
    return "left"
  }

  if (nextCell === neighbors.__right) {
    return "right"
  }

  return "none"
}

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
    const nextDirection = directionBetween(
      dimensions,
      currentState.__cellNo,
      neighbor,
    )
    const straightLength =
      nextDirection === currentState.__moveDirection
        ? currentState.__corridorLength + 1
        : 1

    const choice: PathStep = {
      __cellNo: neighbor,
      __moveDirection: nextDirection,
      __corridorLength: straightLength,
    }

    allChoices.push(choice)

    if (nextDirection !== currentState.__moveDirection) {
      turnChoices.push(choice)
    }

    if (straightLength <= profile.__hardCorridorLimit) {
      withinHardLimit.push(choice)
    }
  }

  let choices = withinHardLimit.length > 0 ? withinHardLimit : allChoices

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

function getStartPosition(dimensions: BaseDimensions): number {
  const totalCells = dimensions.length * dimensions.width

  while (true) {
    const randomCellNo = getRandomNo(totalCells) + 1
    if (countNeighbors(getCellNeighbors(dimensions, randomCellNo)) < 4) {
      return randomCellNo
    }
  }
}

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

  if (nextCellNo === neighbors.__bottom) {
    maze[address.__bottomCenter[0]][address.__bottomCenter[1]] = "   "
  } else if (nextCellNo === neighbors.__left) {
    maze[address.__middleLeft[0]][address.__middleLeft[1]] = " "
  } else if (nextCellNo === neighbors.__right) {
    maze[address.__middleRight[0]][address.__middleRight[1]] = " "
  } else if (nextCellNo === neighbors.__top) {
    maze[address.__topCenter[0]][address.__topCenter[1]] = "   "
  }
}

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
