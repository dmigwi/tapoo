import { CONFIG } from "./config"
import { resolveTraversalSpeedClass, traversalSpeedUnitsToDisplay, capitalize } from "./agent/efficiency"
import type {
  AgentSpeedBestComparison,
  AgentSpeedPreviousComparison,
  MazeControlModeName,
  SummaryComparisonTemplates,
  WinSummaryBestComparison,
  WinSummaryPreviousComparison,
} from "./types"

const { messages, runtime, scoring, timing } = CONFIG

type WinScoreInput = {
  bestWinRetentionUnits: number | null
  bestWinTraversalSpeedUnits: number | null
  controlMode: MazeControlModeName
  lastAttemptRetentionUnits: number | null
  lastWinTraversalSpeedUnits: number | null
  score: number
  totalCells: number
  traversalSpeedUnits: number
}

type WinScoreResult = {
  bestWinRetentionUnits: number
  bestWinTraversalSpeedUnits: number | null
  lastAttemptRetentionUnits: number
  lastWinTraversalSpeedUnits: number | null
  winSummary: string
}

// calculateMaxScore returns the full score budget for one maze before any decay applies.
export function calculateMaxScore(totalCells: number): number {
  return totalCells * scoring.budgetMultiplier
}

// calculateElapsedDecayUnits converts elapsed wall-clock time into the decay units charged so far
// for an interactive round — the same raw figure calculateElapsedScore subtracts from the max score.
export function calculateElapsedDecayUnits(elapsedMs: number, decayIntervalPerCellMs: number): number {
  return Math.floor((elapsedMs * timing.scoreDecayRate) / decayIntervalPerCellMs)
}

// calculateElapsedScore converts elapsed time into the remaining score for an interactive round.
export function calculateElapsedScore(
  totalCells: number,
  elapsedMs: number,
  decayIntervalPerCellMs: number,
): number {
  const maxScore = calculateMaxScore(totalCells)
  const elapsedDecayUnits = calculateElapsedDecayUnits(elapsedMs, decayIntervalPerCellMs)

  return Math.max(0, maxScore - elapsedDecayUnits)
}

// calculateScoreAfterDecay converts explicit score-decay units into the remaining agent-api score.
export function calculateScoreAfterDecay(
  totalCells: number,
  scoreDecayUnits: number,
): number {
  const maxScore = calculateMaxScore(totalCells)
  return Math.max(0, maxScore - scoreDecayUnits * timing.scoreDecayRate)
}

// calculateScoreRetentionUnits normalizes a score into fixed-point retention units.
export function calculateScoreRetentionUnits(
  totalCells: number,
  score: number,
): number {
  const maxScore = calculateMaxScore(totalCells)
  if (maxScore <= 0) {
    return 0
  }

  const halfMaxScoreRoundingOffset = Math.floor(maxScore / 2)
  // retentionFullScaleUnits represents 100%, keeping retention precise without floating points.
  const scaledRetentionUnits = score * scoring.retentionFullScaleUnits + halfMaxScoreRoundingOffset
  const roundedRetentionUnits = Math.floor(scaledRetentionUnits / maxScore)

  return clampRetentionUnits(roundedRetentionUnits)
}

// formatTraversalSpeedLabel renders the speed a round actually achieved together with the
// classification it earned, e.g. "3.1230 (Trailblazer)". Only an achieved speed carries a
// classification — a delta between two rounds is a difference, not a pace, so deltas stay bare
// numbers.
function formatTraversalSpeedLabel(traversalSpeedUnits: number): string {
  const speedClass = resolveTraversalSpeedClass(traversalSpeedUnits)
  const speedValue = traversalSpeedUnitsToDisplay(traversalSpeedUnits)

  return `${speedValue} (${capitalize(speedClass)})`
}

// retentionUnitsToDisplayPercent converts fixed-point retention units into UI percentage text.
export function retentionUnitsToDisplayPercent(retentionUnits: number): number {
  const displayedPercent = Math.round(
    (retentionUnits * scoring.percentScale) /
      scoring.retentionFullScaleUnits,
  )

  return Math.max(0, Math.min(scoring.percentScale, displayedPercent))
}

// retentionUnitDeltaToDurationMs projects retention differences onto one round's duration.
export function retentionUnitDeltaToDurationMs(
  deltaRetentionUnits: number,
  levelDurationMs: number,
): number {
  return Math.round(
    (deltaRetentionUnits * levelDurationMs) /
      scoring.retentionFullScaleUnits,
  )
}

// buildWinSummary assembles the final score-retention summary shown after an interactive win.
export function buildWinSummary(
  currentRetentionUnits: number,
  lastAttemptRetentionUnits: number | null,
  bestWinRetentionUnits: number | null,
  levelDurationMs: number,
): string {
  const previous = compareWinSummaryPrevious(currentRetentionUnits, lastAttemptRetentionUnits, levelDurationMs)
  const best = compareWinSummaryBest(currentRetentionUnits, bestWinRetentionUnits, levelDurationMs)
  const template = selectWinSummaryTemplate(previous.comparison, best.comparison)
  return replaceWinSummaryDelta(template, previous.delta, best.delta)
}

