import { GameClock } from "./clock"
import {
  CONFIG,
  WALL_WEIGHTS,
} from "./config"
import { buildMazeActionState, executeActionWithFeedback } from "./agent-context"
import { getTerminalSize } from "./dom"
import {
  generateMaze,
  getMazeDimensions,
} from "./maze"
import { render } from "./render"
import {
  isFinishedStatus,
  isAwaitAgentStatus,
  isLostStatus,
  isPausedStatus,
  isRunningStatus,
  isTooSmallStatus,
  isWonStatus,
  viewportFitStatus,
} from "./status"
import {
  clearPersistedSnapshot,
  clearPersistedRound,
  loadPersistedSnapshot,
  saveGameProgress,
  saveActiveRoundSnapshot,
} from "./storage"
import {
  cellCoordinateFromGridPoint,
  gridPointFromCellCoordinate,
  isSpaceFound,
  isWallWeight,
  mazeCellKey,
  nextWallWeight,
  resolvePlayerMove,
  reweightMaze,
  traversalHistoryEntry,
  traversalHistoryIncludes,
} from "./traversal"
import type {
  AgentRequestBestComparison,
  AgentRequestPreviousComparison,
  CellCoordinate,
  Elements,
  GameRuntime,
  LevelDimensions,
  MazeAction,
  MazeActionControl,
  MazeActionDispatchOptions,
  MazeActionState,
  MoveAction,
  PersistedRound,
  RenderGridPoint,
  State,
  TraversalHistoryEntry,
  WinSummaryBestComparison,
  WinSummaryPreviousComparison,
} from "./types"

const { maze, messages, runtime, scoring, timing } = CONFIG

type PersistenceScope = "round" | "state"

const state: State = {
  controlMode: "interactive",
  level: 1,
  maze: null,
  mazeDimensions: null,
  playerPosition: null,
  traversalHistory: [],
  finalPosition: null,
  status: "boot",
  score: 0,
  lastRoundScore: 0,
  lastAttemptRetention: null,
  bestWinRetention: null,
  lastWinRequestCount: null,
  bestWinRequestCount: null,
  winSummary: "",
  canResume: false,
  wallWeight: WALL_WEIGHTS[0],
  scoreDecayUnits: 0,
  agentRequestCount: 0,
  clock: null,
}

let scheduledRoundPersist: number | null = null
let lastBlinkVisible: boolean | null = null
// activeControlMode keeps the currently mounted MazeActionControl so feedback and rebinding stay in sync.
let activeControlMode: MazeActionControl | null = null
let runtimeElements: Elements | null = null

// activeCoreDecayIntervalPerCellMs resolves the current mode's per-cell timing budget.
function activeCoreDecayIntervalPerCellMs(): number {
  return state.controlMode === "agent-api"
    ? timing.agentApiCoreDecayIntervalPerCellMs
    : timing.interactiveCoreDecayIntervalPerCellMs
}

// calculateMaxScore returns the full score budget for one maze before any decay applies.
function calculateMaxScore(totalCells: number): number {
  return totalCells * scoring.budgetMultiplier
}

// calculateElapsedScore converts elapsed time into the remaining score for an interactive round.
function calculateElapsedScore(
  totalCells: number,
  elapsedMs: number,
  decayIntervalPerCellMs: number,
): number {
  const maxScore = calculateMaxScore(totalCells)
  const elapsedPenalty = Math.floor(
    (elapsedMs * timing.scoreDecayRate) / decayIntervalPerCellMs,
  )

  return Math.max(0, maxScore - elapsedPenalty)
}

// calculateScoreAfterDecay converts explicit score-decay units into the remaining score for agent-api rounds.
function calculateScoreAfterDecay(totalCells: number, scoreDecayUnits: number): number {
  const maxScore = calculateMaxScore(totalCells)
  return Math.max(0, maxScore - scoreDecayUnits * timing.scoreDecayRate)
}

// currentRoundTotalCells reports the current maze area used by both timing and score logic.
function currentRoundTotalCells(): number | null {
  if (!state.mazeDimensions) {
    return null
  }

  return state.mazeDimensions.length * state.mazeDimensions.width
}

