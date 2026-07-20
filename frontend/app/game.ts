import { GameClock } from "./clock"
import {
  CONFIG,
  WALL_WEIGHTS,
} from "./config"
import { buildMazeActionState, executeActionWithFeedback } from "./agent/context"
import { getTerminalSize } from "./dom"
import {
  generateMaze,
  getMazeDimensions,
} from "./maze"
import { render } from "./render"
import {
  calculateElapsedScore,
  calculateMaxScore,
  calculateScoreAfterDecay,
  resolveWinScore,
} from "./scoring"
import {
  isFinishedStatus,
  isAgentApiMode,
  isAwaitAgentStatus,
  isLostStatus,
  isInteractiveMode,
  isPausedStatus,
  isRunningStatus,
  isTooSmallStatus,
  isWonStatus,
  viewportFitStatus,
} from "./status"
import {
  clearPersistedSnapshot,
  clearPersistedRound,
  clearStaleStorageVersions,
  loadPersistedSnapshot,
  saveGameProgress,
  saveActiveRoundSnapshot,
} from "./storage"
import {
  cellCoordinateFromGridPoint,
  cloneMazeDimensions,
  cloneMazeRows,
  cloneRenderGridPoint,
  cloneTraversalHistory,
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
  CellCoordinate,
  Elements,
  GameRuntime,
  LevelDimensions,
  MazeAction,
  MazeActionControl,
  MazeActionDispatchOptions,
  MazeActionState,
  MazeControlModeName,
  MazeDimensions,
  MoveAction,
  PersistedRound,
  PersistedSnapshot,
  RenderGridPoint,
  State,
  TraversalHistoryEntry,
} from "./types"

const { maze, runtime, timing } = CONFIG

type PersistenceScope = "round" | "state"

type RuntimeRoundState = {
  level: number
  mazeDimensions: MazeDimensions
  maze: string[][]
  playerPosition: RenderGridPoint
  traversalHistory: TraversalHistoryEntry[]
  finalPosition: RenderGridPoint
}

const state: State = {
  controlMode: runtime.controlModes.interactive,
  level: 1,
  maze: null,
  mazeDimensions: null,
  playerPosition: null,
  traversalHistory: [],
  finalPosition: null,
  status: "boot",
  score: 0,
  lastRoundScore: 0,
  lastAttemptRetentionUnits: null,
  bestWinRetentionUnits: null,
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
  return isAgentApiMode(state.controlMode)
    ? timing.agentApiCoreDecayIntervalPerCellMs
    : timing.interactiveCoreDecayIntervalPerCellMs
}

// loadPersistedSnapshotWithFallbacks prefers stored state and only applies fallbacks when storage is missing or invalid.
function loadPersistedSnapshotWithFallbacks(
  mode: MazeControlModeName,
): PersistedSnapshot {
  return loadPersistedSnapshot(mode, 1, WALL_WEIGHTS[0], isWallWeight)
}

