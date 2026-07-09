type GameStatus = "boot" | "running" | "paused" | "won" | "lost" | "quit" | "too-small";

type Direction = "LEFT" | "RIGHT" | "UP" | "DOWN";

type Position = [number, number];

type WallWeight = 1 | 2 | 3;

type TerminalMeasurement = {
  rows: number;
  cols: number;
};

type BaseDimensions = {
  length: number;
  width: number;
};

type LevelDimensions = BaseDimensions & {
  level: number;
};

type CellAddress = {
  bottomCenter: Position;
  bottomLeft: Position;
  bottomRight: Position;
  middleCenter: Position;
  middleLeft: Position;
  middleRight: Position;
  topCenter: Position;
  topLeft: Position;
  topRight: Position;
};

type CellNeighbors = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

type RoundState = {
  maze: string[][];
  startPosition: Position;
  finalPosition: Position;
};

type ScreenLine = {
  kind: "text" | "maze";
  text: string;
  className: string;
};

type Elements = {
  app: HTMLElement;
  body: HTMLElement;
  screen: HTMLElement;
  measure: HTMLElement;
  controls: HTMLButtonElement[];
};

type State = {
  level: number;
  dims: BaseDimensions | null;
  maze: string[][] | null;
  playerPosition: Position | null;
  finalPosition: Position | null;
  status: GameStatus;
  score: number;
  lastRoundScore: number;
  canResume: boolean;
  wallWeight: WallWeight;
  clock: GameClock | null;
  charWidth: number;
  charHeight: number;
};

type AppConfig = {
  cellSpan: number;
  cellPathWidth: number;
  moveStep: number;
  scoreMultiplier: number;
  refreshInterval: number;
  mazeLeftPadding: number;
  seed: number;
  diff: number;
  maxLevel: number;
  minMazeDimension: number;
  terminalHeightInset: number;
  terminalHeightScale: number;
  terminalWidthInset: number;
  terminalWidthScale: number;
  intro: string;
  website: string;
  navigation: string;
  pauseMessage: string;
  successMessage: string;
  failedMessage: string;
  quitMessage: string;
  proceedMessage: string;
  resumeHint: string;
  tooSmallMessage: string;
  statusTemplate: string;
  highScoreTemplate: string;
  walls: Record<WallWeight, [string, string, string]>;
};

const CONFIG: AppConfig = {
  cellSpan: 2,
  cellPathWidth: 3,
  moveStep: 2,
  scoreMultiplier: 100,
  refreshInterval: 50,
  mazeLeftPadding: 3,
  seed: 100,
  diff: 10,
  maxLevel: 290,
  minMazeDimension: 5,
  terminalHeightInset: 5,
  terminalHeightScale: 4,
  terminalWidthInset: 10,
  terminalWidthScale: 2,
  intro: "You are playing the Maze runner, hide and seek game (Tapoo).",
  website: "Visit https://www.linkedin.com/in/migwi-ndungu/ to contact the developer.",
  navigation:
    "Use the Arrow Keys to navigate the player (in Blue). Press Ctrl+B to change walls thickness.",
  pauseMessage: "Game Paused !!!",
  successMessage: "Game Over! : Congratulations, Won by Locating the target on time.",
  failedMessage: "Game Over! : Ooops!!!, Failed to locate the target on time.",
  quitMessage: "Terminal session closed. Press Restart or Enter to play again.",
  proceedMessage: "Press ESC or Ctrl+C to quit.     Press Ctrl+P to Proceed",
  resumeHint: "Press ESC or Ctrl+C to quit.     Press Ctrl+P to Proceed",
  tooSmallMessage: "The viewport is too small for Tapoo. Expand the terminal to continue.",
  statusTemplate: "Press Space to Pause.   Press Ctrl+B to Change Walls.   Level: {level}   Scores: {score}",
  highScoreTemplate: "Final Game Level Scores: {score}",
  walls: {
    1: ["|", "---", "-"],
    2: ["╏", "╍╍╍", "╍"],
    3: ["║", "===", "="],
  },
};