// calculateRoundScore resolves authoritative score updates for gameplay state changes.
function calculateRoundScore(totalCells: number): number {
  if (state.controlMode === "interactive") {
    // Interactive scoring must come from elapsed clock time; without a clock, preserve score.
    if (!state.clock) {
      return state.score
    }

    return calculateElapsedScore(
      totalCells,
      state.clock.elapsed(),
      timing.interactiveCoreDecayIntervalPerCellMs,
    )
  }

  return calculateScoreAfterDecay(totalCells, state.scoreDecayUnits)
}

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

// compareAgentRequestsPrevious compares the current solved round against the previous solved request count.
function compareAgentRequestsPrevious(
  currentRequests: number,
  lastWinRequestCount: number | null,
): { comparison: AgentRequestPreviousComparison; delta: string } {
  if (lastWinRequestCount === null) {
    return { comparison: "none", delta: "" }
  }

  if (currentRequests < lastWinRequestCount) {
    return {
      comparison: "fewer",
      delta: String(lastWinRequestCount - currentRequests),
    }
  }

  if (currentRequests > lastWinRequestCount) {
    return {
      comparison: "more",
      delta: String(currentRequests - lastWinRequestCount),
    }
  }

  return { comparison: "matched", delta: "" }
}

// compareAgentRequestsBest compares the current solved round against the best solved request count.
function compareAgentRequestsBest(
  currentRequests: number,
  bestWinRequestCount: number | null,
): { comparison: AgentRequestBestComparison; delta: string } {
  if (bestWinRequestCount === null || currentRequests < bestWinRequestCount) {
    return { comparison: "new-record", delta: "" }
  }

  if (currentRequests > bestWinRequestCount) {
    return {
      comparison: "behind-best",
      delta: String(currentRequests - bestWinRequestCount),
    }
  }

  return { comparison: "matched-best", delta: "" }
}

// selectAgentWinSummaryTemplate chooses the request-count summary shown after an agent-api win.
function selectAgentWinSummaryTemplate(
  previousComparison: AgentRequestPreviousComparison,
  bestComparison: AgentRequestBestComparison,
): string {
  if (previousComparison === "none") {
    if (bestComparison === "new-record") {
      return messages.agentWinSummary.noPrevious.newRecord
    }

    if (bestComparison === "matched-best") {
      return messages.agentWinSummary.noPrevious.matchedBest
    }

    return messages.agentWinSummary.noPrevious.behindBest
  }

  if (previousComparison === "fewer") {
    if (bestComparison === "new-record") {
      return messages.agentWinSummary.fewerPrevious.newRecord
    }

    if (bestComparison === "matched-best") {
      return messages.agentWinSummary.fewerPrevious.matchedBest
    }

    return messages.agentWinSummary.fewerPrevious.behindBest
  }

  if (previousComparison === "more") {
    if (bestComparison === "new-record") {
      return messages.agentWinSummary.morePrevious.newRecord
    }

    if (bestComparison === "matched-best") {
      return messages.agentWinSummary.morePrevious.matchedBest
    }

    return messages.agentWinSummary.morePrevious.behindBest
  }

  if (bestComparison === "new-record") {
    return messages.agentWinSummary.matchedPrevious.newRecord
  }

  if (bestComparison === "matched-best") {
    return messages.agentWinSummary.matchedPrevious.matchedBest
  }

  return messages.agentWinSummary.matchedPrevious.behindBest
}

// buildAgentWinSummary assembles the request-count summary shown after an agent-api win.
function buildAgentWinSummary(
  currentRequests: number,
  lastWinRequestCount: number | null,
  bestWinRequestCount: number | null,
): string {
  const previous = compareAgentRequestsPrevious(
    currentRequests,
    lastWinRequestCount,
  )
  const best = compareAgentRequestsBest(currentRequests, bestWinRequestCount)
  const template = selectAgentWinSummaryTemplate(
    previous.comparison,
    best.comparison,
  )

  return replaceWinSummaryDelta(template, previous.delta, best.delta)
}

// positionsEqual compares two rendered maze-grid points without allocating helper objects.
function positionsEqual(left: RenderGridPoint, right: RenderGridPoint): boolean {
  return left.x === right.x && left.y === right.y
}

