import {
  canTrackDestinationVisibility,
  hasReachedTarget,
  isAgentApiMode,
  isInteractiveMode,
  isRunningStatus,
} from "../status"
import {
  calculateScoreRetentionUnits,
  resolveWinScore,
} from "../scoring"
import type { State } from "../types"

type PersistenceScope = "round" | "state"

type SharedResolutionDeps = {
  state: State
  calculateRoundScore: (totalCells: number) => number
  persistNow: (scope: PersistenceScope) => void
  renderState: () => void
}

type InteractiveTurnResolutionDeps = SharedResolutionDeps & {
  scheduleRoundPersistence: () => void
}

type AgentApiTurnResolutionDeps = SharedResolutionDeps & {
  chargedMovesCount: number
  traversalSpeedUnits?: number
}

type InProgressTurnResolutionDeps = Omit<SharedResolutionDeps, "persistNow" | "calculateRoundScore" | "renderState"> & {
  traversalSpeedUnits?: number
  persistCompletedTurn: () => void
  persistInProgressTurn: () => void
  totalCells: number
}

type RunningRoundFrameRefreshDeps = SharedResolutionDeps

const lastDestinationVisibleByState = new WeakMap<State, boolean>()
let skipNextFrameRender = false

// handleWin captures the completed-round score; agent-api also records its speed summary. Branches
// on the actual control mode rather than on whether traversalSpeedUnits happens to be present,
// since mode is the real signal - traversalSpeedUnits is only the data agent-api's branch needs to
// act on it. Falls back to the interactive metrics if agent-api mode somehow reaches this without
// it, the same way an unreachable-in-practice case is handled anywhere else in this file - a
// mid-round throw is worse than a plain, recoverable fallback.
function handleWin(state: State, totalCells: number, traversalSpeedUnits?: number): boolean {
  if (!hasReachedTarget(state)) {
    return false
  }

  state.lastRoundScore = state.score
  if (isAgentApiMode(state.controlMode) && traversalSpeedUnits !== undefined) {
    applyAgentWinSummary(state, totalCells, traversalSpeedUnits)
  } else {
    applyInteractiveWinMetrics(state, totalCells)
  }
  state.status = "won"
  return true
}

// applyAgentWinSummary stores the agent-api traversal-speed summary after an agent reaches the
// target. Takes the already-computed speed rather than the raw AgentPlayerStatus it's derived
// from - that's the only part of it this ever needed.
function applyAgentWinSummary(state: State, totalCells: number, traversalSpeedUnits: number): void {
  const winScore = resolveWinScore({
    bestWinRetentionUnits: state.bestWinRetentionUnits,
    bestWinTraversalSpeedUnits: state.bestWinTraversalSpeedUnits,
    controlMode: state.controlMode,
    lastAttemptRetentionUnits: state.lastAttemptRetentionUnits,
    lastWinTraversalSpeedUnits: state.lastWinTraversalSpeedUnits,
    score: state.score,
    totalCells,
    traversalSpeedUnits,
  })

  state.winSummary = winScore.winSummary
  state.lastAttemptRetentionUnits = winScore.lastAttemptRetentionUnits
  state.bestWinRetentionUnits = winScore.bestWinRetentionUnits
  state.lastWinTraversalSpeedUnits = winScore.lastWinTraversalSpeedUnits
  state.bestWinTraversalSpeedUnits = winScore.bestWinTraversalSpeedUnits
}

// applyInteractiveWinMetrics stores retention records without producing an agent-api win summary.
function applyInteractiveWinMetrics(state: State, totalCells: number): void {
  const retentionUnits = calculateScoreRetentionUnits(totalCells, state.score)
  state.lastAttemptRetentionUnits = retentionUnits
  state.bestWinRetentionUnits = state.bestWinRetentionUnits === null
    ? retentionUnits
    : Math.max(state.bestWinRetentionUnits, retentionUnits)
  state.winSummary = ""
}

// handleLoss captures the completed-round score only when score depletion has already been established.
function handleLoss(state: State, totalCells: number): boolean {
  if (!isRunningStatus(state.status) || totalCells === 0 || state.score > 0) {
    return false
  }

  state.status = "lost"
  state.lastRoundScore = state.score
  state.lastAttemptRetentionUnits = 0
  state.winSummary = ""
  return true
}

// resolveScoredTurnOutcome handles the shared post-score branch once a control mode has already
// brought state.score up to date for its own timing model.
function resolveScoredTurnOutcome({
  state,
  totalCells,
  persistCompletedTurn,
  persistInProgressTurn,
  traversalSpeedUnits,
}: InProgressTurnResolutionDeps): void {
  const roundCompleted = (
    handleWin(state, totalCells, traversalSpeedUnits) || handleLoss(state, totalCells)
  )

  if (roundCompleted) {
    persistCompletedTurn()
    return
  }

  persistInProgressTurn()
}

// suppressNextFrameRender lets an explicit turn commit own the immediate UI update while
// the next heartbeat still refreshes score/blink bookkeeping without repainting the same state.
function suppressNextFrameRender(state: State): void {
  skipNextFrameRender = isRunningStatus(state.status)
}

