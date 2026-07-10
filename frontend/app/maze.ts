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
  if (level >= CONFIG.maxLevel) {
    level = CONFIG.maxLevel
  }

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
    bottomCenter: [row, column - 1],
    bottomLeft: [row, column - CONFIG.cellSpan],
    bottomRight: [row, column],
    middleCenter: [row - 1, column - 1],
    middleLeft: [row - 1, column - CONFIG.cellSpan],
    middleRight: [row - 1, column],
    topCenter: [row - CONFIG.cellSpan, column - 1],
    topLeft: [row - CONFIG.cellSpan, column - CONFIG.cellSpan],
    topRight: [row - CONFIG.cellSpan, column],
  }
}

function getCellNeighbors(
  dimensions: BaseDimensions,
  cellNo: number,
): CellNeighbors {
  if (cellNo <= 0 || cellNo > dimensions.length * dimensions.width) {
    return { bottom: 0, left: 0, right: 0, top: 0 }
  }

  const column = (cellNo - 1) % dimensions.length
  const neighbors: CellNeighbors = {
    bottom: 0,
    left: 0,
    right: 0,
    top: 0,
  }

  if (column < dimensions.length - 1) {
    neighbors.right = cellNo + 1
  }

  if (column > 0) {
    neighbors.left = cellNo - 1
  }

  if (cellNo - dimensions.length > 0) {
    neighbors.top = cellNo - dimensions.length
  }

  if (cellNo + dimensions.length <= dimensions.length * dimensions.width) {
    neighbors.bottom = cellNo + dimensions.length
  }

  return neighbors
}

function countNeighbors(neighbors: CellNeighbors): number {
  let count = 0

  if (neighbors.bottom !== 0) {
    count += 1
  }

  if (neighbors.left !== 0) {
    count += 1
  }

  if (neighbors.right !== 0) {
    count += 1
  }

  if (neighbors.top !== 0) {
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

  if (neighbors.bottom !== 0 && !visited[neighbors.bottom]) {
    present.push(neighbors.bottom)
  }

  if (neighbors.left !== 0 && !visited[neighbors.left]) {
    present.push(neighbors.left)
  }

  if (neighbors.right !== 0 && !visited[neighbors.right]) {
    present.push(neighbors.right)
  }

  if (neighbors.top !== 0 && !visited[neighbors.top]) {
    present.push(neighbors.top)
  }

  return present
}

function getNavigationProfile(dimensions: BaseDimensions): NavigationProfile {
  const bands: Array<{ maxArea: number; profile: NavigationProfile }> = [
    {
      maxArea: 180,
      profile: {
        softCorridorLimit: 2,
        hardCorridorLimit: 3,
        preferTurnPercent: 80,
      },
    },
    {
      maxArea: 300,
      profile: {
        softCorridorLimit: 3,
        hardCorridorLimit: 4,
        preferTurnPercent: 70,
      },
    },
    {
      maxArea: 450,
      profile: {
        softCorridorLimit: 4,
        hardCorridorLimit: 5,
        preferTurnPercent: 60,
      },
    },
    {
      maxArea: 600,
      profile: {
        softCorridorLimit: 5,
        hardCorridorLimit: 6,
        preferTurnPercent: 50,
      },
    },
    {
      maxArea: 1000,
      profile: {
        softCorridorLimit: 5,
        hardCorridorLimit: 7,
        preferTurnPercent: 45,
      },
    },
    {
      maxArea: 1600,
      profile: {
        softCorridorLimit: 6,
        hardCorridorLimit: 7,
        preferTurnPercent: 40,
      },
    },
    {
      maxArea: generateMazeArea(CONFIG.maxLevel),
      profile: {
        softCorridorLimit: 6,
        hardCorridorLimit: 8,
        preferTurnPercent: 35,
      },
    },
  ]

  const area = dimensions.length * dimensions.width
  return (
    bands.find((band) => area <= band.maxArea)?.profile ??
    bands[bands.length - 1].profile
  )
}

function directionBetween(
  dimensions: BaseDimensions,
  currentCell: number,
  nextCell: number,
): Direction {
  const neighbors = getCellNeighbors(dimensions, currentCell)

  if (nextCell === neighbors.top) {
    return "up"
  }

  if (nextCell === neighbors.bottom) {
    return "down"
  }

  if (nextCell === neighbors.left) {
    return "left"
  }

  if (nextCell === neighbors.right) {
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
    const currentCell = path[path.length - 1].cellNo
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
      currentState.cellNo,
      neighbor,
    )
    const straightLength =
      nextDirection === currentState.moveDirection
        ? currentState.corridorLength + 1
        : 1

    const choice: PathStep = {
      cellNo: neighbor,
      moveDirection: nextDirection,
      corridorLength: straightLength,
    }

    allChoices.push(choice)

    if (nextDirection !== currentState.moveDirection) {
      turnChoices.push(choice)
    }

    if (straightLength <= profile.hardCorridorLimit) {
      withinHardLimit.push(choice)
    }
  }

  let choices = withinHardLimit.length > 0 ? withinHardLimit : allChoices

  if (currentState.moveDirection !== "none" && turnChoices.length > 0) {
    const turnPreferenceRoll = getRandomNo(CONFIG.percentScale)

    if (currentState.corridorLength >= profile.hardCorridorLimit) {
      choices = turnChoices
    } else if (
      currentState.corridorLength >= profile.softCorridorLimit &&
      turnPreferenceRoll < profile.preferTurnPercent
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

  if (nextCellNo === neighbors.bottom) {
    maze[address.bottomCenter[0]][address.bottomCenter[1]] = "   "
  } else if (nextCellNo === neighbors.left) {
    maze[address.middleLeft[0]][address.middleLeft[1]] = " "
  } else if (nextCellNo === neighbors.right) {
    maze[address.middleRight[0]][address.middleRight[1]] = " "
  } else if (nextCellNo === neighbors.top) {
    maze[address.topCenter[0]][address.topCenter[1]] = "   "
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

    replaceChar(dimensions, address.bottomRight, chars[2], maze)
    replaceChar(dimensions, address.topRight, chars[2], maze)
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
    { cellNo: startCell, moveDirection: "none", corridorLength: 0 },
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

    if (visited[nextChoice.cellNo]) {
      continue
    }

    visited[nextChoice.cellNo] = true
    visitedCount += 1
    createPath(dimensions, maze, currentCell, nextChoice.cellNo)
    path.push(nextChoice)

    if (path.length > longestPathLength) {
      longestPathLength = path.length
      finalCell = nextChoice.cellNo
    }
  }

  const finalAddress = getCellAddress(dimensions, finalCell)
  if (!finalAddress) {
    throw new Error("failed to resolve target address")
  }

  optimizeMaze(dimensions, weight, maze)

  return {
    maze,
    startPosition: [startAddress.middleCenter[0], startAddress.middleCenter[1]],
    finalPosition: [finalAddress.middleCenter[0], finalAddress.middleCenter[1]],
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
