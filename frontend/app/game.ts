import { GameClock } from "./clock"
import { CONFIG, ROUND_STORAGE_VERSION, WALL_WEIGHTS } from "./config"
import { elements, getTerminalSize } from "./dom"
import {
  generateMaze,
  getMazeDimensions,
  isSpaceFound,
  isWallWeight,
  nextWallWeight,
  reweightMaze,
} from "./maze"
import { render } from "./render"
import {
  isFinishedStatus,
  isLostStatus,
  isPausedStatus,
  isRunningStatus,
  isTooSmallStatus,
  isWonStatus,
} from "./status"
import {
  clearPersistedSnapshot,
  clearPersistedRound,
  loadPersistedSnapshot,
  savePersistedPreferences,
  savePersistedRoundState,
} from "./storage"
import type { MoveAction, PersistedRound, Position, State } from "./types"

const state: State = {
  level: 1,
  dims: null,
  maze: null,
  playerPosition: null,
  finalPosition: null,
  status: "boot",
  score: 0,
  lastRoundScore: 0,
  lastAttemptMs: 0,
  bestWinMs: 0,
  winSummary: "",
  canResume: false,
  wallWeight: WALL_WEIGHTS[0],
  clock: null,
}

let scheduledRoundPersist: number | null = null
let lastBlinkVisible: boolean | null = null

const MOVE_DELTAS: Record<MoveAction, readonly [number, number]> = {
  MoveLeft: [0, -1],
  MoveRight: [0, 1],
  MoveUp: [-1, 0],
  MoveDown: [1, 0],
}

const KEY_TO_MOVE_ACTION: Partial<Record<string, MoveAction>> = {
  ArrowLeft: "MoveLeft",
  ArrowRight: "MoveRight",
  ArrowUp: "MoveUp",
  ArrowDown: "MoveDown",
}

function calculateScore(totalCells: number, elapsedMs: number): number {
  const maxScore = totalCells * CONFIG.scoreMultiplier
  const elapsedPenalty = Math.floor((elapsedMs * CONFIG.scoreMultiplier) / 1000)

  return Math.max(0, maxScore - elapsedPenalty)
}

type WinSummaryPreviousComparison = "none" | "faster" | "slower" | "matched"
type WinSummaryBestComparison = "new-record" | "matched-best" | "behind-best"

function formatWinSummaryDuration(durationMs: number): string {
  if (durationMs < 60_000) {
    return `${(durationMs / 1000).toFixed(2)}s`
  }

  if (durationMs < 3_600_000) {
    return `${(durationMs / 60_000).toFixed(2)}m`
  }

  return `${(durationMs / 3_600_000).toFixed(2)}h`
}

function compareWinSummaryPrevious(
  currentMs: number,
  lastAttemptMs: number,
): { comparison: WinSummaryPreviousComparison; delta: string } {
  if (lastAttemptMs <= 0) {
    return { comparison: "none", delta: "" }
  }

  if (currentMs < lastAttemptMs) {
    return {
      comparison: "faster",
      delta: formatWinSummaryDuration(lastAttemptMs - currentMs),
    }
  }

  if (currentMs > lastAttemptMs) {
    return {
      comparison: "slower",
      delta: formatWinSummaryDuration(currentMs - lastAttemptMs),
    }
  }

  return { comparison: "matched", delta: "" }
}

function compareWinSummaryBest(
  currentMs: number,
  bestWinMs: number,
): { comparison: WinSummaryBestComparison; delta: string } {
  if (bestWinMs <= 0 || currentMs < bestWinMs) {
    return { comparison: "new-record", delta: "" }
  }

  if (currentMs > bestWinMs) {
    return {
      comparison: "behind-best",
      delta: formatWinSummaryDuration(currentMs - bestWinMs),
    }
  }

  return { comparison: "matched-best", delta: "" }
}

function replaceWinSummaryDelta(
  template: string,
  delta: string,
  bestDelta = "",
): string {
  return template
    .replace("{delta}", delta)
    .replace("{bestDelta}", bestDelta)
}

function selectWinSummaryTemplate(
  previousComparison: WinSummaryPreviousComparison, bestComparison: WinSummaryBestComparison,
): string {
  if (previousComparison === "none") {
    if (bestComparison === "new-record") {
      return CONFIG.winNoPrevNewRecord
    }

    if (bestComparison === "matched-best") {
      return CONFIG.winNoPrevMatchedBest
    }

    return CONFIG.winNoPrevBehindBest
  }

  if (previousComparison === "faster") {
    if (bestComparison === "new-record") {
      return CONFIG.winFasterPrevNewRecord
    }

    if (bestComparison === "matched-best") {
      return CONFIG.winFasterPrevMatchedBest
    }

    return CONFIG.winFasterPrevBehindBest
  }

  if (previousComparison === "slower") {
    if (bestComparison === "new-record") {
      return CONFIG.winSlowerPrevNewRecord
    }

    if (bestComparison === "matched-best") {
      return CONFIG.winSlowerPrevMatchedBest
    }

    return CONFIG.winSlowerPrevBehindBest
  }

  if (bestComparison === "new-record") {
    return CONFIG.winMatchedPrevNewRecord
  }

  if (bestComparison === "matched-best") {
    return CONFIG.winMatchedPrevBest
  }

  return CONFIG.winMatchedPrevBehindBest
}

