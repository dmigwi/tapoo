type GameStatus =
  | "boot"
  | "running"
  | "paused"
  | "won"
  | "lost"
  | "quit"
  | "too-small";

type Direction = "LEFT" | "RIGHT" | "UP" | "DOWN";

type Position = [number, number];

type OverlayLine = {
  text: string;
  className: string;
};

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

type Elements = {
  app: HTMLElement;
  body: HTMLElement;
  screen: HTMLElement;
  measure: HTMLElement;
  terminalStatus: HTMLElement;
  hudLevel: HTMLElement;
  hudScore: HTMLElement;
  hudHighScore: HTMLElement;
  hudMode: HTMLElement;
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
  highScore: number;
  clock: GameClock | null;
  lastRoundScore: number;
  canResume: boolean;
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
  mazeTopPadding: number;
  seed: number;
  diff: number;
  maxLevel: number;
  minMazeDimension: number;
  terminalHeightInset: number;
  terminalHeightScale: number;
  terminalWidthInset: number;
  terminalWidthScale: number;
  storageKey: string;
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
  walls: Record<number, [string, string, string]>;
};

const CONFIG: AppConfig = {
  cellSpan: 2,
  cellPathWidth: 3,
  moveStep: 2,
  scoreMultiplier: 100,
  refreshInterval: 50,
  mazeLeftPadding: 3,
  mazeTopPadding: 7,
  seed: 100,
  diff: 10,
  maxLevel: 100000,
  minMazeDimension: 5,
  terminalHeightInset: 5,
  terminalHeightScale: 4,
  terminalWidthInset: 10,
  terminalWidthScale: 2,
  storageKey: "tapoo-high-score",
  intro: "You are playing the Maze runner, hide and seek game (Tapoo).",
  website: "Visit https://www.linkedin.com/in/migwi-ndungu/ to contact the developer.",
  navigation: "Use the Arrow Keys to navigate the player (in Blue)",
  pauseMessage: "Game Paused !!!",
  successMessage: "Game Over! : Congratulations, Won by Locating the target on time.",
  failedMessage: "Game Over! : Ooops!!!, Failed to locate the target on time.",
  quitMessage: "Terminal session closed. Press Restart or Enter to play again.",
  proceedMessage: "Press ESC or Ctrl+C to quit.     Press Ctrl+P to Proceed",
  resumeHint: "Press ESC or Ctrl+C to quit.     Press Ctrl+P to Resume",
  tooSmallMessage: "The viewport is too small for Tapoo. Expand the terminal to continue.",
  statusTemplate: "Press Space to Pause.         Scores: {score}",
  highScoreTemplate: "High Scores: {score}",
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
  terminalStatus: mustElement<HTMLElement>("terminal-status"),
  hudLevel: mustElement<HTMLElement>("hud-level"),
  hudScore: mustElement<HTMLElement>("hud-score"),
  hudHighScore: mustElement<HTMLElement>("hud-high-score"),
  hudMode: mustElement<HTMLElement>("hud-mode"),
  controls: Array.from(document.querySelectorAll<HTMLButtonElement>("[data-action]")),
};

