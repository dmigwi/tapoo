import { CONFIG } from "../config"
import type { AgentApiSeatConfig, AgentPlayerStatus, TraversalHistoryEntry } from "../types"

const { scoring } = CONFIG
const traversalSpeedDisplayDecimals = String(scoring.traversalSpeedScaleUnits).length - 1

// TraversalSpeedClass names the traversal-speed group the rate falls into, not just a grade, so
// the classification itself carries the corrective instruction: climb out of backtracker, sustain
// trailblazer.
export type TraversalSpeedClass = "backtracker" | "navigator" | "trailblazer"

// TraversalSpeedMetrics are the raw counts behind the traversal speed, exposed to the model
// directly so it can compute and verify the rate/classification itself instead of treating the
// classification as an unexplained label. playerUniqueCellsVisited is scoped to this specific
// agent (see countDistinctCellsForAgent) - it alone feeds the traversal-speed rate. allUniqueCellsVisited
// is the same traversalHistory's total length: every cell any player has reached this level,
// regardless of who got there first - a separate, non-agent-scoped figure that lets the model
// gauge how much of mazeDimensions.totalMazeCells has been collectively explored so far, distinct
// from its own individual progress. playerTurnsTaken is this specific agent's own completed
// prediction-turn count for the current level (agent.turnCount, incremented only on that agent's
// own commits - see recordAgentTurnStats in storage.ts) - not the round's shared total, which is
// State.turnCount / agent.levelTurnCount. Neither playerTurnsTaken nor allUniqueCellsVisited feeds
// the rate: a turn is charged the same decay whether it carried one move or many, so dividing by
// requests would leave the rate blind to the batching it is meant to reward, and the rate is about
// this agent's own spend, not the team's combined exploration.
export type TraversalSpeedMetrics = {
  playerUniqueCellsVisited: number
  allUniqueCellsVisited: number
  decayUnitsCharged: number
  playerTurnsTaken: number
}

// countDistinctCellsForAgent counts traversalHistory entries first attributed to this agent's
// playerName. traversalHistory only records a cell's first visit, so this is the agent's unique
// progress, not a raw move count.
function countDistinctCellsForAgent(
  traversalHistory: readonly TraversalHistoryEntry[],
  agent: AgentApiSeatConfig,
): number {
  return traversalHistory.filter((entry) => entry.playerName === agent.playerName).length
}

// getTraversalSpeedMetrics returns the raw counts behind the rate.
export function getTraversalSpeedMetrics(
  traversalHistory: readonly TraversalHistoryEntry[],
  agent: AgentApiSeatConfig,
): TraversalSpeedMetrics {
  return {
    playerUniqueCellsVisited: countDistinctCellsForAgent(traversalHistory, agent),
    // traversalHistory records only first visits (see countDistinctCellsForAgent), so its length
    // is already every distinct cell any player has reached this level - no further dedup needed.
    allUniqueCellsVisited: traversalHistory.length,
    decayUnitsCharged: agent.decayUnitsCharged ?? 0,
    playerTurnsTaken: agent.turnCount ?? 0,
  }
}

// resolveStatusSpeedClass is the single source of truth for classifying any playerUniqueCellsVisited
// / decayUnitsCharged pair. It compares the raw counts directly so formatting precision can never
// turn a just-below-baseline Backtracker into Navigator or hide a just-above-baseline Trailblazer.
// Nothing charged yet defaults to trailblazer - not the neutral baseline - so play starts already
// primed to predict multi-move sequences, matching the classification stated in an agent's first
// prompt. That same guard keeps the rate below from dividing by zero.
export function resolveStatusSpeedClass(uniqueCellsVisited: number, decayUnitsCharged: number): TraversalSpeedClass {
  if (!decayUnitsCharged) {
    return "trailblazer"
  }
  if (uniqueCellsVisited < decayUnitsCharged) {
    return "backtracker"
  }
  if (uniqueCellsVisited > decayUnitsCharged) {
    return "trailblazer"
  }
  return "navigator"
}

// resolveAgentTraversalSpeedClass is the single source of truth for an agent's current speed
// classification, everywhere one is shown or sent.
export function resolveAgentTraversalSpeedClass(
  traversalHistory: readonly TraversalHistoryEntry[],
  agent: AgentApiSeatConfig,
): TraversalSpeedClass {
  const { playerUniqueCellsVisited, decayUnitsCharged } = getTraversalSpeedMetrics(traversalHistory, agent)
  return resolveStatusSpeedClass(playerUniqueCellsVisited, decayUnitsCharged)
}

// resolveTraversalSpeedClass is the single place the rate thresholds live, comparing directly
// against scoring.traversalSpeedScaleUnits - the fixed-point value equal to a 1.0000 ratio - rather
// than dividing traversalSpeedUnits back down to a float first. Every caller already holds a
// fixed-point value from calculateTraversalSpeedUnits (a persisted win record, a live
// running-status rate, an agent's traversal speed), so comparing units directly is both the only
// entry point speed classification ever needs and free of the precision loss a fresh division could
// introduce right at a boundary, keeping the win summary and the running prompt unable to disagree
// about where that boundary sits.
export function resolveTraversalSpeedClass(traversalSpeedUnits: number): TraversalSpeedClass {
  // Below baseline: score is draining faster than new ground is being covered, whether spent on
  // invalid moves, malformed responses, or oscillation between already-visited cells.
  if (traversalSpeedUnits < scoring.traversalSpeedScaleUnits) {
    return "backtracker"
  }

  // Above baseline: batched multi-move turns are covering more than one new cell per decay unit.
  if (traversalSpeedUnits > scoring.traversalSpeedScaleUnits) {
    return "trailblazer"
  }

  // Exactly at baseline: one new cell per decay unit, break-even with nothing to spare.
  return "navigator"
}

