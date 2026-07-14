import { GameClock } from "./clock"
import {
  CONFIG,
  coreDecayIntervalPerCellMs,
  WALL_WEIGHTS,
} from "./config"
import { executeActionWithFeedback } from "./cmd-feedback"
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
  MazeAgentContext,
  CellCoordinate,
  Elements,
  GameRuntime,
  MazeAction,
  MazeActionControl,
  MazeActionDispatchOptions,
  MoveAction,
  PersistedRound,
  RenderGridPoint,
  State,
} from "./types"

const { maze, messages, runtime, scoring, timing } = CONFIG

const state: State = {
  controlMode: "interactive",
  level: 1,
  dims: null,
  maze: null,
  playerPosition: null,
  traversalHistory: [],
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
// activeControlMode keeps the currently mounted MazeActionControl so feedback and rebinding stay in sync.
let activeControlMode: MazeActionControl | null = null
let runtimeElements: Elements | null = null

const MOVE_DELTAS: Record<MoveAction, readonly [number, number]> = {
  MoveLeft: [0, -1],
  MoveRight: [0, 1],
  MoveUp: [-1, 0],
  MoveDown: [1, 0],
}

// activeCoreDecayIntervalPerCellMs resolves the current mode's per-cell timing budget.
function activeCoreDecayIntervalPerCellMs(): number {
  return coreDecayIntervalPerCellMs(state.controlMode)
}

// calculateScore converts elapsed time into the remaining score for a round.
function calculateScore(
  totalCells: number,
  elapsedMs: number,
  decayIntervalPerCellMs: number,
): number {
  const maxScore = totalCells * scoring.budgetMultiplier
  const elapsedPenalty = Math.floor(
    (elapsedMs * timing.scoreDecayRate) / decayIntervalPerCellMs,
  )

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
  const maxScore = totalCells * scoring.budgetMultiplier
  if (maxScore <= 0) {
    return 0
  }

  return Math.max(
    0,
    Math.min(
      scoring.retentionScale,
      Math.floor(
        (score * scoring.retentionScale + Math.floor(maxScore / 2)) / maxScore,
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
    (deltaRetention * levelDurationMs) / scoring.retentionScale,
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
      return messages.winSummary.noPrevious.newRecord
    }

    if (bestComparison === "matched-best") {
      return messages.winSummary.noPrevious.matchedBest
    }

    return messages.winSummary.noPrevious.behindBest
  }

  if (previousComparison === "faster") {
    if (bestComparison === "new-record") {
      return messages.winSummary.fasterPrevious.newRecord
    }

    if (bestComparison === "matched-best") {
      return messages.winSummary.fasterPrevious.matchedBest
    }

    return messages.winSummary.fasterPrevious.behindBest
  }

  if (previousComparison === "slower") {
    if (bestComparison === "new-record") {
      return messages.winSummary.slowerPrevious.newRecord
    }

    if (bestComparison === "matched-best") {
      return messages.winSummary.slowerPrevious.matchedBest
    }

    return messages.winSummary.slowerPrevious.behindBest
  }

  if (bestComparison === "new-record") {
    return messages.winSummary.matchedPrevious.newRecord
  }

  if (bestComparison === "matched-best") {
    return messages.winSummary.matchedPrevious.matchedBest
  }

  return messages.winSummary.matchedPrevious.behindBest
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

// positionsEqual compares two rendered maze-grid points without allocating helper objects.
function positionsEqual(left: RenderGridPoint, right: RenderGridPoint): boolean {
  return left.x === right.x && left.y === right.y
}

// cellCoordinateFromGridPoint converts one rendered maze-grid point into a logical cell position.
function cellCoordinateFromGridPoint(position: RenderGridPoint): CellCoordinate {
  return {
    row: Math.floor((position.y - 1) / maze.cellSpan),
    col: Math.floor((position.x - 1) / maze.cellSpan),
  }
}

// readAgentContext exposes the latest traversal snapshot so the agent can plan the next move.
function readAgentContext(): MazeAgentContext {
  return {
    currentCell: state.playerPosition
      ? cellCoordinateFromGridPoint(state.playerPosition)
      : null,
    destinationCell: state.finalPosition
      ? cellCoordinateFromGridPoint(state.finalPosition)
      : null,
    level: state.level,
    score: state.score,
    status: state.status,
    traversalHistory: state.traversalHistory.map(({ row, col }) => ({
      row,
      col,
    })),
  }
}

// gridPointFromCellCoordinate expands a logical cell position back into rendered maze-grid space.
function gridPointFromCellCoordinate(cell: CellCoordinate): RenderGridPoint {
  return {
    x: cell.col * maze.cellSpan + 1,
    y: cell.row * maze.cellSpan + 1,
  }
}

// mazeCellKey builds a stable string key for deduplicating logical maze cells.
function mazeCellKey(cell: CellCoordinate): string {
  return `${cell.row}:${cell.col}`
}

// traversalHistoryIncludes reports whether the ordered visit history already contains a cell.
function traversalHistoryIncludes(cell: CellCoordinate): boolean {
  return state.traversalHistory.some(
    (visitedCell) => mazeCellKey(visitedCell) === mazeCellKey(cell),
  )
}

// isCellCoordinate validates one persisted logical cell coordinate.
function isCellCoordinate(value: unknown): value is CellCoordinate {
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

// restoreClock reconstructs a live clock from persisted remaining time.
function restoreClock(
  totalCells: number,
  remainingMs: number,
  controlMode = state.controlMode,
): GameClock {
  // Round timing is derived from the shared per-cell cadence so score decay, persisted remaining
  // time, and any agent polling policy all reconstruct the same allowance after a reload.
  const totalDurationMs = totalCells * coreDecayIntervalPerCellMs(controlMode)
  const clampedRemainingMs = Math.max(0, Math.min(totalDurationMs, remainingMs))
  const clock = new GameClock(totalDurationMs)
  clock.startedAt = performance.now() - (totalDurationMs - clampedRemainingMs)
  return clock
}

// isTraversableGridPoint validates that a stored rendered point still lands on open path.
function isTraversableGridPoint(data: string[][], position: RenderGridPoint): boolean {
  const { x, y } = position
  if (y < 0 || y >= data.length) {
    return false
  }

  if (x < 0 || x >= data[y].length) {
    return false
  }

  return isSpaceFound(data[y][x])
}

// applyTooSmallState clears the active round when the viewport can no longer fit it.
function applyTooSmallState(level: number): void {
  state.status = "too-small"
  state.level = level
  state.dims = null
  state.maze = null
  state.playerPosition = null
  state.traversalHistory = []
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
    snapshot.version !== runtime.roundStorageVersion ||
    snapshot.level < 1 ||
    !isWallWeight(snapshot.wallWeight) ||
    snapshot.dims.length <= 0 ||
    snapshot.dims.width <= 0
  ) {
    return false
  }

  const expectedRows = maze.cellSpan * snapshot.dims.width + 1
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

  if (!isTraversableGridPoint(snapshot.maze, snapshot.playerPosition)) {
    return false
  }

  if (!isTraversableGridPoint(snapshot.maze, snapshot.finalPosition)) {
    return false
  }

  if (
    !isCellCoordinate(snapshot.startCell) ||
    !Array.isArray(snapshot.traversalHistory) ||
    snapshot.traversalHistory.length === 0
  ) {
    return false
  }

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
    !isCellCoordinate(firstVisitedCell) ||
    mazeCellKey(firstVisitedCell) !== mazeCellKey(snapshot.startCell)
  ) {
    return false
  }

  const visitedCellKeys = new Set<string>()
  for (const visitedCell of snapshot.traversalHistory) {
    if (!isCellCoordinate(visitedCell)) {
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
  }, timing.refreshInterval)
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
  state.playerPosition = {
    x: snapshot.playerPosition.x,
    y: snapshot.playerPosition.y,
  }
  state.traversalHistory = snapshot.traversalHistory.map(({ row, col }) => ({
    row,
    col,
  }))
  state.finalPosition = {
    x: snapshot.finalPosition.x,
    y: snapshot.finalPosition.y,
  }
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
  state.playerPosition = {
    x: round.startPosition.x,
    y: round.startPosition.y,
  }
  state.traversalHistory = [cellCoordinateFromGridPoint(round.startPosition)]
  state.finalPosition = {
    x: round.finalPosition.x,
    y: round.finalPosition.y,
  }
  state.status = "running"
  state.canResume = false
  state.lastRoundScore = 0
  state.winSummary = ""

  const totalCells = dimensions.length * dimensions.width
  // The round clock uses the shared per-cell cadence to set both the starting score window and the
  // maximum amount of playable time for this maze size.
  state.clock = new GameClock(totalCells * activeCoreDecayIntervalPerCellMs())
  state.score = calculateScore(totalCells, 0, activeCoreDecayIntervalPerCellMs())
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
    const decayIntervalPerCellMs = activeCoreDecayIntervalPerCellMs()
    const levelDurationMs = totalCells * decayIntervalPerCellMs
    state.score = calculateScore(totalCells, elapsedMs, decayIntervalPerCellMs)

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

  const x = state.playerPosition.x
  const y = state.playerPosition.y
  const nextY = y + rowDelta * maze.moveStep
  const nextX = x + columnDelta * maze.moveStep
  const probeY = y + rowDelta
  const probeX = x + columnDelta

  if (nextY <= 0 || nextY > state.dims.width * maze.cellSpan) {
    return
  }

  if (nextX <= 0 || nextX > state.dims.length * maze.cellSpan) {
    return
  }

  if (!isSpaceFound(state.maze[probeY][probeX])) {
    return
  }

  state.playerPosition.y = nextY
  state.playerPosition.x = nextX
  const nextCell = cellCoordinateFromGridPoint({ x: nextX, y: nextY })
  if (!traversalHistoryIncludes(nextCell)) {
    state.traversalHistory.push(nextCell)
  }

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
    state.score = calculateScore(
      totalCells,
      state.clock.elapsed(),
      activeCoreDecayIntervalPerCellMs(),
    )
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
  const nextScore = calculateScore(
    totalCells,
    state.clock.elapsed(),
    activeCoreDecayIntervalPerCellMs(),
  )
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
function executeCommand(action: MazeAction): void {
  switch (action.type) {
    case "MoveLeft":
    case "MoveRight":
    case "MoveUp":
    case "MoveDown":
      handleMove(action.type)
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

// dispatchControl routes one action and optionally returns command state.
function dispatchControl(
  action: MazeAction,
  options?: MazeActionDispatchOptions,
): ReturnType<typeof executeActionWithFeedback> | null {
  // Control modes translate their own input sources into semantic maze commands,
  // and the shared runtime resolves those commands here.
  if (!options?.wantFeedback) {
    executeCommand(action)
    return null
  }

  const actionState = executeActionWithFeedback(action, {
    executeCommand,
    state,
    handleMove,
  })
  if (actionState) {
    activeControlMode?.recordActionState(actionState)
  }
  return actionState
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
  // controlMode is the page-selected MazeActionControl that supplies the active input behavior.
  controlMode: MazeActionControl,
  elements: Elements,
): GameRuntime {
  runtimeElements = elements
  activeControlMode = controlMode

  state.controlMode = controlMode.name
  controlMode.bindActionDispatch(dispatchControl, readAgentContext)

  window.addEventListener("resize", handleResize)
  window.visualViewport?.addEventListener("resize", handleResize)
  window.addEventListener("pagehide", () => {
    persistStateNow()
  })
  window.setInterval(tick, timing.refreshInterval)

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

  if (controlMode.name === "interactive") {
    runtimeElements.app.focus()
  }

  return {
    mode: controlMode.name,
    dispatch: dispatchControl,
  }
}
