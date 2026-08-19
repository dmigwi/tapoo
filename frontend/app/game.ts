import { GameClock } from "./clock"
import { logTapooDiagnostic } from "./logs"
import {
  CONFIG,
  WALL_WEIGHTS,
} from "./config"
import { dispatchMazeAction } from "./control"
import {
  commitAgentApiTurn,
  commitInteractiveTurn,
  refreshRunningRoundFrame,
} from "./control/turn-resolution"
import { getTerminalSize } from "./dom"
import {
  generateMaze,
  getMazeDimensions,
} from "./maze"
import { render } from "./render"
import { calculateTraversalSpeedUnits } from "./agent/efficiency"
import {
  calculateElapsedScore,
  calculateMaxScore,
  calculateScoreAfterDecay,
  resolveWinScore,
} from "./scoring"
import {
  canTrackDestinationVisibility,
  isFinishedStatus,
  isAgentApiMode,
  isAwaitAgentStatus,
  isLostStatus,
  isInteractiveMode,
  isPausedStatus,
  isRunningStatus,
  isTooSmallStatus,
  isWonStatus,
  stateInvariantError,
  viewportFitStatus,
} from "./status"
import {
  clearPersistedSnapshot,
  clearPersistedRound,
  clearStaleStorageVersions,
  loadPersistedSnapshot,
  resetAgentRoundStats,
  saveGameProgress,
  saveActiveRoundSnapshot,
} from "./storage"
import {
  cellCoordinateFromGridPoint,
  cloneMazeDimensions,
  cloneMazeRows,
  cloneRenderGridPoint,
  cloneTraversalHistory,
  isValidPersistedRound,
  isWallWeight,
  nextWallWeight,
  resolvePlayerMove,
  reweightMaze,
  traversalHistoryEntry,
  traversalHistoryIncludes,
} from "./traversal"
import type {
  Elements,
  GameRuntime,
  LevelDimensions,
  MazeAction,
  MazeActionControl,
  MazeActionDispatchOptions,
  MazeActionResult,
  MazeControlModeName,
  MazeDimensions,
  MoveAction,
  PersistedGameStatus,
  PersistedRound,
  PersistedSnapshot,
  RenderGridPoint,
  State,
  TraversalHistoryEntry,
} from "./types"

const { runtime, timing, viewport } = CONFIG

type PersistenceScope = "round" | "state"

type RuntimeRoundState = {
  level: number
  mazeDimensions: MazeDimensions
  maze: string[][]
  startPosition: RenderGridPoint
  playerPosition: RenderGridPoint
  traversalHistory: TraversalHistoryEntry[]
  finalPosition: RenderGridPoint
}

const state: State = {
  controlMode: runtime.controlModes.interactive,
  level: 1,
  maze: null,
  mazeDimensions: null,
  startPosition: null,
  playerPosition: null,
  traversalHistory: [],
  finalPosition: null,
  status: "boot",
  score: 0,
  lastRoundScore: 0,
  lastAttemptRetentionUnits: null,
  bestWinRetentionUnits: null,
  lastWinTraversalSpeedUnits: null,
  bestWinTraversalSpeedUnits: null,
  winSummary: "",
  wallWeight: WALL_WEIGHTS[0],
  scoreDecayUnits: 0,
  turnCount: 0,
  cumulativeRoundCount: 0,
  clock: null,
}

let scheduledRoundPersist: number | null = null
// activeControlMode keeps the currently mounted MazeActionControl so feedback and rebinding stay in sync.
let activeControlMode: MazeActionControl | null = null
let runtimeElements: Elements | null = null

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
      timing.interactiveDecayIntervalPerCellMs,
    )
  }

  return calculateScoreAfterDecay(totalCells, state.scoreDecayUnits)
}

// restoreClock reconstructs a live clock from persisted remaining time.
function restoreClock(totalCells: number, remainingMs: number): GameClock {
  // interactiveDecayIntervalPerCellMs sizes score decay for interactive mode; for agent-api mode
  // the clock only exists to drive the destination blink animation (see clock.blink()), which
  // depends solely on elapsed() and never reads levelDurationMs, so reusing the same figure here
  // is inert bookkeeping — it just keeps this reload round-trip self-consistent with the value
  // used when the round started (see restartGame below).
  const totalDurationMs = totalCells * timing.interactiveDecayIntervalPerCellMs
  const clampedRemainingMs = Math.max(0, Math.min(totalDurationMs, remainingMs))
  const clock = new GameClock(totalDurationMs)
  clock.startedAt = performance.now() - (totalDurationMs - clampedRemainingMs)
  return clock
}