// calculateRoundScore resolves authoritative score updates for gameplay state changes.
function calculateRoundScore(totalCells: number): number {
  if (isInteractiveMode(state.controlMode)) {
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

// positionsEqual compares two rendered maze-grid points without allocating helper objects.
function positionsEqual(left: RenderGridPoint, right: RenderGridPoint): boolean {
  return left.x === right.x && left.y === right.y
}

// readActionState exposes the latest flattened agent-api payload so external callers can plan moves.
function readActionState(): MazeActionState {
  return buildMazeActionState(state, runtime.interactivePlayerName, "")
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
    snapshot.mazeDimensions.width <= 0 ||
    snapshot.mazeDimensions.area !== snapshot.mazeDimensions.length * snapshot.mazeDimensions.width
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

// applyWinSummary delegates post-win scoring details and stores the resolved result.
function applyWinSummary(totalCells: number): void {
  const winScore = resolveWinScore({
    agentRequestCount: state.agentRequestCount,
    bestWinRequestCount: state.bestWinRequestCount,
    bestWinRetentionUnits: state.bestWinRetentionUnits,
    controlMode: state.controlMode,
    lastAttemptRetentionUnits: state.lastAttemptRetentionUnits,
    lastWinRequestCount: state.lastWinRequestCount,
    score: state.score,
    totalCells,
  })

  state.winSummary = winScore.winSummary
  state.lastAttemptRetentionUnits = winScore.lastAttemptRetentionUnits
  state.bestWinRetentionUnits = winScore.bestWinRetentionUnits
  state.lastWinRequestCount = winScore.lastWinRequestCount
  state.bestWinRequestCount = winScore.bestWinRequestCount
}

// commitAgentTurn is the only place agent-api spends score decay after one resolved request.
function commitAgentTurn(decayedMovesCount: number): MazeActionState {
  const totalCells = state.mazeDimensions?.area ?? 0
  if (!isAgentApiMode(state.controlMode) || totalCells === 0) {
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

// applyRuntimeRoundState installs the maze data shared by restored and newly generated rounds.
function applyRuntimeRoundState(roundState: RuntimeRoundState): void {
  state.level = roundState.level
  state.mazeDimensions = cloneMazeDimensions(roundState.mazeDimensions)
  state.maze = cloneMazeRows(roundState.maze)
  state.playerPosition = cloneRenderGridPoint(roundState.playerPosition)
  state.traversalHistory = cloneTraversalHistory(roundState.traversalHistory)
  state.finalPosition = cloneRenderGridPoint(roundState.finalPosition)
}

// noValidRoundExists restores a valid persisted round; true means startup must create a new maze.
function noValidRoundExists(snapshot: PersistedRound | null): boolean {
  if (!runtimeElements || !snapshot) {
    return true
  }

  if (!isValidPersistedRound(snapshot)) {
    clearPersistedRound(state.controlMode)
    return true
  }

  restoreValidPersistedRound(snapshot)
  return false
}

// restoreValidPersistedRound rebuilds runtime state from a snapshot that already passed validation.
function restoreValidPersistedRound(snapshot: PersistedRound): void {
  if (!persistedRoundFitsViewport(snapshot)) {
    applyTooSmallState(snapshot.level)
    state.wallWeight = snapshot.wallWeight
    persistNow("state")
    renderState()
    return
  }

  state.wallWeight = snapshot.wallWeight
  applyRuntimeRoundState({
    level: snapshot.level,
    mazeDimensions: snapshot.mazeDimensions,
    maze: snapshot.maze,
    playerPosition: snapshot.playerPosition,
    traversalHistory: snapshot.traversalHistory,
    finalPosition: snapshot.finalPosition,
  })
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
    return
  }

  const totalCells = snapshot.mazeDimensions.area
  state.clock = restoreClock(totalCells, snapshot.remainingMs)
  state.clock.pause()
  if (isAwaitAgentStatus(snapshot.status)) {
    state.status = "await-agent"
    state.winSummary = ""
    state.canResume = false
    renderState()
    return
  }

  state.status = "paused"
  state.winSummary = ""
  state.canResume = true
  renderState()
}

// startRoundWithDimensions initializes a round after viewport-safe dimensions have been selected.
function startRoundWithDimensions(dimensions: LevelDimensions, persist = true): void {
  const round = generateMaze(dimensions, state.wallWeight)

  activeControlMode?.clearActionState()
  applyRuntimeRoundState({
    level: dimensions.level,
    mazeDimensions: dimensions,
    maze: round.maze,
    playerPosition: round.startPosition,
    traversalHistory: [
      traversalHistoryEntry(cellCoordinateFromGridPoint(round.startPosition), runtime.interactivePlayerName),
    ],
    finalPosition: round.finalPosition,
  })
  state.status = "running"
  state.canResume = false
  state.lastRoundScore = 0
  state.scoreDecayUnits = 0
  state.agentRequestCount = 0
  state.winSummary = ""

  const totalCells = dimensions.area
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
  state.lastAttemptRetentionUnits = null
  state.bestWinRetentionUnits = null
  state.lastWinRequestCount = null
  state.bestWinRequestCount = null
  state.lastRoundScore = 0
  state.winSummary = ""
  startRound(1, false)
}

// resumeOrProceed resumes a pause or advances from a finished round.
function resumeOrProceed(): void {
  if (isAwaitAgentStatus(state.status) && isAgentApiMode(state.controlMode)) {
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
  if (!isAgentApiMode(state.controlMode) || !isRunningStatus(state.status)) {
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
  const totalCells = state.mazeDimensions?.area ?? 0
  if (state.clock && totalCells > 0) {
    state.score = calculateRoundScore(totalCells)
  }

  if (
    !state.playerPosition ||
    !state.finalPosition ||
    !positionsEqual(state.playerPosition, state.finalPosition)
  ) {
    return false
  }

  if (totalCells > 0) {
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
  if (isAgentApiMode(state.controlMode)) {
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
  const totalCells = state.mazeDimensions?.area ?? 0
  if (!isRunningStatus(state.status) || totalCells === 0) {
    return
  }

  state.score = calculateRoundScore(totalCells)

  state.status = "lost"
  state.canResume = false
  state.lastRoundScore = state.score
  state.lastAttemptRetentionUnits = 0
  state.winSummary = ""
  persistNow("state")
  renderState()
}

// refreshRunningRound handles presentation-time updates only: score refresh, loss detection, and
// blink refresh while still running. Agent-api refreshes reuse committed score so they never spend extra decay.
function refreshRunningRound(): void {
  const totalCells = state.mazeDimensions?.area ?? 0
  if (!isRunningStatus(state.status) || !state.clock || totalCells === 0) {
    return
  }

  const previousScore = state.score
  if (isInteractiveMode(state.controlMode)) {
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

// executeCommand runs one semantic control command without building feedback.
// playerName is required at this boundary even when a session command ignores it, because any
// traversal command must be attributed to the control mode or agent that actually requested it.
function executeCommand(action: MazeAction, playerName: string): void {
  switch (action.type) {
    case "MoveLeft":
    case "MoveRight":
    case "MoveUp":
    case "MoveDown":
      movePlayer(action.type, playerName)
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
    executeCommand(action, options.playerName)
    return null
  }

  if (!options.model) {
    throw new Error("agent feedback dispatch requires a configured model")
  }

  // Feedback requests run through the agent context path so moves can return structured state.
  const actionState = executeActionWithFeedback(action, {
    executeCommand: (nextAction) => {
      executeCommand(nextAction, options.playerName)
    },
    state,
    handleMove: movePlayer,
    model: options.model,
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
    const snapshot = loadPersistedSnapshotWithFallbacks(state.controlMode)
    const validRoundWasRestored = noValidRoundExists(snapshot.round) === false
    if (validRoundWasRestored) {
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
  clearStaleStorageVersions()

  window.addEventListener("resize", handleResize)
  window.visualViewport?.addEventListener("resize", handleResize)
  window.addEventListener("pagehide", () => { persistNow("state") })
  // This interval is the browser runtime heartbeat that refreshes score, blink, and loss state.
  window.setInterval(refreshRunningRound, timing.refreshInterval)

  // Stored progress wins here; built-in fallbacks only apply when persisted data is absent or invalid.
  const persistedSnapshot = loadPersistedSnapshotWithFallbacks(controlMode.name)
  state.wallWeight = persistedSnapshot.preferences.wallWeight
  state.level = persistedSnapshot.preferences.level
  state.lastAttemptRetentionUnits = persistedSnapshot.preferences.lastAttemptRetentionUnits ?? null
  state.bestWinRetentionUnits = persistedSnapshot.preferences.bestWinRetentionUnits ?? null
  state.lastWinRequestCount = persistedSnapshot.preferences.lastWinRequestCount ?? null
  state.bestWinRequestCount = persistedSnapshot.preferences.bestWinRequestCount ?? null

  // If no valid persisted round exists, create a fresh maze for the current level.
  if (noValidRoundExists(persistedSnapshot.round)) {
    startRound(state.level)
  }

  controlMode.bindActionDispatch(dispatchControl, readActionState, commitAgentTurn)
  if (isInteractiveMode(controlMode.name)) {
    runtimeElements.app.focus()
  }

  return {
    mode: controlMode.name,
    dispatch: dispatchControl,
    persistSnapshot: () => {
      persistNow("state")
    },
  }
}