class GameClock {
  levelDurationMs: number;
  startedAt: number;
  pausedAt: number;
  pausedDuration: number;

  constructor(levelDurationMs: number) {
    this.levelDurationMs = levelDurationMs;
    this.startedAt = performance.now();
    this.pausedAt = 0;
    this.pausedDuration = 0;
  }

  elapsed(now = performance.now()): number {
    return now - this.startedAt - this.pausedDuration;
  }

  remaining(now = performance.now()): number {
    return Math.max(0, this.levelDurationMs - this.elapsed(now));
  }

  pause(now = performance.now()): void {
    if (!this.pausedAt) {
      this.pausedAt = now;
    }
  }

  resume(now = performance.now()): void {
    if (!this.pausedAt) {
      return;
    }

    this.pausedDuration += now - this.pausedAt;
    this.pausedAt = 0;
  }
}

function mustElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`missing required element: ${id}`);
  }

  return element as T;
}

const elements: Elements = {
  app: mustElement<HTMLElement>("terminal-app"),
  body: mustElement<HTMLElement>("terminal-body"),
  screen: mustElement<HTMLElement>("terminal-screen"),
  measure: mustElement<HTMLElement>("terminal-measure"),
  controls: Array.from(document.querySelectorAll<HTMLButtonElement>("[data-action]")),
};

