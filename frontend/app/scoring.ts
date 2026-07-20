import { CONFIG } from "./config"
import type {
  AgentRequestBestComparison,
  AgentRequestPreviousComparison,
  MazeControlModeName,
  SummaryComparisonTemplates,
  WinSummaryBestComparison,
  WinSummaryPreviousComparison,
} from "./types"

const { messages, runtime, scoring, timing } = CONFIG

type WinScoreInput = {
  agentRequestCount: number
  bestWinRequestCount: number | null
  bestWinRetentionUnits: number | null
  controlMode: MazeControlModeName
  lastAttemptRetentionUnits: number | null
  lastWinRequestCount: number | null
  score: number
  totalCells: number
}

type WinScoreResult = {
  bestWinRequestCount: number | null
  bestWinRetentionUnits: number
  lastAttemptRetentionUnits: number
  lastWinRequestCount: number | null
  winSummary: string
}

// calculateMaxScore returns the full score budget for one maze before any decay applies.
export function calculateMaxScore(totalCells: number): number {
  return totalCells * scoring.budgetMultiplier
}

// calculateElapsedScore converts elapsed time into the remaining score for an interactive round.
export function calculateElapsedScore(
  totalCells: number,
  elapsedMs: number,
  decayIntervalPerCellMs: number,
): number {
  const maxScore = calculateMaxScore(totalCells)
  const elapsedDecayUnits = Math.floor(
    (elapsedMs * timing.scoreDecayRate) / decayIntervalPerCellMs,
  )

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
  const scaledRetentionUnits =
    score * scoring.retentionFullScaleUnits + halfMaxScoreRoundingOffset
  const roundedRetentionUnits = Math.floor(scaledRetentionUnits / maxScore)

  return clampRetentionUnits(roundedRetentionUnits)
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
  const previous = compareWinSummaryPrevious(
    currentRetentionUnits,
    lastAttemptRetentionUnits,
    levelDurationMs,
  )
  const best = compareWinSummaryBest(
    currentRetentionUnits,
    bestWinRetentionUnits,
    levelDurationMs,
  )
  const template = selectWinSummaryTemplate(
    previous.comparison,
    best.comparison,
  )

  return replaceWinSummaryDelta(template, previous.delta, best.delta)
}

// buildAgentWinSummary assembles the request-count summary shown after an agent-api win.
export function buildAgentWinSummary(
  currentRequests: number,
  lastWinRequestCount: number | null,
  bestWinRequestCount: number | null,
): string {
  const previous = compareAgentRequestsPrevious(currentRequests, lastWinRequestCount)
  const best = compareAgentRequestsBest(currentRequests, bestWinRequestCount)
  const template = selectAgentWinSummaryTemplate(previous.comparison, best.comparison)

  return replaceWinSummaryDelta(template, previous.delta, best.delta)
}

// resolveWinScore converts one completed round into the summary and stored win metrics.
export function resolveWinScore(input: WinScoreInput): WinScoreResult {
  // Retention is normalized first so different maze sizes can be compared consistently.
  const currentRetentionUnits = calculateScoreRetentionUnits(input.totalCells, input.score)
  // Best retention is shared by both control modes even though their summary wording differs.
  const bestWinRetentionUnits = selectBestRetentionUnits(currentRetentionUnits, input.bestWinRetentionUnits)

  if (input.controlMode === runtime.controlModes.interactive) {
    // Interactive wins translate retention deltas back into time-like progress messages.
    return {
      bestWinRequestCount: input.bestWinRequestCount,
      bestWinRetentionUnits,
      lastAttemptRetentionUnits: currentRetentionUnits,
      lastWinRequestCount: input.lastWinRequestCount,
      winSummary: buildWinSummary(
        currentRetentionUnits,
        input.lastAttemptRetentionUnits,
        input.bestWinRetentionUnits,
        input.totalCells * timing.interactiveCoreDecayIntervalPerCellMs,
      ),
    }
  }

  // Agent-api wins report request efficiency because agents can submit batched predictions.
  return {
    bestWinRequestCount: selectBestAgentRequestCount(
      input.agentRequestCount,
      input.bestWinRequestCount,
    ),
    bestWinRetentionUnits,
    lastAttemptRetentionUnits: currentRetentionUnits,
    lastWinRequestCount: input.agentRequestCount,
    winSummary: buildAgentWinSummary(
      input.agentRequestCount,
      input.lastWinRequestCount,
      input.bestWinRequestCount,
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

// selectBestAgentRequestCount preserves the lowest solved request count seen so far.
function selectBestAgentRequestCount(
  currentRequests: number,
  bestWinRequestCount: number | null,
): number {
  if (bestWinRequestCount === null || currentRequests < bestWinRequestCount) {
    return currentRequests
  }

  return bestWinRequestCount
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
  let templates: SummaryComparisonTemplates

  switch (previousComparison) {
    case "none":
      templates = messages.winSummary.noPrevious
      break
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
  let templates: SummaryComparisonTemplates

  switch (previousComparison) {
    case "none":
      templates = messages.agentWinSummary.noPrevious
      break
    case "fewer":
      templates = messages.agentWinSummary.fewerPrevious
      break
    case "more":
      templates = messages.agentWinSummary.morePrevious
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
  bestComparison: WinSummaryBestComparison | AgentRequestBestComparison,
): string {
  if (bestComparison === "new-record") {
    return templates.newRecord
  }

  if (bestComparison === "matched-best") {
    return templates.matchedBest
  }

  return templates.behindBest
}
