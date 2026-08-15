import {
  isAgentApiMode,
  isInteractiveMode,
  isRunningStatus,
} from "../status"
import type {
  RenderGridPoint,
  State,
} from "../types"

type PersistenceScope = "round" | "state"

type SharedResolutionDeps = {
  state: State
  applyWinSummary: (totalCells: number) => void
  calculateRoundScore: (totalCells: number) => number
  persistNow: (scope: PersistenceScope) => void
  renderState: () => void
}

type InteractiveTurnResolutionDeps = SharedResolutionDeps & {
  handleLoss: () => void
  scheduleRoundPersistence: () => void
}

type AgentApiTurnResolutionDeps = SharedResolutionDeps & {
  handleLoss: () => void
}

type LossResolutionDeps = Omit<SharedResolutionDeps, "applyWinSummary">

type InProgressTurnResolutionDeps = Omit<SharedResolutionDeps, "persistNow" | "calculateRoundScore"> & {
  handleLoss: () => void
  persistCompletedTurn: () => void
  persistInProgressTurn: () => void
}

type RunningRoundFrameRefreshDeps = LossResolutionDeps & {
  lastBlinkVisible: boolean | null
}

// positionsEqual compares two rendered maze-grid points without allocating helper objects.
function positionsEqual(left: RenderGridPoint, right: RenderGridPoint): boolean {
  return left.x === right.x && left.y === right.y
}

// hasReachedDestination reads the live maze position without mutating status, so move replay and
// turn finalization can answer the same question without depending on commit timing.
export function hasReachedDestination(state: State): boolean {
  if (
    !state.playerPosition ||
    !state.finalPosition ||
    !positionsEqual(state.playerPosition, state.finalPosition)
  ) {
    return false
  }

  return true
}

// handleWinCheck updates State once movement has already been applied and the destination may
// have been reached.
export function handleWinCheck(state: State): boolean {
  if (!hasReachedDestination(state)) {
    return false
  }

  state.status = "won"
  return true
}

// handleLoss finalizes a round once score depletion has already been established by the caller.
export function handleLoss({
  state,
  calculateRoundScore,
  persistNow,
  renderState,
}: LossResolutionDeps): void {
  const totalCells = state.mazeDimensions?.area ?? 0
  if (!isRunningStatus(state.status) || totalCells === 0) {
    return
  }

  state.score = calculateRoundScore(totalCells)
  state.status = "lost"
  state.lastRoundScore = state.score
  state.lastAttemptRetentionUnits = 0
  state.winSummary = ""
  persistNow("state")
  renderState()
}

// finalizeWonRound captures the authoritative completed-round score and derives the win summary
// after the caller has already updated state.score for its own control-model timing.
function finalizeWonRound(state: State, totalCells: number, applyWinSummary: (totalCells: number) => void): void {
  state.lastRoundScore = state.score
  applyWinSummary(totalCells)
  state.status = "won"
}

// resolveScoredTurnOutcome handles the shared post-score branch once a control mode has already
// brought state.score up to date for its own timing model.
function resolveScoredTurnOutcome({
  state,
  applyWinSummary,
  renderState,
  handleLoss,
  persistCompletedTurn,
  persistInProgressTurn,
}: InProgressTurnResolutionDeps, totalCells: number): void {
  if (handleWinCheck(state)) {
    finalizeWonRound(state, totalCells, applyWinSummary)
    persistCompletedTurn()
    renderState()
    return
  }

  if (isRunningStatus(state.status) && state.score <= 0) {
    handleLoss()
    return
  }

  persistInProgressTurn()
  renderState()
}

// refreshRunningRoundFrame handles one interval-driven refresh of a running round: interactive mode
// recomputes elapsed-time score here, both modes share the same depleted-score loss handoff, and
// the destination blink can still trigger a render even when no gameplay state changed.
export function refreshRunningRoundFrame({
  state,
  calculateRoundScore,
  persistNow,
  renderState,
  lastBlinkVisible,
}: RunningRoundFrameRefreshDeps): void {
  const totalCells = state.mazeDimensions?.area ?? 0
  if (!isRunningStatus(state.status) || !state.clock || totalCells === 0) {
    return
  }

  const previousScore = state.score
  if (isInteractiveMode(state.controlMode)) {
    state.score = calculateRoundScore(totalCells)
  }

  if (state.score <= 0) {
    handleLoss({
      state,
      calculateRoundScore,
      persistNow,
      renderState,
    })
    return
  }

  const nextBlinkVisible = state.clock.blink()
  const scoreChanged = state.score !== previousScore
  const blinkChanged = nextBlinkVisible !== lastBlinkVisible
  if (scoreChanged || blinkChanged) {
    renderState()
  }
}

// commitInteractiveTurn is the interactive mode's single post-move resolution point: by the time
// it runs, movement/traversal history have already been applied, so this function recalculates the
// live elapsed-time score, checks whether the new position reached the destination, optionally
// finalizes a win summary, falls through to shared loss handling if the score is now depleted, or
// schedules normal round persistence for an in-progress turn. Keeping that branching here lets
// movePlayer stay a pure state mutator.
export function commitInteractiveTurn({
  state,
  applyWinSummary,
  calculateRoundScore,
  handleLoss,
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
    applyWinSummary,
    renderState,
    handleLoss,
    persistCompletedTurn: () => {
      persistNow("state")
    },
    persistInProgressTurn: scheduleRoundPersistence,
  }, totalCells)
}

// commitAgentApiTurn is the agent-api mode's single post-batch resolution point: replay has
// already applied every valid move from the model response, and this function increments the
// agent-turn counters, adds the batch's charged decay units, recomputes score from that total,
// checks whether replay ended on the destination, optionally finalizes the completed-round win
// state, delegates depleted-score cases to shared loss handling, and otherwise persists/renders
// the still-running round once for the whole batch rather than incrementally per move.
export function commitAgentApiTurn(
  chargedMovesCount: number,
  {
    state,
    applyWinSummary,
    calculateRoundScore,
    persistNow,
    renderState,
    handleLoss,
  }: AgentApiTurnResolutionDeps,
): void {
  const totalCells = state.mazeDimensions?.area ?? 0
  if (!isAgentApiMode(state.controlMode) || totalCells === 0) {
    return
  }

  state.turnCount += 1
  state.scoreDecayUnits += chargedMovesCount
  state.score = calculateRoundScore(totalCells)

  resolveScoredTurnOutcome({
    state,
    applyWinSummary,
    renderState,
    handleLoss,
    persistCompletedTurn: () => {
      persistNow("state")
    },
    persistInProgressTurn: () => {
      persistNow("round")
    },
  }, totalCells)
}