const state: State = {
  level: 1,
  dims: null,
  maze: null,
  playerPosition: null,
  finalPosition: null,
  status: "boot",
  score: 0,
  lastRoundScore: 0,
  canResume: false,
  wallWeight: 1,
  clock: null,
  charWidth: 9,
  charHeight: 20,
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function measureTerminal(): TerminalMeasurement {
  const rect = elements.body.getBoundingClientRect();
  const sampleRect = elements.measure.getBoundingClientRect();
  state.charWidth = sampleRect.width / 10 || 9;
  state.charHeight = sampleRect.height || 20;

  return {
    rows: Math.max(20, Math.floor(rect.height / state.charHeight)),
    cols: Math.max(48, Math.floor(rect.width / state.charWidth)),
  };
}

function getRandomNo(limit: number): number {
  if (limit <= 0) {
    return 0;
  }

  return Math.floor(Math.random() * limit);
}

function getWallCharacters(weight: WallWeight): [string, string, string] {
  return CONFIG.walls[weight];
}

function nextWallWeight(weight: WallWeight): WallWeight {
  if (weight === 3) {
    return 1;
  }

  return (weight + 1) as WallWeight;
}

function isSpaceFound(item: string): boolean {
  return item.includes(" ");
}

function getTerminalSize(width: number, height: number): BaseDimensions {
  return {
    length: Math.floor((width - CONFIG.terminalHeightInset) / CONFIG.terminalHeightScale),
    width: Math.floor((height - CONFIG.terminalWidthInset) / CONFIG.terminalWidthScale),
  };
}

function generateMazeArea(level: number): number {
  const boundedLevel = Math.min(level, CONFIG.maxLevel);
  return boundedLevel * CONFIG.diff + CONFIG.seed;
}

function absInt(value: number): number {
  return value < 0 ? -value : value;
}

function appendFittingDimensions(
  candidates: BaseDimensions[],
  length: number,
  width: number,
  terminalSize: BaseDimensions,
): BaseDimensions[] {
  if (length < CONFIG.minMazeDimension || width < CONFIG.minMazeDimension) {
    return candidates;
  }

  if (terminalSize.length >= length && terminalSize.width >= width) {
    candidates.push({ length, width });
  }

  if (length !== width && terminalSize.length >= width && terminalSize.width >= length) {
    candidates.push({ length: width, width: length });
  }

  return candidates;
}

function fittingDimensionsForArea(area: number, terminalSize: BaseDimensions): BaseDimensions[] {
  const candidates: BaseDimensions[] = [];

  for (let divisor = Math.floor(Math.sqrt(area)); divisor >= CONFIG.minMazeDimension; divisor -= 1) {
    if (area % divisor !== 0) {
      continue;
    }

    appendFittingDimensions(candidates, divisor, Math.floor(area / divisor), terminalSize);
  }

  return candidates;
}

function aspectMismatchScore(candidate: BaseDimensions, terminalSize: BaseDimensions): number {
  return absInt(candidate.length * terminalSize.width - candidate.width * terminalSize.length);
}

function isPreferredMazeDimensions(
  candidate: BaseDimensions,
  currentBest: BaseDimensions,
  terminalSize: BaseDimensions,
): boolean {
  const candidatePenalty = aspectMismatchScore(candidate, terminalSize);
  const bestPenalty = aspectMismatchScore(currentBest, terminalSize);
  if (candidatePenalty !== bestPenalty) {
    return candidatePenalty < bestPenalty;
  }

  const candidateSkew = absInt(candidate.length - candidate.width);
  const bestSkew = absInt(currentBest.length - currentBest.width);
  if (candidateSkew !== bestSkew) {
    return candidateSkew < bestSkew;
  }

  const candidateMinEdge = Math.min(candidate.length, candidate.width);
  const bestMinEdge = Math.min(currentBest.length, currentBest.width);
  if (candidateMinEdge !== bestMinEdge) {
    return candidateMinEdge > bestMinEdge;
  }

  if (candidate.length !== currentBest.length) {
    return candidate.length > currentBest.length;
  }

  return candidate.width > currentBest.width;
}

function chooseBestMazeDimensions(
  candidates: BaseDimensions[],
  terminalSize: BaseDimensions,
): BaseDimensions {
  let best = candidates[0];

  for (const candidate of candidates.slice(1)) {
    if (isPreferredMazeDimensions(candidate, best, terminalSize)) {
      best = candidate;
    }
  }

  return best;
}

function getMazeDimensions(level: number, terminalSize: BaseDimensions): LevelDimensions | null {
  const area = generateMazeArea(level);
  if (area > terminalSize.width * terminalSize.length) {
    return null;
  }

  const candidates = fittingDimensionsForArea(area, terminalSize);
  if (candidates.length === 0) {
    return null;
  }

  const selected = chooseBestMazeDimensions(candidates, terminalSize);
  return { ...selected, level };
}

function createPlayingField(dimensions: BaseDimensions, weight: WallWeight): string[][] {
  const chars = getWallCharacters(weight);
  const rows = CONFIG.cellSpan * dimensions.width + 1;
  const path = " ".repeat(CONFIG.cellPathWidth);
  const data: string[][] = [];

  for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
    const row: string[] = [];

    for (let columnIndex = 0; columnIndex <= dimensions.length; columnIndex += 1) {
      row.push(chars[0]);

      if (columnIndex !== dimensions.length && rowIndex % 2 === 0) {
        row.push(chars[1]);
      } else if (columnIndex !== dimensions.length) {
        row.push(path);
      }
    }

    data.push(row);
  }

  return data;
}

function getCellAddress(dimensions: BaseDimensions, cellNo: number): CellAddress | null {
  if (cellNo <= 0 || cellNo > dimensions.length * dimensions.width) {
    return null;
  }

  const row = (Math.floor((cellNo - 1) / dimensions.length) + 1) * CONFIG.cellSpan;
  const column = ((cellNo - 1) % dimensions.length + 1) * CONFIG.cellSpan;

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
  };
}

function getCellNeighbors(dimensions: BaseDimensions, cellNo: number): CellNeighbors {
  if (cellNo <= 0 || cellNo > dimensions.length * dimensions.width) {
    return { bottom: 0, left: 0, right: 0, top: 0 };
  }

  const column = (cellNo - 1) % dimensions.length;
  const neighbors: CellNeighbors = {
    bottom: 0,
    left: 0,
    right: 0,
    top: 0,
  };

  if (column < dimensions.length - 1) {
    neighbors.right = cellNo + 1;
  }

  if (column > 0) {
    neighbors.left = cellNo - 1;
  }

  if (cellNo - dimensions.length > 0) {
    neighbors.top = cellNo - dimensions.length;
  }

  if (cellNo + dimensions.length <= dimensions.length * dimensions.width) {
    neighbors.bottom = cellNo + dimensions.length;
  }

  return neighbors;
}