// readActionState exposes the latest flattened agent-api payload so external callers can plan moves.
function readActionState(): MazeActionState {
  return buildMazeActionState(state)
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

// isTraversalHistoryEntry validates one persisted named visit record.
function isTraversalHistoryEntry(value: unknown): value is TraversalHistoryEntry {
  return (
    isCellCoordinate(value) &&
    "playerName" in value &&
    typeof value.playerName === "string" &&
    value.playerName.length > 0
  )
}

// restoreClock reconstructs a live clock from persisted remaining time.
function restoreClock(totalCells: number, remainingMs: number): GameClock {
  // Round timing is derived from the shared per-cell cadence so score decay, persisted remaining
  // time, and any agent polling policy all reconstruct the same allowance after a reload.
  const totalDurationMs = totalCells * activeCoreDecayIntervalPerCellMs()
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
  state.mazeDimensions = null
  state.maze = null
  state.playerPosition = null
  state.traversalHistory = []
  state.finalPosition = null
  state.score = 0
  state.lastRoundScore = 0
  state.scoreDecayUnits = 0
  state.agentRequestCount = 0
  state.winSummary = ""
  state.canResume = false
  state.clock = null
}

// isValidPersistedRound verifies that a restored round is internally consistent.
function isValidPersistedRound(snapshot: PersistedRound): boolean {
  // Reject impossible round metadata before trusting nested maze data.
  if (
    snapshot.level < 1 ||
    !isWallWeight(snapshot.wallWeight) ||
    snapshot.mazeDimensions.length <= 0 ||
    snapshot.mazeDimensions.width <= 0
  ) {
    return false
  }

  // The stored maze grid must match the dimensions used to generate it.
  const expectedRows = maze.cellSpan * snapshot.mazeDimensions.width + 1
  const expectedColumns = snapshot.mazeDimensions.length * 2 + 1
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

  // Player and destination positions must both point at open maze cells.
  if (!isTraversableGridPoint(snapshot.maze, snapshot.playerPosition)) {
    return false
  }

  if (!isTraversableGridPoint(snapshot.maze, snapshot.finalPosition)) {
    return false
  }

  // Traversal history must start with the saved round start cell.
  if (
    !isCellCoordinate(snapshot.startCell) ||
    !Array.isArray(snapshot.traversalHistory) ||
    snapshot.traversalHistory.length === 0
  ) {
    return false
  }

  // The saved start cell must still be traversable in the stored maze.
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
    !isTraversalHistoryEntry(firstVisitedCell) ||
    mazeCellKey(firstVisitedCell) !== mazeCellKey(snapshot.startCell)
  ) {
    return false
  }

  const visitedCellKeys = new Set<string>()
  for (const visitedCell of snapshot.traversalHistory) {
    // History is append-only and unique, so duplicates indicate corrupted state.
    if (!isTraversalHistoryEntry(visitedCell)) {
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
  return viewportFitStatus(
    snapshot.mazeDimensions,
    runtimeElements ? getTerminalSize(runtimeElements) : null,
  ) === "fits"
}

// cancelScheduledRoundPersist stops any deferred round persistence job.
function cancelScheduledRoundPersist(): void {
  if (scheduledRoundPersist === null) {
    return
  }

  window.clearTimeout(scheduledRoundPersist)
  scheduledRoundPersist = null
}

// persistNow flushes the current round and optionally includes long-lived progress preferences.
function persistNow(scope: PersistenceScope): void {
  cancelScheduledRoundPersist()
  if (scope === "state") {
    saveGameProgress(state.controlMode, state)
  }
  saveActiveRoundSnapshot(state.controlMode, state)
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

// applyWinSummary updates retention and mode-specific win summaries after the score has been resolved.
function applyWinSummary(totalCells: number): void {
  // Retention normalizes scores so wins on different maze sizes remain comparable.
  const currentRetention = calculateScoreRetention(totalCells, state.score)

  if (state.controlMode === "interactive") {
    // Interactive summaries translate retention deltas back into time-like progress messages.
    const levelDurationMs = totalCells * activeCoreDecayIntervalPerCellMs()
    state.winSummary = buildWinSummary(
      currentRetention,
      state.lastAttemptRetention,
      state.bestWinRetention,
      levelDurationMs,
    )
    state.lastAttemptRetention = currentRetention
    state.bestWinRetention =
      state.bestWinRetention === null || currentRetention > state.bestWinRetention
        ? currentRetention
        : state.bestWinRetention
    return
  }

  // Agent-api summaries compare request efficiency because agents may submit batched moves.
  state.winSummary = buildAgentWinSummary(
    state.agentRequestCount,
    state.lastWinRequestCount,
    state.bestWinRequestCount,
  )
  state.lastAttemptRetention = currentRetention
  state.bestWinRetention =
    state.bestWinRetention === null || currentRetention > state.bestWinRetention
      ? currentRetention
      : state.bestWinRetention
  // Request counts are tracked separately from retention so agent runs can report API efficiency.
  state.lastWinRequestCount = state.agentRequestCount
  state.bestWinRequestCount =
    state.bestWinRequestCount === null ||
    state.agentRequestCount < state.bestWinRequestCount
      ? state.agentRequestCount
      : state.bestWinRequestCount
}

// commitAgentTurn is the only place agent-api spends score decay after one resolved request.
function commitAgentTurn(decayedMovesCount: number): MazeActionState {
  const totalCells = currentRoundTotalCells()
  if (state.controlMode !== "agent-api" || totalCells === null) {
    return readActionState()
  }

  state.agentRequestCount += 1

  state.scoreDecayUnits += decayedMovesCount
  state.score = calculateRoundScore(totalCells)

  if (isWonStatus(state.status)) {
    applyWinSummary(totalCells)
    persistNow("state")
    renderState()
    return readActionState()
  }

  if (isRunningStatus(state.status) && state.score <= 0) {
    handleLoss()
    return readActionState()
  }

  persistNow("round")
  renderState()
  return readActionState()
}

// scheduleRoundPersistence batches non-terminal round updates behind the refresh cadence.
function scheduleRoundPersistence(): void {
  cancelScheduledRoundPersist()
  scheduledRoundPersist = window.setTimeout(() => {
    scheduledRoundPersist = null
    saveActiveRoundSnapshot(state.controlMode, state)
  }, timing.refreshInterval)
}

// restorePersistedRound rebuilds a saved round or falls back when it is invalid.
function restorePersistedRound(snapshot: PersistedRound | null): boolean {
  if (!runtimeElements || !snapshot) {
    return false
  }

  if (!isValidPersistedRound(snapshot)) {
    clearPersistedRound(state.controlMode)
    return false
  }

  if (!persistedRoundFitsViewport(snapshot)) {
    applyTooSmallState(snapshot.level)
    state.wallWeight = snapshot.wallWeight
    persistNow("state")
    renderState()
    return true
  }

  state.wallWeight = snapshot.wallWeight
  state.level = snapshot.level
  state.mazeDimensions = {
    length: snapshot.mazeDimensions.length,
    width: snapshot.mazeDimensions.width,
  }
  state.maze = snapshot.maze.map((row) => [...row])
  state.playerPosition = {
    x: snapshot.playerPosition.x,
    y: snapshot.playerPosition.y,
  }
  state.traversalHistory = snapshot.traversalHistory.map(({ playerName, row, col }) => ({
    playerName,
    row,
    col,
  }))
  state.finalPosition = {
    x: snapshot.finalPosition.x,
    y: snapshot.finalPosition.y,
  }
  state.score = snapshot.score
  state.lastRoundScore = snapshot.lastRoundScore
  state.scoreDecayUnits = snapshot.scoreDecayUnits ?? 0
  state.agentRequestCount = snapshot.agentRequestCount ?? 0
  state.winSummary = snapshot.winSummary ?? ""
  state.canResume = false

  if (isFinishedStatus(snapshot.status)) {
    state.status = snapshot.status
    state.clock = null
    renderState()
    return true
  }

  const totalCells = snapshot.mazeDimensions.length * snapshot.mazeDimensions.width
  state.clock = restoreClock(totalCells, snapshot.remainingMs)
  state.clock.pause()
  if (isAwaitAgentStatus(snapshot.status)) {
    state.status = "await-agent"
    state.winSummary = ""
    state.canResume = false
    renderState()
    return true
  }

  state.status = "paused"
  state.winSummary = ""
  state.canResume = true
  renderState()
  return true
}

// startRoundWithDimensions initializes a round after viewport-safe dimensions have been selected.
function startRoundWithDimensions(dimensions: LevelDimensions, persist = true): void {
  const round = generateMaze(dimensions, state.wallWeight)

  state.level = dimensions.level
  state.mazeDimensions = { length: dimensions.length, width: dimensions.width }
  state.maze = round.maze
  state.playerPosition = {
    x: round.startPosition.x,
    y: round.startPosition.y,
  }
  state.traversalHistory = [
    traversalHistoryEntry(
      cellCoordinateFromGridPoint(round.startPosition),
      runtime.interactivePlayerName,
    ),
  ]
  state.finalPosition = {
    x: round.finalPosition.x,
    y: round.finalPosition.y,
  }
  state.status = "running"
  state.canResume = false
  state.lastRoundScore = 0
  state.scoreDecayUnits = 0
  state.agentRequestCount = 0
  state.winSummary = ""

  const totalCells = dimensions.length * dimensions.width
  // The round clock uses the shared per-cell cadence to set both the starting score window and the
  // maximum amount of playable time for this maze size.
  state.clock = new GameClock(totalCells * activeCoreDecayIntervalPerCellMs())
  state.score = calculateMaxScore(totalCells)
  if (persist) {
    persistNow("state")
  }
  renderState()
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
      persistNow("state")
    }
    renderState()
    return
  }

  startRoundWithDimensions(dimensions, persist)
}

// redrawRoundForViewport reshapes the current level when its existing dimensions no longer fit.
function redrawRoundForViewport(level: number): boolean {
  if (!runtimeElements) {
    return false
  }

  const dimensions = getMazeDimensions(level, getTerminalSize(runtimeElements))
  if (!dimensions) {
    return false
  }

  startRoundWithDimensions(dimensions)
  return true
}

// restartGame clears persisted progress and restarts from level one.
function restartGame(): void {
  cancelScheduledRoundPersist()
  clearPersistedSnapshot(state.controlMode)
  activeControlMode?.clearActionState()
  state.wallWeight = WALL_WEIGHTS[0]
  state.lastAttemptRetention = null
  state.bestWinRetention = null
  state.lastWinRequestCount = null
  state.bestWinRequestCount = null
  state.lastRoundScore = 0
  state.winSummary = ""
  startRound(1, false)
}

// resumeOrProceed resumes a pause or advances from a finished round.
function resumeOrProceed(): void {
  if (isAwaitAgentStatus(state.status) && state.controlMode === "agent-api") {
    state.clock?.resume()
    state.status = "running"
    state.canResume = false
    persistNow("state")
    renderState()
    return
  }

  if (isPausedStatus(state.status) && state.canResume && state.clock) {
    state.clock.resume()
    state.status = "running"
    state.canResume = false
    persistNow("round")
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

// awaitAgent pauses agent-api play before any HTTP agent has been explicitly enabled.
function awaitAgent(): void {
  if (state.controlMode !== "agent-api" || !isRunningStatus(state.status)) {
    return
  }

  state.clock?.pause()
  state.status = "await-agent"
  state.canResume = false
  persistNow("state")
  renderState()
}

// pauseGame freezes the current round while preserving it for resume.
function pauseGame(): void {
  if (!isRunningStatus(state.status) || !state.clock) {
    return
  }

  state.clock.pause()
  state.status = "paused"
  state.canResume = true
  persistNow("state")
  renderState()
}

// cycleWallWeight swaps the live maze walls to the next supported weight.
function cycleWallWeight(): void {
  const nextWeight = nextWallWeight(state.wallWeight)

  if (state.maze) {
    state.maze = reweightMaze(state.maze, state.wallWeight)
  }

  state.wallWeight = nextWeight
  persistNow("state")
  renderState()
}

// handleWinCheck updates retention metrics and finalizes the round after a win.
function handleWinCheck(): boolean {
  const totalCells = currentRoundTotalCells()
  if (state.clock && totalCells !== null) {
    state.score = calculateRoundScore(totalCells)
  }

  if (
    !state.playerPosition ||
    !state.finalPosition ||
    !positionsEqual(state.playerPosition, state.finalPosition)
  ) {
    return false
  }

  if (totalCells !== null) {
    applyWinSummary(totalCells)
  }
  state.status = "won"
  state.canResume = false
  state.lastRoundScore = state.score
  return true
}

// movePlayer applies one validated move step and persists the updated round state.
function movePlayer(action: MoveAction, playerName: string): void {
  const moveEvaluation = resolvePlayerMove(state, action)
  if (!moveEvaluation.canMove) {
    return
  }

  state.playerPosition = moveEvaluation.nextGridPoint
  if (!traversalHistoryIncludes(state.traversalHistory, moveEvaluation.nextCell)) {
    state.traversalHistory.push(
      traversalHistoryEntry(moveEvaluation.nextCell, playerName),
    )
  }

  const won = handleWinCheck()
  if (state.controlMode === "agent-api") {
    // Agent-api applies position, history, and win state immediately, but defers score
    // decay, persistence, and rendering until commitAgentTurn processes the full
    // prediction batch. Committing per move would over-render and double-spend score
    // decay for one API response.
    return
  }

  if (won) {
    persistNow("state")
  } else {
    scheduleRoundPersistence()
  }
  renderState()
}

// handleLoss finalizes the round when the timer has fully expired.
function handleLoss(): void {
  const totalCells = currentRoundTotalCells()
  if (!isRunningStatus(state.status) || totalCells === null) {
    return
  }

  state.score = calculateRoundScore(totalCells)

  state.status = "lost"
  state.canResume = false
  state.lastRoundScore = state.score
  state.lastAttemptRetention = 0
  state.winSummary = ""
  persistNow("state")
  renderState()
}

// refreshRunningRound handles presentation-time updates only: score refresh, loss detection, and
// blink refresh while still running. Agent-api refreshes reuse committed score so they never spend extra decay.
function refreshRunningRound(): void {
  const totalCells = currentRoundTotalCells()
  if (!isRunningStatus(state.status) || !state.clock || totalCells === null) {
    return
  }

  const previousScore = state.score
  if (state.controlMode === "interactive") {
    state.score = calculateRoundScore(totalCells)
  }
  // Agent-api score is left untouched here; commitAgentTurn owns request-based score decay.

  // Score depletion is the shared loss signal for both interactive and agent-api modes.
  if (state.score <= 0) {
    handleLoss()
    return
  }

  const nextBlinkVisible = state.clock.blink()
  const scoreChanged = state.score !== previousScore
  const blinkChanged = nextBlinkVisible !== lastBlinkVisible
  if (scoreChanged || blinkChanged) {
    renderState()
  }
}

// handleMove applies one semantic movement action for the named player.
function handleMove(action: MoveAction, playerName = runtime.interactivePlayerName): void {
  movePlayer(action, playerName)
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
    case "await-agent":
      awaitAgent()
      return
  }
}

// dispatchControl routes one action and optionally returns command state.
function dispatchControl(
  action: MazeAction,
  options: MazeActionDispatchOptions,
): ReturnType<typeof executeActionWithFeedback> | null {
  // Control modes translate their own input sources into semantic maze commands,
  // and the shared runtime resolves those commands here.
  if (!options.wantFeedback) {
    executeCommand(action)
    return null
  }

  // Feedback requests run through the agent-context path so moves can return structured state.
  const actionState = executeActionWithFeedback(action, {
    executeCommand,
    state,
    handleMove,
    playerName: options.playerName,
  })

  if (actionState) {
    // The active control mode owns how it stores or forwards the latest agent-facing state.
    activeControlMode?.recordActionState(actionState)
  }
  return actionState
}

// handleResize revalidates the active or persisted round against the viewport.
function handleResize(): void {
  if (!runtimeElements) {
    return
  }

  const fitStatus = viewportFitStatus(
    state.mazeDimensions,
    getTerminalSize(runtimeElements),
  )
  if (!isTooSmallStatus(state.status) && isTooSmallStatus(fitStatus)) {
    if (fitStatus !== "too-small-all" && redrawRoundForViewport(state.level)) {
      return
    }

    applyTooSmallState(state.level)
    persistNow("state")
  }

  if (isTooSmallStatus(state.status)) {
    if (
      restorePersistedRound(
        loadPersistedSnapshot(
          state.controlMode,
          1,
          WALL_WEIGHTS[0],
          isWallWeight,
        ).round,
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
  controlMode.bindActionDispatch(dispatchControl, readActionState, commitAgentTurn)

  window.addEventListener("resize", handleResize)
  window.visualViewport?.addEventListener("resize", handleResize)
  window.addEventListener("pagehide", () => { persistNow("state") })
  window.setInterval(refreshRunningRound, timing.refreshInterval)

  const persistedSnapshot = loadPersistedSnapshot(
    controlMode.name,
    1,
    WALL_WEIGHTS[0],
    isWallWeight,
  )
  state.wallWeight = persistedSnapshot.preferences.wallWeight
  state.level = persistedSnapshot.preferences.level
  state.lastAttemptRetention = persistedSnapshot.preferences.lastAttemptRetention ?? null
  state.bestWinRetention = persistedSnapshot.preferences.bestWinRetention ?? null
  state.lastWinRequestCount = persistedSnapshot.preferences.lastWinRequestCount ?? null
  state.bestWinRequestCount = persistedSnapshot.preferences.bestWinRequestCount ?? null

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