function buildWinSummary(
  currentMs: number,
  lastAttemptMs: number,
  bestWinMs: number,
): string {
  const previous = compareWinSummaryPrevious(currentMs, lastAttemptMs)
  const best = compareWinSummaryBest(currentMs, bestWinMs)
  const template = selectWinSummaryTemplate(
    previous.comparison,
    best.comparison,
  )

  return replaceWinSummaryDelta(template, previous.delta, best.delta)
}

function positionsEqual(left: Position, right: Position): boolean {
  return left[0] === right[0] && left[1] === right[1]
}

function restoreClock(totalCells: number, remainingMs: number): GameClock {
  const totalDurationMs = totalCells * 1000
  const clampedRemainingMs = Math.max(0, Math.min(totalDurationMs, remainingMs))
  const clock = new GameClock(totalDurationMs)
  clock.startedAt = performance.now() - (totalDurationMs - clampedRemainingMs)
  return clock
}

function isTraversablePosition(data: string[][], position: Position): boolean {
  const [row, column] = position
  if (row < 0 || row >= data.length) {
    return false
  }

  if (column < 0 || column >= data[row].length) {
    return false
  }

  return isSpaceFound(data[row][column])
}

function applyTooSmallState(level: number): void {
  state.status = "too-small"
  state.level = level
  state.dims = null
  state.maze = null
  state.playerPosition = null
  state.finalPosition = null
  state.score = 0
  state.lastRoundScore = 0
  state.winSummary = ""
  state.canResume = false
  state.clock = null
}

function isValidPersistedRound(snapshot: PersistedRound): boolean {
  if (
    snapshot.version !== ROUND_STORAGE_VERSION ||
    snapshot.level < 1 ||
    !isWallWeight(snapshot.wallWeight) ||
    snapshot.dims.length <= 0 ||
    snapshot.dims.width <= 0
  ) {
    return false
  }

  const expectedRows = CONFIG.cellSpan * snapshot.dims.width + 1
  const expectedColumns = snapshot.dims.length * 2 + 1
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

  if (!isTraversablePosition(snapshot.maze, snapshot.playerPosition)) {
    return false
  }

  if (!isTraversablePosition(snapshot.maze, snapshot.finalPosition)) {
    return false
  }

  return true
}

function persistedRoundFitsViewport(snapshot: PersistedRound): boolean {
  const terminalSize = getTerminalSize()
  return (
    snapshot.dims.length <= terminalSize.length &&
    snapshot.dims.width <= terminalSize.width
  )
}

function currentRoundFitsViewport(): boolean {
  if (!state.dims) {
    return true
  }

  const terminalSize = getTerminalSize()
  return (
    state.dims.length <= terminalSize.length &&
    state.dims.width <= terminalSize.width
  )
}

function cancelScheduledRoundPersist(): void {
  if (scheduledRoundPersist === null) {
    return
  }

  window.clearTimeout(scheduledRoundPersist)
  scheduledRoundPersist = null
}

function persistPreferences(): void {
  savePersistedPreferences(state)
}

function persistRoundNow(): void {
  cancelScheduledRoundPersist()
  savePersistedRoundState(state)
}

function persistStateNow(): void {
  persistPreferences()
  persistRoundNow()
}

function currentBlinkVisible(): boolean | null {
  if (!isRunningStatus(state.status) || !state.clock) {
    return null
  }

  return state.clock.blink()
}

function renderState(): void {
  lastBlinkVisible = currentBlinkVisible()
  render(elements, state)
}

function scheduleRoundPersistence(): void {
  cancelScheduledRoundPersist()
  scheduledRoundPersist = window.setTimeout(() => {
    scheduledRoundPersist = null
    savePersistedRoundState(state)
  }, CONFIG.refreshInterval)
}