function countNeighbors(neighbors: CellNeighbors): number {
  let count = 0;

  if (neighbors.bottom !== 0) {
    count += 1;
  }

  if (neighbors.left !== 0) {
    count += 1;
  }

  if (neighbors.right !== 0) {
    count += 1;
  }

  if (neighbors.top !== 0) {
    count += 1;
  }

  return count;
}

function getPresentNeighbors(dimensions: BaseDimensions, cellNo: number, visited: boolean[]): number[] {
  const neighbors = getCellNeighbors(dimensions, cellNo);
  const present: number[] = [];

  if (neighbors.bottom !== 0 && !visited[neighbors.bottom]) {
    present.push(neighbors.bottom);
  }

  if (neighbors.left !== 0 && !visited[neighbors.left]) {
    present.push(neighbors.left);
  }

  if (neighbors.right !== 0 && !visited[neighbors.right]) {
    present.push(neighbors.right);
  }

  if (neighbors.top !== 0 && !visited[neighbors.top]) {
    present.push(neighbors.top);
  }

  return present;
}

function getStartPosition(dimensions: BaseDimensions): number {
  const totalCells = dimensions.length * dimensions.width;

  while (true) {
    const randomCellNo = getRandomNo(totalCells) + 1;
    if (countNeighbors(getCellNeighbors(dimensions, randomCellNo)) < 4) {
      return randomCellNo;
    }
  }
}

function createPath(
  dimensions: BaseDimensions,
  maze: string[][],
  currentCellNo: number,
  nextCellNo: number,
): void {
  const address = getCellAddress(dimensions, currentCellNo);
  if (!address) {
    return;
  }

  const neighbors = getCellNeighbors(dimensions, currentCellNo);

  if (nextCellNo === neighbors.bottom) {
    maze[address.bottomCenter[0]][address.bottomCenter[1]] = "   ";
  } else if (nextCellNo === neighbors.left) {
    maze[address.middleLeft[0]][address.middleLeft[1]] = " ";
  } else if (nextCellNo === neighbors.right) {
    maze[address.middleRight[0]][address.middleRight[1]] = " ";
  } else if (nextCellNo === neighbors.top) {
    maze[address.topCenter[0]][address.topCenter[1]] = "   ";
  }
}

function replaceChar(
  dimensions: BaseDimensions,
  point: Position,
  replacement: string,
  maze: string[][],
): void {
  let topItem = "";
  let bottomItem = "";
  let hasTop = false;
  let hasBottom = false;

  if (point[0] - 1 > 0) {
    topItem = maze[point[0] - 1][point[1]];
    hasTop = true;
  }

  if (point[0] + 1 <= dimensions.width * CONFIG.cellSpan) {
    bottomItem = maze[point[0] + 1][point[1]];
    hasBottom = true;
  }

  const row = point[0];
  const column = point[1];

  if (!hasTop && hasBottom && isSpaceFound(bottomItem)) {
    maze[row][column] = replacement;
  } else if (hasTop && !hasBottom && isSpaceFound(topItem)) {
    maze[row][column] = replacement;
  } else if (hasTop && hasBottom && isSpaceFound(topItem) && isSpaceFound(bottomItem)) {
    maze[row][column] = replacement;
  }
}

function optimizeMaze(dimensions: BaseDimensions, weight: WallWeight, maze: string[][]): void {
  const chars = getWallCharacters(weight);

  for (let cell = 1; cell <= dimensions.length * dimensions.width; cell += 1) {
    const address = getCellAddress(dimensions, cell);
    if (!address) {
      continue;
    }

    replaceChar(dimensions, address.bottomRight, chars[2], maze);
    replaceChar(dimensions, address.topRight, chars[2], maze);
  }
}

