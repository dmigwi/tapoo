import { GameClock } from "./clock";
import { CONFIG, ROUND_STORAGE_VERSION, WALL_WEIGHTS } from "./config";
import { applyInputMode, detectInputMode, elements, getTerminalSize } from "./dom";
import {
  generateMaze, getMazeDimensions, isSpaceFound, isWallWeight, nextWallWeight, reweightMaze, 
} from "./maze";
import { render } from "./render";
import {
  clearPersistedRound, loadPersistedSnapshot, savePersistedPreferences, savePersistedRoundState,
} from "./storage";
import type { PersistedRound, Position, State } from "./types";

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
  wallWeight: WALL_WEIGHTS[0],
  clock: null,
  inputMode: "keyboard",
};

let scheduledRoundPersist: number | null = null;

function calculateScore(totalCells: number, elapsedMs: number): number {
  return Math.max(0, totalCells - Math.floor(elapsedMs / 1000)) * CONFIG.scoreMultiplier;
}

function positionsEqual(left: Position, right: Position): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

function restoreClock(totalCells: number, remainingMs: number): GameClock {
  const totalDurationMs = totalCells * 1000;
  const clampedRemainingMs = Math.max(0, Math.min(totalDurationMs, remainingMs));
  const clock = new GameClock(totalDurationMs);
  clock.startedAt = performance.now() - (totalDurationMs - clampedRemainingMs);
  return clock;
}

function isTraversablePosition(data: string[][], position: Position): boolean {
  const [row, column] = position;
  if (row < 0 || row >= data.length) {
    return false;
  }

  if (column < 0 || column >= data[row].length) {
    return false;
  }

  return isSpaceFound(data[row][column]);
}

function applyTooSmallState(level: number): void {
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
}

function isValidPersistedRound(snapshot: PersistedRound): boolean {
  if (
    snapshot.version !== ROUND_STORAGE_VERSION ||
    snapshot.level < 1 ||
    !isWallWeight(snapshot.wallWeight) ||
    snapshot.dims.length <= 0 ||
    snapshot.dims.width <= 0
  ) {
    return false;
  }

  const expectedRows = CONFIG.cellSpan * snapshot.dims.width + 1;
  const expectedColumns = snapshot.dims.length * 2 + 1;
  if (snapshot.maze.length !== expectedRows) {
    return false;
  }

  if (!snapshot.maze.every((row) => Array.isArray(row) && row.length === expectedColumns)) {
    return false;
  }

  if (!isTraversablePosition(snapshot.maze, snapshot.playerPosition)) {
    return false;
  }

  if (!isTraversablePosition(snapshot.maze, snapshot.finalPosition)) {
    return false;
  }

  return true;
}

function persistedRoundFitsViewport(snapshot: PersistedRound): boolean {
  const terminalSize = getTerminalSize();
  return snapshot.dims.length <= terminalSize.length && snapshot.dims.width <= terminalSize.width;
}

function currentRoundFitsViewport(): boolean {
  if (!state.dims) {
    return true;
  }

  const terminalSize = getTerminalSize();
  return state.dims.length <= terminalSize.length && state.dims.width <= terminalSize.width;
}

function syncInputMode(): boolean {
  const nextMode = detectInputMode();
  const changed = state.inputMode !== nextMode;

  state.inputMode = nextMode;
  applyInputMode(nextMode);
  return changed;
}

function cancelScheduledRoundPersist(): void {
  if (scheduledRoundPersist === null) {
    return;
  }

  window.clearTimeout(scheduledRoundPersist);
  scheduledRoundPersist = null;
}

function persistPreferences(): void {
  savePersistedPreferences(state);
}

function persistRoundNow(): void {
  cancelScheduledRoundPersist();
  savePersistedRoundState(state);
}

function persistStateNow(): void {
  persistPreferences();
  persistRoundNow();
}

function scheduleRoundPersistence(): void {
  cancelScheduledRoundPersist();
  scheduledRoundPersist = window.setTimeout(() => {
    scheduledRoundPersist = null;
    savePersistedRoundState(state);
  }, CONFIG.refreshInterval);
}

function restorePersistedRound(snapshot: PersistedRound | null): boolean {
  if (!snapshot) {
    return false;
  }

  if (!isValidPersistedRound(snapshot)) {
    clearPersistedRound();
    return false;
  }

  if (!persistedRoundFitsViewport(snapshot)) {
    applyTooSmallState(snapshot.level);
    state.wallWeight = snapshot.wallWeight;
    persistStateNow();
    render(elements, state);
    return true;
  }

  state.wallWeight = snapshot.wallWeight;
  state.level = snapshot.level;
  state.dims = { length: snapshot.dims.length, width: snapshot.dims.width };
  state.maze = snapshot.maze.map((row) => [...row]);
  state.playerPosition = [snapshot.playerPosition[0], snapshot.playerPosition[1]];
  state.finalPosition = [snapshot.finalPosition[0], snapshot.finalPosition[1]];
  state.score = snapshot.score;
  state.lastRoundScore = snapshot.lastRoundScore;
  state.canResume = false;

  if (snapshot.status === "won" || snapshot.status === "lost") {
    state.status = snapshot.status;
    state.clock = null;
    render(elements, state);
    return true;
  }

  const totalCells = snapshot.dims.length * snapshot.dims.width;
  state.clock = restoreClock(totalCells, snapshot.remainingMs);
  state.clock.pause();
  state.status = "paused";
  state.canResume = true;
  render(elements, state);
  return true;
}