function restorePersistedRound(snapshot: PersistedRound | null): boolean {
  if (!snapshot) {
    return false
  }

  if (!isValidPersistedRound(snapshot)) {
    clearPersistedRound()
    return false
  }

  if (!persistedRoundFitsViewport(snapshot)) {
    applyTooSmallState(snapshot.level)
    state.wallWeight = snapshot.wallWeight
    persistStateNow()
    renderState()
    return true
  }

  state.wallWeight = snapshot.wallWeight
  state.level = snapshot.level
  state.dims = { length: snapshot.dims.length, width: snapshot.dims.width }
  state.maze = snapshot.maze.map((row) => [...row])
  state.playerPosition = [
    snapshot.playerPosition[0],
    snapshot.playerPosition[1],
  ]
  state.finalPosition = [snapshot.finalPosition[0], snapshot.finalPosition[1]]
  state.score = snapshot.score
  state.lastRoundScore = snapshot.lastRoundScore
  state.winSummary = snapshot.winSummary ?? ""
  state.canResume = false

  if (isFinishedStatus(snapshot.status)) {
    state.status = snapshot.status
    state.clock = null
    renderState()
    return true
  }

  const totalCells = snapshot.dims.length * snapshot.dims.width
  state.clock = restoreClock(totalCells, snapshot.remainingMs)
  state.clock.pause()
  state.status = "paused"
  state.winSummary = ""
  state.canResume = true
  renderState()
  return true
}

function startRound(level: number, persist = true): void {
  const terminalSize = getTerminalSize()
  const dimensions = getMazeDimensions(level, terminalSize)

  if (!dimensions) {
    applyTooSmallState(level)
    if (persist) {
      persistStateNow()
    }
    renderState()
    return
  }

  const round = generateMaze(dimensions, state.wallWeight)

  state.level = dimensions.level
  state.dims = { length: dimensions.length, width: dimensions.width }
  state.maze = round.maze
  state.playerPosition = [round.startPosition[0], round.startPosition[1]]
  state.finalPosition = [round.finalPosition[0], round.finalPosition[1]]
  state.status = "running"
  state.canResume = false
  state.lastRoundScore = 0
  state.winSummary = ""

  const totalCells = dimensions.length * dimensions.width
  state.clock = new GameClock(totalCells * 1000)
  state.score = calculateScore(totalCells, 0)
  if (persist) {
    persistStateNow()
  }
  renderState()
}

function restartGame(): void {
  cancelScheduledRoundPersist()
  clearPersistedSnapshot()
  state.wallWeight = WALL_WEIGHTS[0]
  state.lastAttemptMs = 0
  state.bestWinMs = 0
  state.lastRoundScore = 0
  state.winSummary = ""
  startRound(1, false)
}

function resumeOrProceed(): void {
  if (isPausedStatus(state.status) && state.canResume && state.clock) {
    state.clock.resume()
    state.status = "running"
    state.canResume = false
    persistRoundNow()
    renderState()
    return
  }

  if (isWonStatus(state.status)) {
    startRound(state.level + 1)
    return
  }

  if (isLostStatus(state.status)) {
    startRound(state.level)
    return
  }
}

function pauseGame(): void {
  if (!isRunningStatus(state.status) || !state.clock) {
    return
  }

  state.clock.pause()
  state.status = "paused"
  state.canResume = true
  persistStateNow()
  renderState()
}

function cycleWallWeight(): void {
  const nextWeight = nextWallWeight(state.wallWeight)

  if (state.maze) {
    state.maze = reweightMaze(state.maze, state.wallWeight)
  }

  state.wallWeight = nextWeight
  persistStateNow()
  renderState()
}

function handleWinCheck(): boolean {
  if (state.clock && state.dims) {
    const totalCells = state.dims.length * state.dims.width
    const elapsedMs = state.clock.elapsed()
    state.score = calculateScore(totalCells, elapsedMs)

    if (
      state.playerPosition &&
      state.finalPosition &&
      positionsEqual(state.playerPosition, state.finalPosition)
    ) {
      state.winSummary = buildWinSummary(
        elapsedMs,
        state.lastAttemptMs,
        state.bestWinMs,
      )
      state.lastAttemptMs = elapsedMs
      state.bestWinMs =
        state.bestWinMs <= 0 || elapsedMs < state.bestWinMs
          ? elapsedMs
          : state.bestWinMs
    }
  }

  if (
    !state.playerPosition ||
    !state.finalPosition ||
    !positionsEqual(state.playerPosition, state.finalPosition)
  ) {
    return false
  }

  state.status = "won"
  state.canResume = false
  state.lastRoundScore = state.score
  return true
}

function movePlayer(rowDelta: number, columnDelta: number): void {
  if (
    !isRunningStatus(state.status) ||
    !state.maze ||
    !state.dims ||
    !state.playerPosition
  ) {
    return
  }

  const row = state.playerPosition[0]
  const column = state.playerPosition[1]
  const nextRow = row + rowDelta * CONFIG.moveStep
  const nextColumn = column + columnDelta * CONFIG.moveStep
  const probeRow = row + rowDelta
  const probeColumn = column + columnDelta

  if (nextRow <= 0 || nextRow > state.dims.width * CONFIG.cellSpan) {
    return
  }

  if (nextColumn <= 0 || nextColumn > state.dims.length * CONFIG.cellSpan) {
    return
  }

  if (!isSpaceFound(state.maze[probeRow][probeColumn])) {
    return
  }

  state.playerPosition[0] = nextRow
  state.playerPosition[1] = nextColumn

  if (handleWinCheck()) {
    persistStateNow()
  } else {
    scheduleRoundPersistence()
  }
  renderState()
}