function generateMaze(dimensions: BaseDimensions, weight: WallWeight): RoundState {
  const totalCells = dimensions.length * dimensions.width;
  const visited = new Array<boolean>(totalCells + 1).fill(false);
  const maze = createPlayingField(dimensions, weight);
  const startCell = getStartPosition(dimensions);
  const path = [startCell];
  let currentCell = startCell;
  let visitedCount = 1;
  let longestPathLength = 1;
  let finalCell = startCell;

  const startAddress = getCellAddress(dimensions, startCell);
  if (!startAddress) {
    throw new Error("failed to resolve start address");
  }

  visited[currentCell] = true;

  while (visitedCount < totalCells) {
    let neighbors: number[] = [];

    while (neighbors.length === 0) {
      neighbors = getPresentNeighbors(dimensions, currentCell, visited);

      if (neighbors.length === 0) {
        path.pop();
        currentCell = path[path.length - 1];
      }
    }

    const nextCell = neighbors[getRandomNo(neighbors.length)];
    if (visited[nextCell]) {
      continue;
    }

    visited[nextCell] = true;
    visitedCount += 1;
    createPath(dimensions, maze, currentCell, nextCell);
    path.push(nextCell);

    if (path.length > longestPathLength) {
      longestPathLength = path.length;
      finalCell = nextCell;
    }

    currentCell = nextCell;
  }

  const finalAddress = getCellAddress(dimensions, finalCell);
  if (!finalAddress) {
    throw new Error("failed to resolve target address");
  }

  optimizeMaze(dimensions, weight, maze);

  return {
    maze,
    startPosition: [startAddress.middleCenter[0], startAddress.middleCenter[1]],
    finalPosition: [finalAddress.middleCenter[0], finalAddress.middleCenter[1]],
  };
}

function reweightMaze(data: string[][], currentWeight: WallWeight): string[][] {
  const fromChars = getWallCharacters(currentWeight);
  const toChars = getWallCharacters(nextWallWeight(currentWeight));
  const replacements = new Map<string, string>([
    [fromChars[0], toChars[0]],
    [fromChars[1], toChars[1]],
    [fromChars[2], toChars[2]],
  ]);

  return data.map((row) =>
    row.map((cell) => {
      return replacements.get(cell) ?? cell;
    }),
  );
}

function calculateScore(totalCells: number, elapsedMs: number): number {
  return Math.max(0, totalCells - Math.floor(elapsedMs / 1000)) * CONFIG.scoreMultiplier;
}

function positionsEqual(left: Position, right: Position): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

function startRound(level: number): void {
  const viewport = measureTerminal();
  const terminalSize = getTerminalSize(viewport.cols, viewport.rows);
  const dimensions = getMazeDimensions(level, terminalSize);

  if (!dimensions) {
    state.status = "too-small";
    state.level = level;
    state.dims = null;
    state.maze = null;
    state.playerPosition = null;
    state.finalPosition = null;
    state.score = 0;
    state.lastRoundScore = 0;
    state.canResume = false;
    state.clock = null;
    render();
    return;
  }

  const round = generateMaze(dimensions, state.wallWeight);

  state.level = dimensions.level;
  state.dims = { length: dimensions.length, width: dimensions.width };
  state.maze = round.maze;
  state.playerPosition = [round.startPosition[0], round.startPosition[1]];
  state.finalPosition = [round.finalPosition[0], round.finalPosition[1]];
  state.status = "running";
  state.canResume = false;
  state.lastRoundScore = 0;

  const totalCells = dimensions.length * dimensions.width;
  state.clock = new GameClock(totalCells * 1000);
  state.score = calculateScore(totalCells, 0);
  render();
}

function restartGame(): void {
  startRound(1);
}

function resumeOrProceed(): void {
  if (state.status === "paused" && state.canResume && state.clock) {
    state.clock.resume();
    state.status = "running";
    state.canResume = false;
    render();
    return;
  }

  if (state.status === "won") {
    startRound(state.level + 1);
    return;
  }

  if (state.status === "lost") {
    startRound(state.level);
    return;
  }

  if (state.status === "quit" || state.status === "too-small") {
    restartGame();
  }
}