// calculateTraversalSpeedUnits normalizes one agent's progress-per-decay-unit into fixed-point
// units. Values normally round to the nearest display unit, except inside the one-unit margin
// around 1.0000x where rounding could cross the raw-count class boundary.
export function calculateTraversalSpeedUnits(uniqueCellsVisited: number, scoreDecayUnits: number): number {
  if (scoreDecayUnits <= 0) {
    return 0
  }

  if (uniqueCellsVisited === scoreDecayUnits) {
    return scoring.traversalSpeedScaleUnits
  }

  // Multiply before dividing. uniqueCellsVisited * scale is an exact integer, so this is a single
  // correctly-rounded division; (uniqueCellsVisited / scoreDecayUnits) * scale rounds twice and can
  // land an exact tie just below .5 - 57 / 800 is exactly 712.5 units but computes as
  // 712.4999999999999, which Math.round takes to 712 while any exact reconstruction gets 713.
  const scaledSpeed = (uniqueCellsVisited * scoring.traversalSpeedScaleUnits) / scoreDecayUnits
  const speedMargin = scoring.traversalSpeedScaleUnits - scaledSpeed
  const roundedSpeedUnits = speedMargin >= 0 && speedMargin <= 1
    ? Math.floor(scaledSpeed)
    : speedMargin < 0 && speedMargin >= -1
      ? Math.ceil(scaledSpeed)
      : Math.round(scaledSpeed)

  return Math.max(0, roundedSpeedUnits)
}

// traversalSpeedUnitsToRatio renders fixed-point speed units as the bare ratio, with no unit suffix.
// It is the machine-facing form: the agent-api log records it, and Tapoo Oracle reads that field back
// with Number(), which a suffixed "1.2345x" turns into NaN. calculateTraversalSpeedUnits already
// selected the boundary-safe rounding direction, so this only formats the stored fixed-point value.
export function traversalSpeedUnitsToRatio(traversalSpeedUnits: number): string {
  const efficiencyClass = resolveTraversalSpeedClass(traversalSpeedUnits)

  if (efficiencyClass === "navigator") {
    return (scoring.traversalSpeedScaleUnits / scoring.traversalSpeedScaleUnits)
      .toFixed(traversalSpeedDisplayDecimals)
  }

  return (traversalSpeedUnits / scoring.traversalSpeedScaleUnits)
    .toFixed(traversalSpeedDisplayDecimals)
}

// traversalSpeedUnitsToDisplay renders fixed-point speed units as the complete speed label players
// read: the ratio with "x" appended to identify the value as a speed. Anything a program parses back
// takes traversalSpeedUnitsToRatio instead.
export function traversalSpeedUnitsToDisplay(traversalSpeedUnits: number): string {
  return `${traversalSpeedUnitsToRatio(traversalSpeedUnits)}x`
}

// capitalize renders lowercase speed-classification identifiers (kept lowercase for model-facing
// JSON/prose) as UI-facing title case.
export function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

// nameWithSpeedClass renders "{name} the {Class}" - shared by every UI surface that names a player
// after their current speed classification: seat roster/dialog labels (agentDisplayName) and the
// running-status line (formatPlayerStatusLabel).
export function nameWithSpeedClass(playerName: string, speedClass: TraversalSpeedClass): string {
  return `${playerName} the ${capitalize(speedClass)}`
}

// agentDisplayName names the agent after its current speed classification everywhere the UI shows
// it - tooltips, dialog titles - so the classification the model is working from stays visible to
// a human observer too, e.g. "Kora the Trailblazer".
export function agentDisplayName(agent: AgentApiSeatConfig, traversalHistory: readonly TraversalHistoryEntry[]): string {
  return nameWithSpeedClass(agent.playerName, resolveAgentTraversalSpeedClass(traversalHistory, agent))
}

// formatPlayerStatusLabel renders the "{name} the {Class} - {rate}" segment shown on the
// running-status line for whoever is currently playing - interactive or agent-api. A player who
// hasn't been charged any decay units yet shows "- Default" instead of a computed rate. No
// leading/trailing whitespace: CONFIG.messages.runningStatus owns the spacing around {player}.
// speedClass defaults to resolving it from status, but a caller that already classified the same
// (uniqueCellsVisited, decayUnitsCharged) pair for its own purposes - e.g. agent/request.ts, which
// needs the raw TraversalSpeedClass for the system prompt as well as this label - can pass it
// straight through instead of paying for the same classification twice.
export function formatPlayerStatusLabel(
  status: AgentPlayerStatus,
  speedClass: TraversalSpeedClass = resolveStatusSpeedClass(status.uniqueCellsVisited, status.decayUnitsCharged),
): string {
  const rateDisplay = status.decayUnitsCharged > 0
    ? traversalSpeedUnitsToDisplay(calculateTraversalSpeedUnits(status.uniqueCellsVisited, status.decayUnitsCharged))
    : "Default"

  return `${nameWithSpeedClass(status.playerName, speedClass)} - ${rateDisplay}`
}