// applyTooSmallState clears the active round when the viewport can no longer fit it.
function applyTooSmallState(level: number): void {
  state.status = "too-small"
  state.level = level
  state.mazeDimensions = null
  state.maze = null
  state.startPosition = null
  state.playerPosition = null
  state.traversalHistory = []
  state.finalPosition = null
  state.score = 0
  state.lastRoundScore = 0
  state.scoreDecayUnits = 0
  state.turnCount = 0
  state.cumulativeRoundCount += 1
  state.winSummary = ""
  state.clock = null
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
//
// The "round" and "state" scopes write to two browser stores with different survival guarantees,
// and level/wallWeight deliberately live in both:
//   - sessionStorage (saveActiveRoundSnapshot, always written) holds the exact state of the
//     currently active round — maze, traversal history, positions, score, level, wallWeight — so
//     a same-tab refresh can restore it. It's wiped when the tab/browser closes.
//   - localStorage (saveGameProgress, "state" scope only) holds just level and wallWeight as
//     durable defaults for the *next* round, since sessionStorage won't survive closing the
//     browser or the round finishing (win/loss clears its snapshot).
// "round" is used for frequent per-move writes (cheap, sessionStorage only); "state" is used for
// checkpoints worth syncing to the durable copy too — level changes, wins, wall-weight cycling,
// pause/exit. This keeps the two copies from ever drifting apart. At boot (bootstrapGame), the
// localStorage values are only ever used as the fallback when no valid sessionStorage round
// exists to resume — removing either copy would break a real case: closing the browser (loses
// sessionStorage) or a same-tab refresh mid-round (needs a self-contained round snapshot without
// reaching into a separate store).
function persistNow(scope: PersistenceScope): void {
  cancelScheduledRoundPersist()
  if (scope === "state") {
    saveGameProgress(state.controlMode, state)
  }
  saveActiveRoundSnapshot(state.controlMode, state)
}

// persistProgressOnly saves durable preferences without replacing the restorable round snapshot.
function persistProgressOnly(): void {
  cancelScheduledRoundPersist()
  saveGameProgress(state.controlMode, state)
}

// lastReportedInvariant suppresses repeat entries: renderState runs on the blink cadence, so an
// unfixed violation would otherwise append several entries a second and bury the gameplay history
// it sits beside.
let lastReportedInvariant: string | null = null

// reportStateInvariant records an impossible status/state combination without interrupting play.
// Throwing was the alternative, but renderState runs on the blink interval and nothing in game.ts
// catches, so the error would reach the global handler in tapoo.ts and swap the whole game for
// placeholder art — turning a recoverable inconsistency into a lost round, which matters most
// during unattended agent runs. Logging instead keeps the violation beside the gameplay it came
// from in the downloadable log, and stateInvariantError stays directly asserted in status.test.ts.
function reportStateInvariant(): void {
  const invariantError = stateInvariantError(state)
  if (invariantError === lastReportedInvariant) {
    return
  }

  lastReportedInvariant = invariantError
  if (invariantError) {
    logTapooDiagnostic(state.controlMode, "error", invariantError, {
      status: state.status,
      clockPaused: state.clock?.isPaused ?? null,
      level: state.level,
    })
  }
}

// renderState pushes the current game state into the terminal-like renderer.
function renderState(): void {
  if (!runtimeElements) {
    return
  }

  reportStateInvariant()
  render(runtimeElements, state, activeControlMode?.readCurrentPlayer?.() ?? null)
}

// applyWinSummary delegates post-win scoring details and stores the resolved result.
function applyWinSummary(totalCells: number): void {
  // Only cells the agents actually reached count as progress; the start cell is seeded under the
  // interactive player name and was never earned, so it must not inflate the round's speed.
  const agentCellsVisited = state.traversalHistory.filter(
    (entry) => entry.playerName !== runtime.interactivePlayerName,
  ).length
  const winScore = resolveWinScore({
    bestWinRetentionUnits: state.bestWinRetentionUnits,
    bestWinTraversalSpeedUnits: state.bestWinTraversalSpeedUnits,
    controlMode: state.controlMode,
    lastAttemptRetentionUnits: state.lastAttemptRetentionUnits,
    lastWinTraversalSpeedUnits: state.lastWinTraversalSpeedUnits,
    score: state.score,
    totalCells,
    traversalSpeedUnits: calculateTraversalSpeedUnits(agentCellsVisited, state.scoreDecayUnits),
  })

  state.winSummary = winScore.winSummary
  state.lastAttemptRetentionUnits = winScore.lastAttemptRetentionUnits
  state.bestWinRetentionUnits = winScore.bestWinRetentionUnits
  state.lastWinTraversalSpeedUnits = winScore.lastWinTraversalSpeedUnits
  state.bestWinTraversalSpeedUnits = winScore.bestWinTraversalSpeedUnits
}

// scheduleRoundPersistence debounces in-progress interactive move snapshots so rapid key repeats
// write the latest round once instead of persisting every valid step immediately.
function scheduleRoundPersistence(): void {
  cancelScheduledRoundPersist()
  scheduledRoundPersist = window.setTimeout(() => {
    scheduledRoundPersist = null
    saveActiveRoundSnapshot(state.controlMode, state)
  }, timing.persistenceDebounceMs)
}

// applyRuntimeRoundState installs the maze data shared by restored and newly generated rounds.
function applyRuntimeRoundState(roundState: RuntimeRoundState): void {
  state.level = roundState.level
  state.mazeDimensions = cloneMazeDimensions(roundState.mazeDimensions)
  state.maze = cloneMazeRows(roundState.maze)
  state.startPosition = cloneRenderGridPoint(roundState.startPosition)
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
    persistProgressOnly()
    return
  }

  state.wallWeight = snapshot.wallWeight
  applyRuntimeRoundState({
    level: snapshot.level,
    mazeDimensions: snapshot.mazeDimensions,
    maze: snapshot.maze,
    startPosition: snapshot.startPosition,
    playerPosition: snapshot.playerPosition,
    traversalHistory: snapshot.traversalHistory,
    finalPosition: snapshot.finalPosition,
  })
  
  state.score = snapshot.score
  state.lastRoundScore = snapshot.lastRoundScore
  state.scoreDecayUnits = snapshot.scoreDecayUnits ?? 0
  state.turnCount = snapshot.turnCount ?? 0
  state.cumulativeRoundCount = snapshot.cumulativeRoundCount ?? 0
  state.winSummary = snapshot.winSummary ?? ""

  if (isFinishedStatus(snapshot.status)) {
    state.status = snapshot.status
    state.clock = null
    return
  }

  const totalCells = snapshot.mazeDimensions.area
  state.clock = restoreClock(totalCells, snapshot.remainingMs)

  // A reload only interrupts a round a human was actively playing. Interactive score decays with
  // elapsed time, so resuming a round nobody is watching would silently burn it — the pause waits
  // for the player to resume deliberately. Every other combination keeps the status it was saved
  // with: an agent-api round is charged per request rather than per second and has no human present
  // to press resume, so pausing it only strands the run, while a round already paused or awaiting
  // an agent has nothing to change. A restored running agent round resumes on its own because
  // bindActionDispatch calls syncCurrentPoller after this, which schedules the next turn as soon
  // as the status reads running.
  const restoredStatus: PersistedGameStatus =
    isInteractiveMode(state.controlMode) && isRunningStatus(snapshot.status)
      ? "paused"
      : snapshot.status

  // restoreClock hands back an already-running clock, so only a status that must not advance needs
  // stopping: a paused round waiting on the player, or one awaiting an agent. A restored running
  // round is left ticking, which keeps the destination blink animating.
  if (!isRunningStatus(restoredStatus)) {
    state.clock.pause()
  }

  state.status = restoredStatus
  state.winSummary = ""
  // Only a paused round offers a resume; running needs none and await-agent has its own path.
}

