import { GameClock } from "./clock"
import { CONFIG, ROUND_STORAGE_VERSION, WALL_WEIGHTS } from "./config"
import { executeCommandWithFeedback } from "./cmd-feedback"
import { getTerminalSize } from "./dom"
import {
  generateMaze,
  getMazeDimensions,
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
import { isSpaceFound, isWallWeight, nextWallWeight, reweightMaze } from "./traversal"
import type {
  Elements,
  GameRuntime,
  MazeControlCommand,
  MazeControlMode,
  MoveAction,
  PersistedRound,
  Position,
  State,
} from "./types"

const state: State = {
  controlMode: "keyboard",
  level: 1,
  dims: null,
  maze: null,
  playerPosition: null,
  finalPosition: null,
  status: "boot",
  score: 0,
  lastRoundScore: 0,
  lastAttemptRetention: null,
  bestWinRetention: null,
  winSummary: "",
  canResume: false,
  wallWeight: WALL_WEIGHTS[0],
  clock: null,
}

let scheduledRoundPersist: number | null = null
let lastBlinkVisible: boolean | null = null
let activeControlMode: MazeControlMode | null = null
let runtimeElements: Elements | null = null

const MOVE_DELTAS: Record<MoveAction, readonly [number, number]> = {
  MoveLeft: [0, -1],
  MoveRight: [0, 1],
  MoveUp: [-1, 0],
  MoveDown: [1, 0],
}

// calculateScore converts elapsed time into the remaining score for a round.
function calculateScore(totalCells: number, elapsedMs: number): number {
  const maxScore = totalCells * CONFIG.scoreMultiplier
  const elapsedPenalty = Math.floor((elapsedMs * CONFIG.scoreMultiplier) / 1000)

  return Math.max(0, maxScore - elapsedPenalty)
}

type WinSummaryPreviousComparison = "none" | "faster" | "slower" | "matched"
type WinSummaryBestComparison = "new-record" | "matched-best" | "behind-best"

// formatWinSummaryDuration renders elapsed deltas with compact time units.
function formatWinSummaryDuration(durationMs: number): string {
  if (durationMs < 60_000) {
    return `${(durationMs / 1000).toFixed(2)}s`
  }

  if (durationMs < 3_600_000) {
    return `${(durationMs / 60_000).toFixed(2)}m`
  }

  return `${(durationMs / 3_600_000).toFixed(2)}h`
}

// calculateScoreRetention normalizes a score into the retained percentage scale.
function calculateScoreRetention(totalCells: number, score: number): number {
  const maxScore = totalCells * CONFIG.scoreMultiplier
  if (maxScore <= 0) {
    return 0
  }

  return Math.max(
    0,
    Math.min(
      CONFIG.retentionScale,
      Math.floor(
        (score * CONFIG.retentionScale + Math.floor(maxScore / 2)) / maxScore,
      ),
    ),
  )
}

// formatWinSummaryRetentionDelta projects retention differences back into time.
function formatWinSummaryRetentionDelta(
  deltaRetention: number,
  levelDurationMs: number,
): string {
  const deltaMs = Math.round(
    (deltaRetention * levelDurationMs) / CONFIG.retentionScale,
  )
  return formatWinSummaryDuration(deltaMs)
}

// compareWinSummaryPrevious compares the current win against the last attempt.
function compareWinSummaryPrevious(
  currentRetention: number,
  lastAttemptRetention: number | null,
  levelDurationMs: number,
): { comparison: WinSummaryPreviousComparison; delta: string } {
  if (lastAttemptRetention === null) {
    return { comparison: "none", delta: "" }
  }

  if (currentRetention > lastAttemptRetention) {
    return {
      comparison: "faster",
      delta: formatWinSummaryRetentionDelta(
        currentRetention - lastAttemptRetention,
        levelDurationMs,
      ),
    }
  }

  if (currentRetention < lastAttemptRetention) {
    return {
      comparison: "slower",
      delta: formatWinSummaryRetentionDelta(
        lastAttemptRetention - currentRetention,
        levelDurationMs,
      ),
    }
  }

  return { comparison: "matched", delta: "" }
}

// compareWinSummaryBest compares the current win against the best retained score.
function compareWinSummaryBest(
  currentRetention: number,
  bestWinRetention: number | null,
  levelDurationMs: number,
): { comparison: WinSummaryBestComparison; delta: string } {
  if (bestWinRetention === null || currentRetention > bestWinRetention) {
    return { comparison: "new-record", delta: "" }
  }

  if (currentRetention < bestWinRetention) {
    return {
      comparison: "behind-best",
      delta: formatWinSummaryRetentionDelta(
        bestWinRetention - currentRetention,
        levelDurationMs,
      ),
    }
  }

  return { comparison: "matched-best", delta: "" }
}

// replaceWinSummaryDelta fills the selected summary template with its deltas.
function replaceWinSummaryDelta(
  template: string,
  delta: string,
  bestDelta = "",
): string {
  return template
    .replace("{delta}", delta)
    .replace("{bestDelta}", bestDelta)
}

// selectWinSummaryTemplate picks the right summary copy for the comparison result.
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

// buildWinSummary assembles the final retention summary shown after a win.
function buildWinSummary(
  currentRetention: number,
  lastAttemptRetention: number | null,
  bestWinRetention: number | null,
  levelDurationMs: number,
): string {
  const previous = compareWinSummaryPrevious(
    currentRetention,
    lastAttemptRetention,
    levelDurationMs,
  )
  const best = compareWinSummaryBest(
    currentRetention,
    bestWinRetention,
    levelDurationMs,
  )
  const template = selectWinSummaryTemplate(
    previous.comparison,
    best.comparison,
  )

  return replaceWinSummaryDelta(template, previous.delta, best.delta)
}

// positionsEqual compares two maze coordinates without allocating helper objects.
function positionsEqual(left: Position, right: Position): boolean {
  return left[0] === right[0] && left[1] === right[1]
}

// restoreClock reconstructs a live clock from persisted remaining time.
function restoreClock(totalCells: number, remainingMs: number): GameClock {
  const totalDurationMs = totalCells * 1000
  const clampedRemainingMs = Math.max(0, Math.min(totalDurationMs, remainingMs))
  const clock = new GameClock(totalDurationMs)
  clock.startedAt = performance.now() - (totalDurationMs - clampedRemainingMs)
  return clock
}

// isTraversablePosition validates that a stored position still lands on open path.
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

// applyTooSmallState clears the active round when the viewport can no longer fit it.
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

// isValidPersistedRound verifies that a restored round is internally consistent.
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

// persistedRoundFitsViewport checks whether a saved round still fits the viewport.
function persistedRoundFitsViewport(snapshot: PersistedRound): boolean {
  if (!runtimeElements) {
    return false
  }

  const terminalSize = getTerminalSize(runtimeElements)
  return (
    snapshot.dims.length <= terminalSize.length &&
    snapshot.dims.width <= terminalSize.width
  )
}

// currentRoundFitsViewport checks the live round against the current viewport.
function currentRoundFitsViewport(): boolean {
  if (!state.dims) {
    return true
  }

  if (!runtimeElements) {
    return false
  }

  const terminalSize = getTerminalSize(runtimeElements)
  return (
    state.dims.length <= terminalSize.length &&
    state.dims.width <= terminalSize.width
  )
}

// cancelScheduledRoundPersist stops any deferred round persistence job.
function cancelScheduledRoundPersist(): void {
  if (scheduledRoundPersist === null) {
    return
  }

  window.clearTimeout(scheduledRoundPersist)
  scheduledRoundPersist = null
}

// persistPreferences stores the long-lived level and wall-weight preferences.
function persistPreferences(): void {
  savePersistedPreferences(state)
}

// persistRoundNow flushes the current round snapshot immediately.
function persistRoundNow(): void {
  cancelScheduledRoundPersist()
  savePersistedRoundState(state)
}

// persistStateNow saves both preferences and the live round in one step.
function persistStateNow(): void {
  persistPreferences()
  persistRoundNow()
}

// currentBlinkVisible exposes the current destination blink state for rendering.
function currentBlinkVisible(): boolean | null {
  if (!isRunningStatus(state.status) || !state.clock) {
    return null
  }

  return state.clock.blink()
}

// renderState pushes the current game state into the terminal-like renderer.
function renderState(): void {
  if (!runtimeElements) {
    return
  }

  lastBlinkVisible = currentBlinkVisible()
  render(runtimeElements, state)
}

// scheduleRoundPersistence batches non-terminal round updates behind the refresh cadence.
function scheduleRoundPersistence(): void {
  cancelScheduledRoundPersist()
  scheduledRoundPersist = window.setTimeout(() => {
    scheduledRoundPersist = null
    savePersistedRoundState(state)
  }, CONFIG.refreshInterval)
}

// restorePersistedRound rebuilds a saved round or falls back when it is invalid.
function restorePersistedRound(snapshot: PersistedRound | null): boolean {
  if (!runtimeElements) {
    return false
  }

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

// startRound generates and initializes a fresh round for the requested level.
function startRound(level: number, persist = true): void {
  if (!runtimeElements) {
    return
  }

  const terminalSize = getTerminalSize(runtimeElements)
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

// restartGame clears persisted progress and restarts from level one.
function restartGame(): void {
  cancelScheduledRoundPersist()
  clearPersistedSnapshot()
  state.wallWeight = WALL_WEIGHTS[0]
  state.lastAttemptRetention = null
  state.bestWinRetention = null
  state.lastRoundScore = 0
  state.winSummary = ""
  startRound(1, false)
}

// resumeOrProceed resumes a pause or advances from a finished round.
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

// pauseGame freezes the current round while preserving it for resume.
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

// cycleWallWeight swaps the live maze walls to the next supported weight.
function cycleWallWeight(): void {
  const nextWeight = nextWallWeight(state.wallWeight)

  if (state.maze) {
    state.maze = reweightMaze(state.maze, state.wallWeight)
  }

  state.wallWeight = nextWeight
  persistStateNow()
  renderState()
}

// handleWinCheck updates retention metrics and finalizes the round after a win.
function handleWinCheck(): boolean {
  if (state.clock && state.dims) {
    const totalCells = state.dims.length * state.dims.width
    const elapsedMs = state.clock.elapsed()
    const levelDurationMs = totalCells * 1000
    state.score = calculateScore(totalCells, elapsedMs)

    if (
      state.playerPosition &&
      state.finalPosition &&
      positionsEqual(state.playerPosition, state.finalPosition)
    ) {
      const currentRetention = calculateScoreRetention(totalCells, state.score)
      state.winSummary = buildWinSummary(
        currentRetention,
        state.lastAttemptRetention,
        state.bestWinRetention,
        levelDurationMs,
      )
      state.lastAttemptRetention = currentRetention
      state.bestWinRetention =
        state.bestWinRetention === null ||
        currentRetention > state.bestWinRetention
          ? currentRetention
          : state.bestWinRetention
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

// movePlayer applies one move step and persists the updated round state.
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

// handleLoss finalizes the round when the timer has fully expired.
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
  state.lastAttemptRetention = 0
  state.winSummary = ""
  persistStateNow()
  renderState()
}

// tick advances score decay and blink state on the shared refresh cadence.
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

// handleMove converts a semantic move into row and column deltas.
function handleMove(action: MoveAction): void {
  const [rowDelta, columnDelta] = MOVE_DELTAS[action]
  movePlayer(rowDelta, columnDelta)
}

// executeCommand runs one semantic control command without building feedback.
function executeCommand(command: MazeControlCommand): void {
  switch (command.type) {
    case "move":
      handleMove(command.move)
      return
    case "pause":
      pauseGame()
      return
    case "proceed":
      resumeOrProceed()
      return
    case "cycle-walls":
      cycleWallWeight()
      return
    case "restart":
      restartGame()
      return
  }
}

// dispatchControl routes a command through the plain or feedback-aware path.
function dispatchControl(command: MazeControlCommand): void {
  // Control modes translate their own input sources into semantic maze commands,
  // and the shared runtime resolves those commands here.
  if (!activeControlMode?.expectsCommandFeedback()) {
    executeCommand(command)
    return
  }

  activeControlMode.receiveCommandFeedback(
    executeCommandWithFeedback(command, {
      state,
      handleMove,
      pauseGame,
      resumeOrProceed,
      cycleWallWeight,
      restartGame,
    }),
  )
}

// handleResize revalidates the active or persisted round against the viewport.
function handleResize(): void {
  if (!runtimeElements) {
    return
  }

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

// bootstrapGame wires the runtime, restores persistence, and starts the first render.
export function bootstrapGame(
  controlMode: MazeControlMode,
  elements: Elements,
): GameRuntime {
  runtimeElements = elements
  activeControlMode = controlMode

  state.controlMode = controlMode.name
  controlMode.attach(dispatchControl)

  window.addEventListener("resize", handleResize)
  window.visualViewport?.addEventListener("resize", handleResize)
  window.addEventListener("pagehide", () => {
    persistStateNow()
  })
  window.setInterval(tick, CONFIG.refreshInterval)

  const persistedSnapshot = loadPersistedSnapshot(
    1,
    WALL_WEIGHTS[0],
    isWallWeight,
  )
  state.wallWeight = persistedSnapshot.preferences.wallWeight
  state.level = persistedSnapshot.preferences.level
  state.lastAttemptRetention =
    persistedSnapshot.preferences.lastAttemptRetention ?? null
  state.bestWinRetention =
    persistedSnapshot.preferences.bestWinRetention ?? null

  if (!restorePersistedRound(persistedSnapshot.round)) {
    startRound(state.level)
  }

  if (controlMode.name === "keyboard") {
    runtimeElements.app.focus()
  }

  return {
    mode: controlMode.name,
    dispatch: dispatchControl,
  }
}