function pauseGame(): void {
  if (state.status !== "running" || !state.clock) {
    return;
  }

  state.clock.pause();
  state.status = "paused";
  state.canResume = true;
  render();
}

function quitGame(): void {
  if (state.status === "running" || state.status === "paused") {
    state.lastRoundScore = state.score;
  }

  if (state.clock && state.status === "paused") {
    state.clock.resume();
  }

  state.status = "quit";
  state.canResume = false;
  render();
}

function cycleWallWeight(): void {
  if (!state.maze) {
    return;
  }

  state.maze = reweightMaze(state.maze, state.wallWeight);
  state.wallWeight = nextWallWeight(state.wallWeight);
  render();
}

function movePlayer(direction: Direction): void {
  if (state.status !== "running" || !state.maze || !state.dims || !state.playerPosition) {
    return;
  }

  const row = state.playerPosition[0];
  const column = state.playerPosition[1];

  if (direction === "LEFT" && column - CONFIG.moveStep > 0 && isSpaceFound(state.maze[row][column - 1])) {
    state.playerPosition[1] = column - CONFIG.moveStep;
  } else if (
    direction === "RIGHT" &&
    column + CONFIG.moveStep <= state.dims.length * CONFIG.cellSpan &&
    isSpaceFound(state.maze[row][column + 1])
  ) {
    state.playerPosition[1] = column + CONFIG.moveStep;
  } else if (
    direction === "UP" &&
    row - CONFIG.moveStep > 0 &&
    isSpaceFound(state.maze[row - 1][column])
  ) {
    state.playerPosition[0] = row - CONFIG.moveStep;
  } else if (
    direction === "DOWN" &&
    row + CONFIG.moveStep <= state.dims.width * CONFIG.cellSpan &&
    isSpaceFound(state.maze[row + 1][column])
  ) {
    state.playerPosition[0] = row + CONFIG.moveStep;
  }

  handleWinCheck();
  render();
}

function handleWinCheck(): void {
  if (state.clock && state.dims) {
    const totalCells = state.dims.length * state.dims.width;
    state.score = calculateScore(totalCells, state.clock.elapsed());
  }

  if (!state.playerPosition || !state.finalPosition || !positionsEqual(state.playerPosition, state.finalPosition)) {
    return;
  }

  state.status = "won";
  state.canResume = false;
  state.lastRoundScore = state.score;
}

function handleLoss(): void {
  if (state.status !== "running" || !state.dims) {
    return;
  }

  if (state.clock) {
    const totalCells = state.dims.length * state.dims.width;
    state.score = calculateScore(totalCells, state.clock.elapsed());
  }

  state.status = "lost";
  state.canResume = false;
  state.lastRoundScore = state.score;
  render();
}

function tick(): void {
  if (state.status !== "running" || !state.clock || !state.dims) {
    return;
  }

  const totalCells = state.dims.length * state.dims.width;
  state.score = calculateScore(totalCells, state.clock.elapsed());

  if (state.clock.remaining() <= 0) {
    handleLoss();
    return;
  }

  render();
}

function centerText(width: number, value: string): string {
  if (value.length >= width) {
    return value;
  }

  const leftPadding = Math.floor((width - value.length) / 2);
  return `${" ".repeat(leftPadding)}${value}`;
}

function leftPad(value: string, padding: number): string {
  return `${" ".repeat(Math.max(0, padding))}${value}`;
}

function padLine(value: string, width: number): string {
  if (value.length >= width) {
    return value;
  }

  return `${value}${" ".repeat(width - value.length)}`;
}

function replaceAt(line: string, index: number, char: string): string {
  if (index < 0 || index >= line.length) {
    return line;
  }

  return `${line.slice(0, index)}${char}${line.slice(index + 1)}`;
}

function statusText(): string {
  return CONFIG.statusTemplate
    .replace("{level}", String(state.level))
    .replace("{score}", String(state.score));
}