// startRoundWithDimensions initializes a round after viewport-safe dimensions have been selected.
function startRoundWithDimensions(dimensions: LevelDimensions, persist = true): boolean {
  const round = generateMaze(dimensions, state.wallWeight)
  const startCell = cellCoordinateFromGridPoint(round.startPosition)

  activeControlMode?.clearActionResult()
  applyRuntimeRoundState({
    level: dimensions.level,
    mazeDimensions: dimensions,
    maze: round.maze,
    startPosition: round.startPosition,
    playerPosition: round.startPosition,
    traversalHistory: [
      traversalHistoryEntry(startCell, runtime.interactivePlayerName, round.maze),
    ],
    finalPosition: round.finalPosition,
  })
  state.status = "running"
  state.lastRoundScore = 0
  state.scoreDecayUnits = 0
  state.turnCount = 0
  state.cumulativeRoundCount += 1
  state.winSummary = ""
  if (isAgentApiMode(state.controlMode)) {
    resetAgentRoundStats(state.level, state.cumulativeRoundCount)
  }

  const totalCells = dimensions.area
  // interactiveDecayIntervalPerCellMs sizes the clock for both modes — see restoreClock's comment
  // for why agent-api mode's clock only needs a self-consistent duration, not a mode-specific one.
  state.clock = new GameClock(totalCells * timing.interactiveDecayIntervalPerCellMs)
  state.score = calculateMaxScore(totalCells)
  if (persist) {
    persistNow("state")
  }
  return true
}