function handleLoss(): void {
  if (!isRunningStatus(state.status) || !state.dims) {
    return
  }

  if (state.clock) {
    const totalCells = state.dims.length * state.dims.width
    state.score = calculateScore(totalCells, state.clock.elapsed())
  }

  state.status = "lost"
  state.canResume = false
  state.lastRoundScore = state.score
  state.lastAttemptMs = state.dims.length * state.dims.width * 1000
  state.winSummary = ""
  persistStateNow()
  renderState()
}

function tick(): void {
  if (!isRunningStatus(state.status) || !state.clock || !state.dims) {
    return
  }

  const totalCells = state.dims.length * state.dims.width
  const nextScore = calculateScore(totalCells, state.clock.elapsed())
  const remainingMs = state.clock.remaining()
  const nextBlinkVisible = state.clock.blink()
  const scoreChanged = nextScore !== state.score
  const blinkChanged = nextBlinkVisible !== lastBlinkVisible
  state.score = nextScore

  if (remainingMs <= 0) {
    handleLoss()
    return
  }

  if (scoreChanged || blinkChanged) {
    renderState()
  }
}

function handleMove(action: MoveAction): void {
  const [rowDelta, columnDelta] = MOVE_DELTAS[action]
  movePlayer(rowDelta, columnDelta)
}

function handleKeydown(event: KeyboardEvent): void {
  const key = event.key
  const lowerKey = key.toLowerCase()
  const controlCombo = event.ctrlKey || event.metaKey
  const moveAction = KEY_TO_MOVE_ACTION[key]

  if (
    moveAction ||
    key === " " ||
    key === "Enter" ||
    (controlCombo && lowerKey === "b") ||
    (controlCombo && lowerKey === "p")
  ) {
    event.preventDefault()
  }

  if (controlCombo && lowerKey === "b") {
    cycleWallWeight()
    return
  }

  if (controlCombo && lowerKey === "p") {
    resumeOrProceed()
    return
  }

  if (
    key === "Enter" &&
    (isPausedStatus(state.status) ||
      isWonStatus(state.status) ||
      isLostStatus(state.status))
  ) {
    resumeOrProceed()
    return
  }

  if (key === " ") {
    pauseGame()
    return
  }

  if (moveAction) {
    handleMove(moveAction)
  }
}

function handleAction(action: string): void {
  elements.app.focus()

  if (action === "restart") {
    restartGame()
    return
  }

  if (action === "pause") {
    pauseGame()
    return
  }

  if (action === "walls") {
    cycleWallWeight()
    return
  }

  if (action === "proceed") {
    resumeOrProceed()
    return
  }
}

function handleResize(): void {
  if (!isTooSmallStatus(state.status) && !currentRoundFitsViewport()) {
    applyTooSmallState(state.level)
    persistStateNow()
  }

  if (isTooSmallStatus(state.status)) {
    if (
      restorePersistedRound(
        loadPersistedSnapshot(1, WALL_WEIGHTS[0], isWallWeight).round,
      )
    ) {
      return
    }
  }

  renderState()
}

export function bootstrapGame(): void {
  elements.controls.forEach((button) => {
    button.addEventListener("click", () => {
      handleAction(button.dataset.action || "")
    })
  })

  elements.touchButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const move = button.dataset.move
      if (move) {
        handleMove(move as MoveAction)
        return
      }

      handleAction(button.dataset.action || "")
    })
  })

  window.addEventListener("keydown", handleKeydown, { passive: false })
  window.addEventListener("resize", handleResize)
  window.visualViewport?.addEventListener("resize", handleResize)
  window.addEventListener("pagehide", () => {
    persistStateNow()
  })
  window.setInterval(tick, CONFIG.refreshInterval)

  elements.app.addEventListener("click", () => {
    elements.app.focus()
  })

  const persistedSnapshot = loadPersistedSnapshot(
    1,
    WALL_WEIGHTS[0],
    isWallWeight,
  )
  state.wallWeight = persistedSnapshot.preferences.wallWeight
  state.level = persistedSnapshot.preferences.level
  state.lastAttemptMs = persistedSnapshot.preferences.lastAttemptMs ?? 0
  state.bestWinMs = persistedSnapshot.preferences.bestWinMs ?? 0

  if (!restorePersistedRound(persistedSnapshot.round)) {
    startRound(state.level)
  }

  elements.app.focus()
}