// buildAgentWinSummary assembles the traversal-speed summary shown after an agent-api win.
export function buildAgentWinSummary(
  currentSpeedUnits: number,
  lastWinTraversalSpeedUnits: number | null,
  bestWinTraversalSpeedUnits: number | null,
): string {
  const previous = compareAgentSpeedPrevious(currentSpeedUnits, lastWinTraversalSpeedUnits)
  const best = compareAgentSpeedBest(currentSpeedUnits, bestWinTraversalSpeedUnits)
  const template = selectAgentWinSummaryTemplate(previous.comparison, best.comparison)
  const comparison = replaceWinSummaryDelta(template, previous.delta, best.delta)

  // Lead with the pace actually achieved so the headline number is comparable across every maze
  // size, then follow it with how that pace stacks up against the stored records.
  return `${formatTraversalSpeedLabel(currentSpeedUnits)} — ${comparison}`
}

// resolveWinScore converts one completed round into the summary and stored win metrics.
export function resolveWinScore(input: WinScoreInput): WinScoreResult {
  // Retention is normalized first so different maze sizes can be compared consistently.
  const currentRetentionUnits = calculateScoreRetentionUnits(input.totalCells, input.score)
  // Best retention is shared by both control modes even though their summary wording differs.
  const bestWinRetentionUnits = selectBestRetentionUnits(currentRetentionUnits, input.bestWinRetentionUnits)

  if (input.controlMode === runtime.controlModes.interactive) {
    // Interactive wins keep retention metrics only; win-summary text is agent-api specific.
    return {
      bestWinRetentionUnits,
      bestWinTraversalSpeedUnits: input.bestWinTraversalSpeedUnits,
      lastAttemptRetentionUnits: currentRetentionUnits,
      lastWinTraversalSpeedUnits: input.lastWinTraversalSpeedUnits,
      winSummary: "",
    }
  }

  // Agent-api wins report traversal speed rather than the request count they used to. These
  // records survive level progression, and maze area grows with every level, so request counts
  // from two different levels were never comparable — a bigger maze needs more requests no matter
  // how well it was played, which made "new record" partly a measure of maze size. Speed is a
  // rate, so growing the maze grows both the cells reached and the units spent and leaves the
  // comparison intact. It also separates a batching run from a single-stepping one that happened
  // to need the same number of turns.
  return {
    bestWinRetentionUnits,
    bestWinTraversalSpeedUnits: selectBestAgentSpeedUnits(
      input.traversalSpeedUnits,
      input.bestWinTraversalSpeedUnits,
    ),
    lastAttemptRetentionUnits: currentRetentionUnits,
    lastWinTraversalSpeedUnits: input.traversalSpeedUnits,
    winSummary: buildAgentWinSummary(
      input.traversalSpeedUnits,
      input.lastWinTraversalSpeedUnits,
      input.bestWinTraversalSpeedUnits,
    ),
  }
}

// clampRetentionUnits keeps restored or calculated retention inside the supported fixed-point range.
function clampRetentionUnits(retentionUnits: number): number {
  return Math.max( 0,  Math.min(scoring.retentionFullScaleUnits, retentionUnits))
}

// selectBestRetentionUnits preserves the highest normalized score retention seen so far.
function selectBestRetentionUnits(
  currentRetentionUnits: number,
  bestWinRetentionUnits: number | null,
): number {
  if (bestWinRetentionUnits === null || currentRetentionUnits > bestWinRetentionUnits) {
    return currentRetentionUnits
  }

  return bestWinRetentionUnits
}