function buildMazeLines(): string[] {
  if (!state.maze) {
    return [];
  }

  const lines = state.maze.map((row) => row.join(""));

  if (state.finalPosition) {
    lines[state.finalPosition[0]] = replaceAt(
      lines[state.finalPosition[0]],
      state.finalPosition[1] * CONFIG.cellSpan,
      "#",
    );
  }

  if (state.playerPosition) {
    lines[state.playerPosition[0]] = replaceAt(
      lines[state.playerPosition[0]],
      state.playerPosition[1] * CONFIG.cellSpan,
      "@",
    );
  }

  return lines.map((line) => leftPad(line, CONFIG.mazeLeftPadding));
}

function renderMarkedLine(rawLine: string): string {
  let html = "";

  for (const char of rawLine) {
    const value = char === " " ? "&nbsp;" : escapeHtml(char);

    if (char === "@") {
      html += `<span class="maze-cell player">${value}</span>`;
    } else if (char === "#") {
      html += `<span class="maze-cell target">${value}</span>`;
    } else {
      html += `<span class="maze-cell copy">${value}</span>`;
    }
  }

  return `<span class="maze-row">${html}</span>`;
}

function renderTextLine(value: string, className = "copy"): string {
  const html = escapeHtml(value).replaceAll(" ", "&nbsp;");
  return `<span class="${className}">${html}</span>`;
}

function headerWidth(mazeWidth: number): number {
  return Math.max(mazeWidth, CONFIG.navigation.length + 4, CONFIG.website.length + 4, CONFIG.intro.length + 4);
}

function overlayRows(mazeWidth: number): ScreenLine[] {
  const lines: ScreenLine[] = [];

  if (state.status === "paused") {
    lines.push({ kind: "text", text: centerText(mazeWidth, CONFIG.pauseMessage), className: "copy" });
    lines.push({ kind: "text", text: " ".repeat(mazeWidth), className: "copy" });
    lines.push({ kind: "text", text: centerText(mazeWidth, CONFIG.resumeHint), className: "copy" });
    return lines;
  }

  if (state.status === "won" || state.status === "lost") {
    const message = state.status === "won" ? CONFIG.successMessage : CONFIG.failedMessage;
    lines.push({
      kind: "text",
      text: centerText(mazeWidth, message),
      className: state.status === "won" ? "copy" : "warning",
    });
    lines.push({
      kind: "text",
      text: centerText(mazeWidth, CONFIG.highScoreTemplate.replace("{score}", String(state.lastRoundScore))),
      className: "accent",
    });
    lines.push({ kind: "text", text: centerText(mazeWidth, CONFIG.proceedMessage), className: "copy" });
    return lines;
  }

  if (state.status === "quit") {
    lines.push({ kind: "text", text: centerText(mazeWidth, CONFIG.quitMessage), className: "warning" });
    return lines;
  }

  if (state.status === "too-small") {
    lines.push({ kind: "text", text: centerText(mazeWidth, CONFIG.tooSmallMessage), className: "warning" });
    return lines;
  }

  return lines;
}

function applyOverlayToMaze(mazeLines: string[], mazeWidth: number): ScreenLine[] {
  const screenMaze: ScreenLine[] = mazeLines.map((line) => ({
    kind: "maze",
    text: padLine(line, mazeWidth),
    className: "copy",
  }));

  const overlay = overlayRows(mazeWidth);
  if (overlay.length === 0) {
    return screenMaze;
  }

  const startRow = Math.max(0, Math.floor(screenMaze.length / 2) - 2);
  const clearCount = Math.max(overlay.length + 2, 4);

  for (let index = 0; index < clearCount; index += 1) {
    const rowIndex = startRow + index;
    if (rowIndex >= screenMaze.length) {
      break;
    }

    screenMaze[rowIndex] = {
      kind: "text",
      text: " ".repeat(mazeWidth),
      className: "copy",
    };
  }

  overlay.forEach((line, index) => {
    const rowIndex = startRow + index;
    if (rowIndex < screenMaze.length) {
      screenMaze[rowIndex] = line;
    }
  });

  return screenMaze;
}

