import { CONFIG } from "../config"
import type { AgentApiConfig, AgentPlayerStatus, TraversalHistoryEntry } from "../types"

const { scoring } = CONFIG
const traversalSpeedDisplayDecimals = String(scoring.traversalSpeedScaleUnits).length - 1

// BatchEfficiencyClass names the traversal-speed group the rate falls into, not just a grade, so
// the classification itself carries the corrective instruction: climb out of backtracker, sustain
// trailblazer.
export type BatchEfficiencyClass = "backtracker" | "navigator" | "trailblazer"

// BatchEfficiencyMetrics are the raw counts behind the traversal speed, exposed to the model
// directly so it can compute and verify the rate/classification itself instead of treating the
// classification as an unexplained label. playerUniqueCellsVisited is scoped to this specific
// agent (see countDistinctCellsForAgent) — it alone feeds the traversal-speed rate. allUniqueCellsVisited
// is the same traversalHistory's total length: every cell any player has reached this level,
// regardless of who got there first — a separate, non-agent-scoped figure that lets the model
// gauge how much of mazeDimensions.totalMazeCells has been collectively explored so far, distinct
// from its own individual progress. playerTurnsTaken is this specific agent's own completed
// prediction-turn count for the current level (agent.turnCount, incremented only on that agent's
// own commits — see recordAgentTurnStats in storage.ts) — not the round's shared total, which is
// State.turnCount / agent.levelTurnCount. Neither playerTurnsTaken nor allUniqueCellsVisited feeds
// the rate: a turn is charged the same decay whether it carried one move or many, so dividing by
// requests would leave the rate blind to the batching it is meant to reward, and the rate is about
// this agent's own spend, not the team's combined exploration.
export type BatchEfficiencyMetrics = {
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
  agent: AgentApiConfig,
): number {
  return traversalHistory.filter((entry) => entry.playerName === agent.playerName).length
}

// getBatchEfficiencyMetrics returns the raw counts behind the rate.
export function getBatchEfficiencyMetrics(
  traversalHistory: readonly TraversalHistoryEntry[],
  agent: AgentApiConfig,
): BatchEfficiencyMetrics {
  return {
    playerUniqueCellsVisited: countDistinctCellsForAgent(traversalHistory, agent),
    // traversalHistory records only first visits (see countDistinctCellsForAgent), so its length
    // is already every distinct cell any player has reached this level — no further dedup needed.
    allUniqueCellsVisited: traversalHistory.length,
    decayUnitsCharged: agent.decayUnitsCharged ?? 0,
    playerTurnsTaken: agent.turnCount ?? 0,
  }
}