// startRound generates and initializes a fresh round for the requested level.
function startRound(level: number, persist = true): boolean {
  if (!runtimeElements) {
    return false
  }

  const terminalSize = getTerminalSize(runtimeElements)
  const dimensions = getMazeDimensions(level, terminalSize)

  if (!dimensions) {
    applyTooSmallState(level)
    if (persist) {
      persistNow("state")
    }
    return true
  }

  return startRoundWithDimensions(dimensions, persist)
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

  return startRoundWithDimensions(dimensions)
}

// restartGame clears persisted progress and restarts from level one.
function restartGame(): boolean {
  cancelScheduledRoundPersist()
  clearPersistedSnapshot(state.controlMode)
  activeControlMode?.clearActionResult()
  state.wallWeight = WALL_WEIGHTS[0]
  state.lastAttemptRetentionUnits = null
  state.bestWinRetentionUnits = null
  state.lastWinTraversalSpeedUnits = null
  state.bestWinTraversalSpeedUnits = null
  state.lastRoundScore = 0
  state.winSummary = ""
  return startRound(1, false)
}

// resumeOrProceed resumes a pause or advances from a finished round.
function resumeOrProceed(): boolean {
  if (isAwaitAgentStatus(state.status) && isAgentApiMode(state.controlMode)) {
    state.clock?.resume()
    state.status = "running"
    persistNow("state")
    return true
  }

  if (isPausedStatus(state.status) && state.clock) {
    state.clock.resume()
    state.status = "running"
    persistNow("round")
    return true
  }

  if (isWonStatus(state.status)) {
    return startRound(state.level + 1)
  }

  if (isLostStatus(state.status)) {
    return startRound(state.level)
  }

  return false
}

// awaitAgent pauses agent-api play before any HTTP agent has been explicitly enabled.
function awaitAgent(): boolean {
  if (!isAgentApiMode(state.controlMode) || !isRunningStatus(state.status)) {
    return false
  }

  state.clock?.pause()
  state.status = "await-agent"
  persistNow("state")
  return true
}

// pauseGame freezes the current round while preserving it for resume.
function pauseGame(): boolean {
  if (!canTrackDestinationVisibility(state)) {
    return false
  }

  state.clock.pause()
  state.status = "paused"
  persistNow("state")
  return true
}

// cycleWallWeight swaps the live maze walls to the next supported weight.
function cycleWallWeight(): boolean {
  const nextWeight = nextWallWeight(state.wallWeight)

  if (state.maze) {
    state.maze = reweightMaze(state.maze, state.wallWeight)
  }

  state.wallWeight = nextWeight
  persistNow("state")
  return true
}

// movePlayer applies one validated move step and leaves turn finalization to the active control mode.
function movePlayer(action: MoveAction, playerName: string): void {
  const moveEvaluation = resolvePlayerMove(state, action)
  if (!moveEvaluation.canMove) {
    return
  }

  state.playerPosition = moveEvaluation.nextGridPoint
  if (!traversalHistoryIncludes(state.traversalHistory, moveEvaluation.nextCell)) {
    state.traversalHistory.push(
      traversalHistoryEntry(moveEvaluation.nextCell, playerName, state.maze),
    )
  }
}

// dispatchControl gives the shared control layer the game-owned effects needed to run actions.
function dispatchControl(
  action: MazeAction,
  options: MazeActionDispatchOptions,
): MazeActionResult | null {
  let renderAfterDispatch = false
  const markForRender = (changed: boolean): void => {
    renderAfterDispatch ||= changed
  }

  const result = dispatchMazeAction(action, options, {
    state,
    pauseGame: () => { markForRender(pauseGame()) },
    awaitAgent: () => { markForRender(awaitAgent()) },
    restartGame: () => { markForRender(restartGame()) },
    resumeOrProceed: () => { markForRender(resumeOrProceed()) },
    cycleWallWeight: () => { markForRender(cycleWallWeight()) },
    movePlayer,
    recordActionResult: (actionResult) => {
      // The active control mode owns how it stores or forwards the latest replay result.
      activeControlMode?.recordActionResult(actionResult)
    },
  })

  if (renderAfterDispatch) {
    renderState()
  }

  return result
}