function buildScreenLines(): ScreenLine[] {
  const mazeLines = buildMazeLines();
  const mazeWidth = mazeLines.reduce((width, line) => Math.max(width, line.length), 0);
  const contentWidth = headerWidth(mazeWidth);
  const lines: ScreenLine[] = [
    { kind: "text", text: centerText(contentWidth, CONFIG.intro), className: "copy" },
    { kind: "text", text: "", className: "copy" },
    { kind: "text", text: centerText(contentWidth, CONFIG.website), className: "copy" },
    { kind: "text", text: "", className: "copy" },
    { kind: "text", text: centerText(contentWidth, CONFIG.navigation), className: "copy" },
    { kind: "text", text: "", className: "copy" },
  ];

  if (mazeLines.length === 0) {
    overlayRows(contentWidth).forEach((line) => {
      lines.push({ kind: "text", text: "", className: "copy" });
      lines.push(line);
    });

    return lines;
  }

  const mazeSection = applyOverlayToMaze(mazeLines, Math.max(mazeWidth, contentWidth));
  lines.push(...mazeSection);

  if (state.status === "running") {
    lines.push({ kind: "text", text: "", className: "copy" });
    lines.push({
      kind: "text",
      text: centerText(Math.max(mazeWidth, contentWidth), statusText()),
      className: "copy",
    });
  }

  return lines;
}

function render(): void {
  const screenLines = buildScreenLines();
  elements.screen.innerHTML = screenLines
    .map((line) => {
      const content =
        line.kind === "maze" ? renderMarkedLine(line.text) : renderTextLine(line.text, line.className);
      return `<span class="line">${content}</span>`;
    })
    .join("");
}

function handleKeydown(event: KeyboardEvent): void {
  const key = event.key;
  const lowerKey = key.toLowerCase();
  const controlCombo = event.ctrlKey || event.metaKey;

  if (
    key.startsWith("Arrow") ||
    key === " " ||
    key === "Escape" ||
    key === "Enter" ||
    (controlCombo && lowerKey === "b") ||
    (controlCombo && lowerKey === "c") ||
    (controlCombo && lowerKey === "p")
  ) {
    event.preventDefault();
  }

  if (controlCombo && lowerKey === "b") {
    cycleWallWeight();
    return;
  }

  if (controlCombo && lowerKey === "p") {
    resumeOrProceed();
    return;
  }

  if (controlCombo && lowerKey === "c") {
    quitGame();
    return;
  }

  if (key === "Escape") {
    quitGame();
    return;
  }

  if (key === "Enter" && (state.status === "quit" || state.status === "too-small")) {
    restartGame();
    return;
  }

  if (key === "Enter" && (state.status === "won" || state.status === "lost")) {
    resumeOrProceed();
    return;
  }

  if (key === " ") {
    pauseGame();
    return;
  }

  if (key === "ArrowLeft") {
    movePlayer("LEFT");
  } else if (key === "ArrowRight") {
    movePlayer("RIGHT");
  } else if (key === "ArrowUp") {
    movePlayer("UP");
  } else if (key === "ArrowDown") {
    movePlayer("DOWN");
  }
}

function handleAction(action: string): void {
  elements.app.focus();

  if (action === "restart") {
    restartGame();
  }
}

function handleResize(): void {
  render();

  if (state.status === "too-small") {
    const viewport = measureTerminal();
    const terminalSize = getTerminalSize(viewport.cols, viewport.rows);
    if (getMazeDimensions(state.level, terminalSize)) {
      restartGame();
    }
  }
}

elements.controls.forEach((button) => {
  button.addEventListener("click", () => {
    handleAction(button.dataset.action || "");
  });
});

window.addEventListener("keydown", handleKeydown, { passive: false });
window.addEventListener("resize", handleResize);
window.setInterval(tick, CONFIG.refreshInterval);

elements.app.addEventListener("click", () => {
  elements.app.focus();
});

restartGame();
elements.app.focus();