function currentDestinationVisibility(state: State, isDestinationVisible: boolean): boolean {
  if (!isDestinationVisible || !state.clock) {
    return true
  }
  // blink() (clock.ts) already accounts for prefers-reduced-motion itself, returning a steady
  // "visible" instead of toggling.
  return state.clock.blink()
}

// shouldDrawDestination is the single source of truth for the target blink phase. Rendering calls
// it to decide visibility, and that same sample seeds refresh bookkeeping so the next heartbeat
// does not repaint just to learn what the already-rendered blink phase was.
export function shouldDrawDestination(state: State): boolean {
  const isDestinationVisible = canTrackDestinationVisibility(state)
  const visible = currentDestinationVisibility(state, isDestinationVisible)
  if (isDestinationVisible) {
    lastDestinationVisibleByState.set(state, visible)
  } else {
    lastDestinationVisibleByState.delete(state)
  }

  return visible
}

function destinationVisibilityNotChanged(state: State, isDestinationVisible: boolean): boolean {
  const nextDestinationVisible = currentDestinationVisibility(state, isDestinationVisible)
  const lastDestinationVisible = lastDestinationVisibleByState.get(state) ?? null
  const destinationVisibilityNotChanged = nextDestinationVisible === lastDestinationVisible
  if (!destinationVisibilityNotChanged) {
    lastDestinationVisibleByState.set(state, nextDestinationVisible)
  }

  return destinationVisibilityNotChanged
}

// refreshRunningRoundFrame handles one interval-driven refresh of a running round: interactive mode
// recomputes elapsed-time score here, both modes share the same depleted-score loss handoff, and
// the destination blink can still trigger a render even when no gameplay state changed.
export function refreshRunningRoundFrame({
  state,
  persistNow,
  renderState,
  calculateRoundScore,
}: RunningRoundFrameRefreshDeps): void {
  const totalCells = state.mazeDimensions?.area ?? 0
  const isDestinationVisible = canTrackDestinationVisibility(state)

  if (!isDestinationVisible || totalCells === 0) {
    lastDestinationVisibleByState.delete(state)
    skipNextFrameRender = false
    return
  }

  const previousScore = state.score
  if (isInteractiveMode(state.controlMode)) {
    state.score = calculateRoundScore(totalCells)
  }

  if (handleLoss(state, totalCells)) {
    skipNextFrameRender = false
    persistNow("state")
    renderState()
    return
  }

  const skipRender = skipNextFrameRender
  if (skipRender) {
    skipNextFrameRender = false
  }

  const scoreNotChanged = state.score === previousScore
  const destinationNotChanged = destinationVisibilityNotChanged(state, isDestinationVisible)
  if ((scoreNotChanged && destinationNotChanged) || skipRender) {
    return
  }

  renderState()
}

// commitInteractiveTurn is the interactive mode's single post-move resolution point: by the time
// it runs, movement/traversal history have already been applied, so this function recalculates the
// live elapsed-time score, checks whether the new position reached the destination, falls through
// to shared loss handling if the score is now depleted, or
// schedules normal round persistence for an in-progress turn. Keeping that branching here lets
// movePlayer stay a pure state mutator.
export function commitInteractiveTurn({
  state,
  calculateRoundScore,
  persistNow,
  scheduleRoundPersistence,
  renderState,
}: InteractiveTurnResolutionDeps): void {
  const totalCells = state.mazeDimensions?.area ?? 0
  if (!isInteractiveMode(state.controlMode) || totalCells === 0) {
    return
  }

  if (state.clock) {
    state.score = calculateRoundScore(totalCells)
  }

  resolveScoredTurnOutcome({
    state,
    totalCells,
    persistCompletedTurn: () => {
      persistNow("state")
    },
    persistInProgressTurn: scheduleRoundPersistence,
  })
  renderState()
  suppressNextFrameRender(state)
}

// commitAgentApiTurn is the agent-api mode's single post-batch resolution point: replay has
// already applied every valid move from the model response, and this function increments the
// agent-turn counters, adds the batch's charged decay units, recomputes score from that total,
// checks whether replay ended on the destination, optionally finalizes the completed-round win
// state, delegates depleted-score cases to shared loss handling, and otherwise persists/renders
// the still-running round once for the whole batch rather than incrementally per move.
export function commitAgentApiTurn({
  state,
  calculateRoundScore,
  persistNow,
  renderState,
  chargedMovesCount,
  traversalSpeedUnits,
}: AgentApiTurnResolutionDeps): void {
  const totalCells = state.mazeDimensions?.area ?? 0
  if (!isAgentApiMode(state.controlMode) || totalCells === 0) {
    return
  }

  state.turnCount += 1
  state.scoreDecayUnits += chargedMovesCount
  state.score = calculateRoundScore(totalCells)

  resolveScoredTurnOutcome({
    state,
    totalCells,
    traversalSpeedUnits,
    persistCompletedTurn: () => {
      persistNow("state")
    },
    persistInProgressTurn: () => {
      persistNow("round")
    },
  })
  renderState()
  suppressNextFrameRender(state)
}