function startRound(level: number): void {
  const terminalSize = getTerminalSize();
  const dimensions = getMazeDimensions(level, terminalSize);

  if (!dimensions) {
    applyTooSmallState(level);
    persistStateNow();
    render(elements, state);
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
  persistStateNow();
  render(elements, state);
}

function restartGame(): void {
  const snapshot = loadPersistedSnapshot(1, WALL_WEIGHTS[0], isWallWeight);
  state.wallWeight = snapshot.preferences.wallWeight;
  startRound(snapshot.preferences.level);
}

function resumeOrProceed(): void {
  if (state.status === "paused" && state.canResume && state.clock) {
    state.clock.resume();
    state.status = "running";
    state.canResume = false;
    persistRoundNow();
    render(elements, state);
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
  persistStateNow();
  render(elements, state);
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
  clearPersistedRound();
  persistStateNow();
  render(elements, state);
}

function cycleWallWeight(): void {
  const nextWeight = nextWallWeight(state.wallWeight);

  if (state.maze) {
    state.maze = reweightMaze(state.maze, state.wallWeight);
  }

  state.wallWeight = nextWeight;
  persistStateNow();
  render(elements, state);
}

function handleWinCheck(): boolean {
  if (state.clock && state.dims) {
    const totalCells = state.dims.length * state.dims.width;
    state.score = calculateScore(totalCells, state.clock.elapsed());
  }

  if (!state.playerPosition || !state.finalPosition || !positionsEqual(state.playerPosition, state.finalPosition)) {
    return false;
  }

  state.status = "won";
  state.canResume = false;
  state.lastRoundScore = state.score;
  return true;
}

function movePlayer(rowDelta: number, columnDelta: number): void {
  if (state.status !== "running" || !state.maze || !state.dims || !state.playerPosition) {
    return;
  }

  const row = state.playerPosition[0];
  const column = state.playerPosition[1];
  const nextRow = row + rowDelta * CONFIG.moveStep;
  const nextColumn = column + columnDelta * CONFIG.moveStep;
  const probeRow = row + rowDelta;
  const probeColumn = column + columnDelta;

  if (nextRow <= 0 || nextRow > state.dims.width * CONFIG.cellSpan) {
    return;
  }

  if (nextColumn <= 0 || nextColumn > state.dims.length * CONFIG.cellSpan) {
    return;
  }

  if (!isSpaceFound(state.maze[probeRow][probeColumn])) {
    return;
  }

  state.playerPosition[0] = nextRow;
  state.playerPosition[1] = nextColumn;

  if (handleWinCheck()) {
    persistStateNow();
  } else {
    scheduleRoundPersistence();
  }
  render(elements, state);
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
  persistStateNow();
  render(elements, state);
}

function tick(): void {
  if (state.status !== "running" || !state.clock || !state.dims) {
    return;
  }

  const totalCells = state.dims.length * state.dims.width;
  const nextScore = calculateScore(totalCells, state.clock.elapsed());
  const remainingMs = state.clock.remaining();
  const scoreChanged = nextScore !== state.score;
  state.score = nextScore;

  if (remainingMs <= 0) {
    handleLoss();
    return;
  }

  if (scoreChanged) {
    render(elements, state);
  }
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
    movePlayer(0, -1);
  } else if (key === "ArrowRight") {
    movePlayer(0, 1);
  } else if (key === "ArrowUp") {
    movePlayer(-1, 0);
  } else if (key === "ArrowDown") {
    movePlayer(1, 0);
  }
}

function handleMove(direction: string): void {
  if (direction === "left") {
    movePlayer(0, -1);
    return;
  }

  if (direction === "right") {
    movePlayer(0, 1);
    return;
  }

  if (direction === "up") {
    movePlayer(-1, 0);
    return;
  }

  if (direction === "down") {
    movePlayer(1, 0);
  }
}

function handleAction(action: string): void {
  elements.app.focus();

  if (action === "restart") {
    restartGame();
    return;
  }

  if (action === "pause") {
    pauseGame();
    return;
  }

  if (action === "walls") {
    cycleWallWeight();
    return;
  }

  if (action === "proceed") {
    resumeOrProceed();
    return;
  }

  if (action === "quit") {
    quitGame();
  }
}

function handleResize(): void {
  syncInputMode();

  if (state.status !== "too-small" && !currentRoundFitsViewport()) {
    applyTooSmallState(state.level);
    persistStateNow();
  }

  if (state.status === "too-small") {
    if (restorePersistedRound(loadPersistedSnapshot(1, WALL_WEIGHTS[0], isWallWeight).round)) {
      return;
    }

    const terminalSize = getTerminalSize();
    if (getMazeDimensions(state.level, terminalSize)) {
      restartGame();
      return;
    }
  }

  render(elements, state);
}

export function bootstrapGame(): void {
  syncInputMode();

  elements.controls.forEach((button) => {
    button.addEventListener("click", () => {
      handleAction(button.dataset.action || "");
    });
  });

  elements.touchButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const move = button.dataset.move;
      if (move) {
        handleMove(move);
        return;
      }

      handleAction(button.dataset.action || "");
    });
  });

  window.addEventListener("keydown", handleKeydown, { passive: false });
  window.addEventListener("resize", handleResize);
  window.addEventListener("pagehide", () => {
    persistStateNow();
  });
  window.setInterval(tick, CONFIG.refreshInterval);

  elements.app.addEventListener("click", () => {
    elements.app.focus();
  });

  const persistedSnapshot = loadPersistedSnapshot(1, WALL_WEIGHTS[0], isWallWeight);
  state.wallWeight = persistedSnapshot.preferences.wallWeight;
  state.level = persistedSnapshot.preferences.level;

  if (!restorePersistedRound(persistedSnapshot.round)) {
    startRound(state.level);
  }

  elements.app.focus();
}