// handleResize revalidates the active or persisted round against the viewport. Also treated as
// too-small: pinch-zoom past viewport.pinchZoomTooCloseScale. Pinch-zoom never changes
// getBoundingClientRect()/layout viewport size (viewportFitStatus's only inputs), so it's invisible
// to that check on its own — window.visualViewport.scale is what actually reports it, and its
// resize event already drives this same handler.
function handleResize(): void {
  if (!runtimeElements) {
    return
  }

  const pinchZoomTooClose =
    (window.visualViewport?.scale ?? 1) > viewport.pinchZoomTooCloseScale

  let viewportRoundResolved = false
  // Forced straight to the worst case when pinched in too close: no maze-cell-grid size could fix
  // a visible area that's too small on its own terms, so there's nothing for redrawRoundForViewport
  // (below) to usefully retry against.
  const fitStatus = pinchZoomTooClose
    ? "too-small-all"
    : viewportFitStatus(state.mazeDimensions, getTerminalSize(runtimeElements))

  if (!isTooSmallStatus(state.status) && isTooSmallStatus(fitStatus)) {
    if (!pinchZoomTooClose && fitStatus !== "too-small-all" && redrawRoundForViewport(state.level)) {
      viewportRoundResolved = true
    } else {
      saveActiveRoundSnapshot(state.controlMode, state)
      applyTooSmallState(state.level)
      persistProgressOnly()
    }
  }

  // Also gated on !pinchZoomTooClose: restoring (or self-healing a fresh) round while still
  // pinched in past the threshold would just re-trigger too-small on the very next check, so stay
  // on the too-small screen until the zoom itself eases rather than churning through this each call.
  if (!viewportRoundResolved && !pinchZoomTooClose && isTooSmallStatus(state.status)) {
    const snapshot = loadPersistedSnapshotWithFallbacks(state.controlMode)
    const validRoundWasRestored = noValidRoundExists(snapshot.round) === false
    if (!validRoundWasRestored) {
      // No persisted round to restore, but the viewport may already be big enough for a fresh one —
      // e.g. a brand-new session that never had a round to lose, or one whose bootstrap measurement
      // was corrected after fonts finished loading. Self-heal instead of leaving the too-small screen
      // up until the user manually resets progress.
      redrawRoundForViewport(state.level)
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
  // getTerminalSize measures real font metrics (dom.ts); a bootstrap that runs before web fonts
  // finish loading can decide against a stale, fallback-font measurement. No resize event fires
  // when fonts swap in, so re-run the same check once they settle — same pattern as
  // page-chrome.ts's document.fonts?.ready.then(syncMenuMode).
  void document.fonts?.ready.then(handleResize)

  // This interval is the browser runtime heartbeat that refreshes score, blink, and loss state.
  window.setInterval(() => {
    refreshRunningRoundFrame({
      state,
      persistNow,
      renderState,
      calculateRoundScore,
    })
  }, Math.min(timing.interactiveDecayIntervalPerCellMs, timing.blinkIntervalMs) / 2)

  // Stored progress wins here; built-in fallbacks only apply when persisted data is absent or invalid.
  const persistedSnapshot = loadPersistedSnapshotWithFallbacks(controlMode.name)
  state.wallWeight = persistedSnapshot.preferences.wallWeight
  state.level = persistedSnapshot.preferences.level
  state.lastAttemptRetentionUnits = persistedSnapshot.preferences.lastAttemptRetentionUnits ?? null
  state.bestWinRetentionUnits = persistedSnapshot.preferences.bestWinRetentionUnits ?? null
  state.lastWinTraversalSpeedUnits = persistedSnapshot.preferences.lastWinTraversalSpeedUnits ?? null
  state.bestWinTraversalSpeedUnits = persistedSnapshot.preferences.bestWinTraversalSpeedUnits ?? null

  // If no valid persisted round exists, create a fresh maze for the current level.
  if (noValidRoundExists(persistedSnapshot.round)) {
    startRound(state.level)
  }
  renderState()

  // readState exposes the live game state so context tools can derive fresh facts on demand.
  const readState = (): State => state

  const commitTurnDeps = {
    state,
    applyWinSummary,
    calculateRoundScore,
    persistNow,
    renderState,
  }

  const commitTurn = isAgentApiMode(controlMode.name)
    ? (chargedMovesCount = 0) => commitAgentApiTurn({
      ...commitTurnDeps,
      chargedMovesCount,
    })
    : () => commitInteractiveTurn({
      ...commitTurnDeps,
      scheduleRoundPersistence,
    })

  controlMode.bindActionDispatch(dispatchControl, readState, commitTurn)
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