const state: State = {
  level: 0,
  dims: null,
  maze: null,
  playerPosition: null,
  finalPosition: null,
  status: "boot",
  score: 0,
  highScore: readHighScore(),
  clock: null,
  lastRoundScore: 0,
  canResume: false,
  charWidth: 9,
  charHeight: 20,
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function readHighScore(): number {
  try {
    return Number(window.localStorage.getItem(CONFIG.storageKey) || 0);
  } catch {
    return 0;
  }
}

function writeHighScore(score: number): void {
  try {
    window.localStorage.setItem(CONFIG.storageKey, String(score));
  } catch {
    // Ignore browsers that block storage in local-file mode.
  }
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
  return Math.floor(Math.random() * limit);
}

function getCeiledDivisor(num: number, divisor: number): number {
  return Math.ceil(num / divisor);
}

function getWallCharacters(intensity: number): [string, string, string] {
  return CONFIG.walls[intensity] || CONFIG.walls[1];
}

function isSpaceFound(item: string): boolean {
  return item.includes(" ");
}

function getTerminalSize(height: number, width: number): BaseDimensions {
  return {
    length: Math.floor((height - CONFIG.terminalHeightInset) / CONFIG.terminalHeightScale),
    width: Math.floor((width - CONFIG.terminalWidthInset) / CONFIG.terminalWidthScale),
  };
}

function generateMazeArea(level: number): number {
  const boundedLevel = Math.min(level, CONFIG.maxLevel);
  return boundedLevel * CONFIG.diff + CONFIG.seed;
}

function appendDimensions(
  remainder: number,
  x: number,
  y: number,
  terminalSize: BaseDimensions,
): BaseDimensions[] {
  if (remainder !== 0) {
    return [];
  }

  const sizes: BaseDimensions[] = [];
  if (terminalSize.length >= y && terminalSize.width >= x) {
    sizes.push({ length: y, width: x });
  }

  if (terminalSize.length >= x && terminalSize.width >= y) {
    sizes.push({ length: x, width: y });
  }

  return sizes;
}

function factorizeMazeArea(area: number, terminalSize: BaseDimensions): BaseDimensions[] {
  const sizes: BaseDimensions[] = [];

  for (let i = Math.floor(Math.sqrt(area)); i >= CONFIG.minMazeDimension; i -= 1) {
    const remainder = area % i;
    const value = Math.floor(area / i);
    sizes.push(...appendDimensions(remainder, i, value, terminalSize));
  }

  return sizes;
}

function getMazeDimensions(level: number, terminalSize: BaseDimensions): LevelDimensions | null {
  for (let currentLevel = level; currentLevel >= 0; currentLevel -= 1) {
    const area = generateMazeArea(currentLevel);

    if (area > terminalSize.width * terminalSize.length) {
      continue;
    }

    const dimensions = factorizeMazeArea(area, terminalSize);
    if (dimensions.length > 0) {
      const selected = dimensions[getRandomNo(dimensions.length)];
      return { ...selected, level: currentLevel };
    }
  }

  return null;
}

function createPlayingField(dimensions: BaseDimensions, intensity: number): string[][] {
  const chars = getWallCharacters(intensity);
  const data: string[][] = [];

  for (let row = 0; row < CONFIG.cellSpan * dimensions.width + 1; row += 1) {
    const values: string[] = [];

    for (let column = 0; column < dimensions.length + 1; column += 1) {
      values.push(chars[0]);

      if (column !== dimensions.length && row % 2 === 0) {
        values.push(chars[1]);
      } else if (column !== dimensions.length) {
        values.push(" ".repeat(CONFIG.cellPathWidth));
      }
    }

    data.push(values);
  }

  return data;
}

function getCellAddress(dimensions: BaseDimensions, cellNo: number): CellAddress | null {
  if (cellNo <= 0 || cellNo > dimensions.length * dimensions.width) {
    return null;
  }

  let column = cellNo % dimensions.length;
  if (column === 0) {
    column = dimensions.length;
  }

  const row = getCeiledDivisor(cellNo, dimensions.length) * CONFIG.cellSpan;
  column *= CONFIG.cellSpan;

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

  const right = cellNo + 1;
  const left = cellNo - 1;
  const top = cellNo - dimensions.length;
  const bottom = cellNo + dimensions.length;
  const neighbors: CellNeighbors = { bottom: 0, left: 0, right: 0, top: 0 };

  if (getCeiledDivisor(right, dimensions.length) === getCeiledDivisor(cellNo, dimensions.length)) {
    neighbors.right = right;
  }

  if (getCeiledDivisor(left, dimensions.length) === getCeiledDivisor(cellNo, dimensions.length)) {
    neighbors.left = left;
  }

  if (top > 0) {
    neighbors.top = top;
  }

  if (bottom <= dimensions.length * dimensions.width) {
    neighbors.bottom = bottom;
  }

  return neighbors;
}

function getPresentNeighbors(
  dimensions: BaseDimensions,
  cellNo: number,
  visited: Map<number, CellAddress>,
): number[] {
  const neighbors = getCellNeighbors(dimensions, cellNo);

  return [neighbors.bottom, neighbors.left, neighbors.right, neighbors.top].filter(
    (neighbor) => neighbor !== 0 && !visited.has(neighbor),
  );
}

function getStartPosition(dimensions: BaseDimensions, visited: Map<number, CellAddress>): number {
  const totalCells = dimensions.length * dimensions.width;

  while (true) {
    const randomCellNo = getRandomNo(totalCells) + 1;
    const neighbors = getPresentNeighbors(dimensions, randomCellNo, visited);

    if (neighbors.length < 4) {
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

function optimizeMaze(dimensions: BaseDimensions, intensity: number, maze: string[][]): void {
  const chars = getWallCharacters(intensity);

  for (let cell = 1; cell <= dimensions.length * dimensions.width; cell += 1) {
    const address = getCellAddress(dimensions, cell);
    if (!address) {
      continue;
    }

    replaceChar(dimensions, address.bottomRight, chars[2], maze);
    replaceChar(dimensions, address.topRight, chars[2], maze);
  }
}

// Maze generation mirrors the terminal version: DFS carves a spanning tree and
// promotes the farthest discovered cell into the target.
function generateMaze(dimensions: BaseDimensions, intensity: number): RoundState {
  const totalCells = dimensions.length * dimensions.width;
  const visited = new Map<number, CellAddress>();
  let currentCell = getStartPosition(dimensions, visited);
  let startCell = currentCell;
  const finalPosition: [number, number] = [1, startCell];
  const cellsPath = [startCell];
  const maze = createPlayingField(dimensions, intensity);

  const startAddress = getCellAddress(dimensions, startCell);
  if (!startAddress) {
    throw new Error("failed to resolve start address");
  }

  const generated: RoundState = {
    maze,
    startPosition: [startAddress.middleCenter[0], startAddress.middleCenter[1]],
    finalPosition: [startAddress.middleCenter[0], startAddress.middleCenter[1]],
  };

  visited.set(currentCell, startAddress);

  while (visited.size < totalCells) {
    let neighbors: number[] = [];

    while (neighbors.length === 0) {
      neighbors = getPresentNeighbors(dimensions, currentCell, visited);

      if (neighbors.length === 0) {
        cellsPath.pop();
        currentCell = cellsPath[cellsPath.length - 1];
      }
    }

    startCell = neighbors[getRandomNo(neighbors.length)];

    if (!visited.has(startCell)) {
      const address = getCellAddress(dimensions, startCell);
      if (!address) {
        continue;
      }

      visited.set(startCell, address);
      createPath(dimensions, maze, currentCell, startCell);
      cellsPath.push(startCell);

      if (cellsPath.length > finalPosition[0]) {
        finalPosition[0] = cellsPath.length;
        finalPosition[1] = startCell;
      }

      currentCell = startCell;
    }
  }

  const finalAddress = getCellAddress(dimensions, finalPosition[1]);
  if (!finalAddress) {
    throw new Error("failed to resolve target address");
  }

  generated.finalPosition = [finalAddress.middleCenter[0], finalAddress.middleCenter[1]];
  optimizeMaze(dimensions, intensity, maze);

  return generated;
}

function calculateScore(totalCells: number, elapsedMs: number): number {
  return Math.max(0, totalCells - Math.floor(elapsedMs / 1000)) * CONFIG.scoreMultiplier;
}

function positionsEqual(left: Position, right: Position): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

function updateHighScore(score: number): void {
  if (score <= state.highScore) {
    return;
  }

  state.highScore = score;
  writeHighScore(score);
}

function startRound(level: number): void {
  const viewport = measureTerminal();
  const terminalSize = getTerminalSize(viewport.rows, viewport.cols);
  const dimensions = getMazeDimensions(level, terminalSize);

  if (!dimensions) {
    state.status = "too-small";
    state.dims = null;
    state.maze = null;
    state.playerPosition = null;
    state.finalPosition = null;
    state.score = 0;
    state.canResume = false;
    state.level = level;
    render();
    return;
  }

  const round = generateMaze(dimensions, 1);

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
  startRound(0);
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
  updateHighScore(state.score);
}

function handleLoss(): void {
  if (state.status !== "running") {
    return;
  }

  if (state.clock && state.dims) {
    const totalCells = state.dims.length * state.dims.width;
    state.score = calculateScore(totalCells, state.clock.elapsed());
  }

  state.status = "lost";
  state.canResume = false;
  state.lastRoundScore = state.score;
  updateHighScore(state.score);
  render();
}

function tick(): void {
  if (state.status !== "running" || !state.clock || !state.dims) {
    return;
  }

  const totalCells = state.dims.length * state.dims.width;
  const elapsed = state.clock.elapsed();
  state.score = calculateScore(totalCells, elapsed);

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

function padLine(value: string, width: number): string {
  if (value.length >= width) {
    return value;
  }

  return `${value}${" ".repeat(width - value.length)}`;
}

function leftPad(value: string, padding: number): string {
  return `${" ".repeat(Math.max(0, padding))}${value}`;
}

function joinColumns(left: string, right: string, width: number): string {
  const gap = 5;
  const requiredWidth = left.length + right.length + gap;

  if (requiredWidth >= width) {
    return `${left}${" ".repeat(gap)}${right}`;
  }

  return `${left}${" ".repeat(width - left.length - right.length)}${right}`;
}

function getStatusPrompt(): string {
  if (state.status === "running") {
    return "Press Space to Pause.";
  }

  if (state.status === "paused") {
    return "Press Ctrl+P to Resume.";
  }

  if (state.status === "won" || state.status === "lost") {
    return "Press Ctrl+P to Proceed.";
  }

  if (state.status === "quit") {
    return "Press Enter to Restart.";
  }

  if (state.status === "too-small") {
    return "Resize the viewport.";
  }

  return "Arrow keys move the player.";
}

function overlayData(): OverlayLine[] {
  if (state.status === "paused") {
    return [
      { text: CONFIG.pauseMessage, className: "warning" },
      { text: CONFIG.resumeHint, className: "copy" },
    ];
  }

  if (state.status === "won") {
    return [
      { text: CONFIG.successMessage, className: "copy" },
      {
        text: CONFIG.highScoreTemplate.replace("{score}", String(state.highScore)),
        className: "accent",
      },
      { text: CONFIG.proceedMessage, className: "copy" },
    ];
  }

  if (state.status === "lost") {
    return [
      { text: CONFIG.failedMessage, className: "warning" },
      {
        text: CONFIG.highScoreTemplate.replace("{score}", String(state.highScore)),
        className: "accent",
      },
      { text: CONFIG.proceedMessage, className: "copy" },
    ];
  }

  if (state.status === "quit") {
    return [{ text: CONFIG.quitMessage, className: "warning" }];
  }

  if (state.status === "too-small") {
    return [{ text: CONFIG.tooSmallMessage, className: "warning" }];
  }

  return [];
}

function replaceAt(line: string, index: number, char: string): string {
  if (index < 0 || index >= line.length) {
    return line;
  }

  return `${line.slice(0, index)}${char}${line.slice(index + 1)}`;
}

function buildMazeLines(): string[] {
  if (!state.maze) {
    return [];
  }

  const lines = state.maze.map((row) => row.join(""));

  if (state.finalPosition) {
    const targetX = state.finalPosition[1] * CONFIG.cellSpan;
    const targetY = state.finalPosition[0];
    lines[targetY] = replaceAt(lines[targetY], targetX, "#");
  }

  if (state.playerPosition) {
    const playerX = state.playerPosition[1] * CONFIG.cellSpan;
    const playerY = state.playerPosition[0];
    lines[playerY] = replaceAt(lines[playerY], playerX, "@");
  }

  return lines;
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
  return `<span class="${className}">${escapeHtml(value)}</span>`;
}

function buildScreenLines(): string[] {
  const mazeLines = buildMazeLines();
  const lines: string[] = [];
  const measured = measureTerminal();
  const maxWidth = Math.max(54, measured.cols - 4);
  const mazeIndent = Math.max(1, CONFIG.mazeLeftPadding - 1);
  const mazeWidth = mazeLines.reduce((width, line) => Math.max(width, line.length + mazeIndent), 0);
  const contentWidth = Math.min(maxWidth, Math.max(mazeWidth, 56));
  const headerWidth = Math.min(maxWidth, Math.max(contentWidth, 62));
  const headerOffset = 1;

  lines.push(renderTextLine(leftPad(centerText(headerWidth, CONFIG.intro), headerOffset)));
  lines.push(renderTextLine(""));

  if (mazeLines.length === 0) {
    overlayData().forEach((item) => {
      lines.push(renderTextLine(""));
      lines.push(
        renderTextLine(leftPad(centerText(headerWidth, item.text), headerOffset), item.className),
      );
    });

    return lines;
  }

  const overlay = overlayData();

  mazeLines.forEach((rawLine, index) => {
    const paddedLine = leftPad(rawLine, mazeIndent);
    const width = index === mazeLines.length - 1 ? contentWidth : Math.max(contentWidth, paddedLine.length);
    lines.push(renderMarkedLine(padLine(paddedLine, width)));
  });

  lines.push(renderTextLine(""));
  lines.push(
    renderTextLine(
      leftPad(joinColumns(getStatusPrompt(), `Scores: ${state.score}`, contentWidth), mazeIndent),
    ),
  );

  if (overlay.length > 0) {
    overlay.forEach((item) => {
      lines.push(renderTextLine(""));
      lines.push(
        renderTextLine(leftPad(centerText(contentWidth, item.text), mazeIndent), item.className),
      );
    });
  }

  return lines;
}

function render(): void {
  const screenLines = buildScreenLines();
  elements.screen.innerHTML = screenLines.map((line) => `<span class="line">${line}</span>`).join("");

  const statusMap: Record<GameStatus, string> = {
    boot: "Booting",
    running: "Running",
    paused: "Paused",
    won: "Round Clear",
    lost: "Time Up",
    quit: "Session Closed",
    "too-small": "Viewport Too Small",
  };

  elements.terminalStatus.textContent = statusMap[state.status];
  elements.hudLevel.textContent = String(state.level);
  elements.hudScore.textContent = String(state.score);
  elements.hudHighScore.textContent = String(state.highScore);
  elements.hudMode.textContent = getStatusPrompt();
}

function handleKeydown(event: KeyboardEvent): void {
  const key = event.key;
  const lowerKey = key.toLowerCase();
  const controlCombo = event.ctrlKey || event.metaKey;

  if (
    key.startsWith("Arrow") ||
    key === " " ||
    key === "Escape" ||
    (controlCombo && lowerKey === "p") ||
    (controlCombo && lowerKey === "c") ||
    key === "Enter"
  ) {
    event.preventDefault();
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

  if (action === "move-up") {
    movePlayer("UP");
  } else if (action === "move-left") {
    movePlayer("LEFT");
  } else if (action === "move-right") {
    movePlayer("RIGHT");
  } else if (action === "move-down") {
    movePlayer("DOWN");
  } else if (action === "pause") {
    pauseGame();
  } else if (action === "proceed") {
    resumeOrProceed();
  } else if (action === "quit") {
    quitGame();
  } else if (action === "restart") {
    restartGame();
  }
}

function handleResize(): void {
  render();

  if (state.status === "too-small") {
    const viewport = measureTerminal();
    const terminalSize = getTerminalSize(viewport.rows, viewport.cols);
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