// selectBestAgentSpeedUnits preserves the highest solved traversal speed seen so far. Note the
// direction: the request count this replaced was better when lower, speed is better when higher.
function selectBestAgentSpeedUnits(
  currentSpeedUnits: number,
  bestWinTraversalSpeedUnits: number | null,
): number {
  if (bestWinTraversalSpeedUnits === null || currentSpeedUnits > bestWinTraversalSpeedUnits) {
    return currentSpeedUnits
  }

  return bestWinTraversalSpeedUnits
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

// formatWinSummaryRetentionUnitDelta projects retention differences back into time.
function formatWinSummaryRetentionUnitDelta(
  deltaRetentionUnits: number,
  levelDurationMs: number,
): string {
  const deltaMs = retentionUnitDeltaToDurationMs(deltaRetentionUnits, levelDurationMs)
  return formatWinSummaryDuration(deltaMs)
}

// compareWinSummaryPrevious compares the current win against the last attempt.
function compareWinSummaryPrevious(
  currentRetentionUnits: number,
  lastAttemptRetentionUnits: number | null,
  levelDurationMs: number,
): { comparison: WinSummaryPreviousComparison; delta: string } {
  if (lastAttemptRetentionUnits === null) {
    return { comparison: "none", delta: "" }
  }

  if (currentRetentionUnits > lastAttemptRetentionUnits) {
    return {
      comparison: "faster",
      delta: formatWinSummaryRetentionUnitDelta(
        currentRetentionUnits - lastAttemptRetentionUnits,
        levelDurationMs,
      ),
    }
  }

  if (currentRetentionUnits < lastAttemptRetentionUnits) {
    return {
      comparison: "slower",
      delta: formatWinSummaryRetentionUnitDelta(
        lastAttemptRetentionUnits - currentRetentionUnits,
        levelDurationMs,
      ),
    }
  }

  return { comparison: "matched", delta: "" }
}

// compareWinSummaryBest compares the current win against the best retained score.
function compareWinSummaryBest(
  currentRetentionUnits: number,
  bestWinRetentionUnits: number | null,
  levelDurationMs: number,
): { comparison: WinSummaryBestComparison; delta: string } {
  if (
    bestWinRetentionUnits === null ||
    currentRetentionUnits > bestWinRetentionUnits
  ) {
    return { comparison: "new-record", delta: "" }
  }

  if (currentRetentionUnits < bestWinRetentionUnits) {
    return {
      comparison: "behind-best",
      delta: formatWinSummaryRetentionUnitDelta(
        bestWinRetentionUnits - currentRetentionUnits,
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
  return template.replace("{delta}", delta).replace("{bestDelta}", bestDelta)
}

// selectWinSummaryTemplate picks the right summary copy for the comparison result.
function selectWinSummaryTemplate(
  previousComparison: WinSummaryPreviousComparison,
  bestComparison: WinSummaryBestComparison,
): string {
  // No previous record means no best record either — restore keeps the pair atomic — so the only
  // reachable outcome is a new record, with no delta to compare against.
  if (previousComparison === "none") {
    return messages.winSummary.noPrevious
  }

  let templates: SummaryComparisonTemplates

  switch (previousComparison) {
    case "faster":
      templates = messages.winSummary.fasterPrevious
      break
    case "slower":
      templates = messages.winSummary.slowerPrevious
      break
    case "matched":
      templates = messages.winSummary.matchedPrevious
      break
  }

  return selectBestComparisonTemplate(templates, bestComparison)
}

// compareAgentSpeedPrevious compares the current solved round against the previous solved speed.
function compareAgentSpeedPrevious(
  currentSpeedUnits: number,
  lastWinTraversalSpeedUnits: number | null,
): { comparison: AgentSpeedPreviousComparison; delta: string } {
  if (lastWinTraversalSpeedUnits === null) {
    return { comparison: "none", delta: "" }
  }

  if (currentSpeedUnits > lastWinTraversalSpeedUnits) {
    return {
      comparison: "faster",
      delta: traversalSpeedUnitsToDisplay(currentSpeedUnits - lastWinTraversalSpeedUnits),
    }
  }

  if (currentSpeedUnits < lastWinTraversalSpeedUnits) {
    return {
      comparison: "slower",
      delta: traversalSpeedUnitsToDisplay(lastWinTraversalSpeedUnits - currentSpeedUnits),
    }
  }

  return { comparison: "matched", delta: "" }
}

// compareAgentSpeedBest compares the current solved round against the best solved speed.
function compareAgentSpeedBest(
  currentSpeedUnits: number,
  bestWinTraversalSpeedUnits: number | null,
): { comparison: AgentSpeedBestComparison; delta: string } {
  if (bestWinTraversalSpeedUnits === null || currentSpeedUnits > bestWinTraversalSpeedUnits) {
    return { comparison: "new-record", delta: "" }
  }

  if (currentSpeedUnits < bestWinTraversalSpeedUnits) {
    return {
      comparison: "behind-best",
      delta: traversalSpeedUnitsToDisplay(bestWinTraversalSpeedUnits - currentSpeedUnits),
    }
  }

  return { comparison: "matched-best", delta: "" }
}

// selectAgentWinSummaryTemplate chooses the request-count summary shown after an agent-api win.
function selectAgentWinSummaryTemplate(
  previousComparison: AgentSpeedPreviousComparison,
  bestComparison: AgentSpeedBestComparison,
): string {
  // Same as the interactive path: a first result has nothing to be behind.
  if (previousComparison === "none") {
    return messages.agentWinSummary.noPrevious
  }

  let templates: SummaryComparisonTemplates

  switch (previousComparison) {
    case "faster":
      templates = messages.agentWinSummary.fasterPrevious
      break
    case "slower":
      templates = messages.agentWinSummary.slowerPrevious
      break
    case "matched":
      templates = messages.agentWinSummary.matchedPrevious
      break
  }

  return selectBestComparisonTemplate(templates, bestComparison)
}

// selectBestComparisonTemplate resolves the shared new/matched/behind-best template group.
function selectBestComparisonTemplate(
  templates: SummaryComparisonTemplates,
  bestComparison: WinSummaryBestComparison | AgentSpeedBestComparison,
): string {
  if (bestComparison === "new-record") {
    return templates.newRecord
  }

  if (bestComparison === "matched-best") {
    return templates.matchedBest
  }

  return templates.behindBest
}