// resolveStatusSpeedClass is the single source of truth for classifying any playerUniqueCellsVisited
// / decayUnitsCharged pair. It compares the raw counts directly so formatting precision can never
// turn a just-below-baseline Backtracker into Navigator or hide a just-above-baseline Trailblazer.
// Nothing charged yet defaults to trailblazer — not the neutral baseline — so play starts already
// primed to predict multi-move sequences, matching the classification stated in an agent's first
// prompt. That same guard keeps the rate below from dividing by zero.
export function resolveStatusSpeedClass(uniqueCellsVisited: number, decayUnitsCharged: number): BatchEfficiencyClass {
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

// resolveBatchEfficiencyClass is the single source of truth for an agent's current speed
// classification, everywhere one is shown or sent.
export function resolveBatchEfficiencyClass(
  traversalHistory: readonly TraversalHistoryEntry[],
  agent: AgentApiConfig,
): BatchEfficiencyClass {
  const { playerUniqueCellsVisited, decayUnitsCharged } = getBatchEfficiencyMetrics(traversalHistory, agent)
  return resolveStatusSpeedClass(playerUniqueCellsVisited, decayUnitsCharged)
}

// resolveTraversalSpeedClass is the single place the rate thresholds live, comparing directly
// against scoring.traversalSpeedScaleUnits — the fixed-point value equal to a 1.0 ratio — rather
// than dividing traversalSpeedUnits back down to a float first. Every caller already holds a
// fixed-point value from calculateTraversalSpeedUnits (a persisted win record, a live
// running-status rate, an agent's batch efficiency), so comparing units directly is both the only
// entry point speed classification ever needs and free of the precision loss a fresh division could
// introduce right at a boundary, keeping the win summary and the running prompt unable to disagree
// about where that boundary sits.
export function resolveTraversalSpeedClass(traversalSpeedUnits: number): BatchEfficiencyClass {
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
// units. The raw count comparison decides the rounding direction, so the displayed 4dp value cannot
// cross the classification boundary: Backtracker floors, Navigator stays exact, Trailblazer ceils.
export function calculateTraversalSpeedUnits(uniqueCellsVisited: number, scoreDecayUnits: number): number {
  if (scoreDecayUnits <= 0) {
    return 0
  }

  if (uniqueCellsVisited === scoreDecayUnits) {
    return scoring.traversalSpeedScaleUnits
  }

  const scaledSpeedUnits = uniqueCellsVisited * scoring.traversalSpeedScaleUnits
  const roundedSpeedUnits = uniqueCellsVisited < scoreDecayUnits
    ? Math.floor(scaledSpeedUnits / scoreDecayUnits)
    : Math.floor((scaledSpeedUnits + scoreDecayUnits - 1) / scoreDecayUnits)

  return Math.max(0, roundedSpeedUnits)
}

// traversalSpeedUnitsToDisplay renders fixed-point speed units as the plain ratio players read.
// calculateTraversalSpeedUnits already selected the boundary-safe rounding direction, so this only
// formats the stored fixed-point value.
export function traversalSpeedUnitsToDisplay(traversalSpeedUnits: number): string {
  const efficiencyClass = resolveTraversalSpeedClass(traversalSpeedUnits)

  if (efficiencyClass === "navigator") {
    return (scoring.traversalSpeedScaleUnits / scoring.traversalSpeedScaleUnits)
      .toFixed(traversalSpeedDisplayDecimals)
  }

  return (traversalSpeedUnits / scoring.traversalSpeedScaleUnits)
    .toFixed(traversalSpeedDisplayDecimals)
}

// capitalize renders lowercase speed-classification identifiers (kept lowercase for model-facing
// JSON/prose) as UI-facing title case.
export function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

// nameWithSpeedClass renders "{name} the {Class}" — shared by every UI surface that names a player
// after their current speed classification: seat roster/dialog labels (agentDisplayName) and the
// running-status line (formatPlayerStatusLabel).
export function nameWithSpeedClass(playerName: string, speedClass: BatchEfficiencyClass): string {
  return `${playerName} the ${capitalize(speedClass)}`
}

// agentDisplayName names the agent after its current speed classification everywhere the UI shows
// it — tooltips, dialog titles — so the classification the model is working from stays visible to
// a human observer too, e.g. "Kora the Trailblazer".
export function agentDisplayName(agent: AgentApiConfig, traversalHistory: readonly TraversalHistoryEntry[]): string {
  return nameWithSpeedClass(agent.playerName, resolveBatchEfficiencyClass(traversalHistory, agent))
}

// formatPlayerStatusLabel renders the "{name} the {Class} - {rate}x" segment shown on the
// running-status line for whoever is currently playing — interactive or agent-api. A player who
// hasn't been charged any decay units yet shows "- Default" instead of a computed rate. No
// leading/trailing whitespace: CONFIG.messages.runningStatus owns the spacing around {player}.
// speedClass defaults to resolving it from status, but a caller that already classified the same
// (uniqueCellsVisited, decayUnitsCharged) pair for its own purposes — e.g. agent/request.ts, which
// needs the raw BatchEfficiencyClass for the system prompt as well as this label — can pass it
// straight through instead of paying for the same classification twice.
export function formatPlayerStatusLabel(
  status: AgentPlayerStatus,
  speedClass: BatchEfficiencyClass = resolveStatusSpeedClass(status.uniqueCellsVisited, status.decayUnitsCharged),
): string {
  const rateDisplay = status.decayUnitsCharged > 0
    ? `${traversalSpeedUnitsToDisplay(calculateTraversalSpeedUnits(status.uniqueCellsVisited, status.decayUnitsCharged))}x`
    : "Default"

  return `${nameWithSpeedClass(status.playerName, speedClass)} - ${rateDisplay}`
}
