import type { AgentApiConfig, TraversalHistoryEntry } from "../types"

// BATCH_EFFICIENCY_BASELINE_RATE is the break-even traversal speed: one new cell reached for every
// decay unit spent. A maze's entire budget is one decay unit per cell, so an agent holding exactly
// this pace arrives with nothing to spare — below it the score runs out before the destination
// does, above it there is margin left for mistakes.
export const BATCH_EFFICIENCY_BASELINE_RATE = 1

// BatchEfficiencyRank names the traversal behavior the rate measures, not just a grade, so the
// rank itself carries the corrective instruction: climb out of backtracker, defend trailblazer.
export type BatchEfficiencyRank = "backtracker" | "navigator" | "trailblazer"

// BatchEfficiencyMetrics are the raw counts behind the traversal speed, exposed to the model
// directly so it can compute and verify the rate/rank itself instead of treating the rank as an
// unexplained label. requestsMade rides along as context but deliberately does not feed the rate:
// a turn is charged the same decay whether it carried one move or many, so dividing by requests
// would leave the rate blind to the batching it is meant to reward.
export type BatchEfficiencyMetrics = {
  uniqueCellsVisited: number
  decayUnitsCharged: number
  requestsMade: number
}

// countDistinctCellsForAgent counts traversalHistory entries first attributed to this agent's
// playerName. traversalHistory only records a cell's first visit, so this is the agent's unique
// progress, not a raw move count.
function countDistinctCellsForAgent(
  traversalHistory: TraversalHistoryEntry[],
  agent: AgentApiConfig,
): number {
  return traversalHistory.filter((entry) => entry.playerName === agent.playerName).length
}

// getBatchEfficiencyMetrics returns the raw counts behind the rate.
export function getBatchEfficiencyMetrics(
  traversalHistory: TraversalHistoryEntry[],
  agent: AgentApiConfig,
): BatchEfficiencyMetrics {
  return {
    uniqueCellsVisited: countDistinctCellsForAgent(traversalHistory, agent),
    decayUnitsCharged: agent.decayUnitsCharged ?? 0,
    requestsMade: agent.requestsCount ?? 0,
  }
}

// resolveBatchEfficiencyRank is the single source of truth for an agent's current rank, everywhere
// one is shown or sent. An agent that has not been charged anything yet defaults to trailblazer —
// not the neutral baseline — so it starts already primed to predict multi-move sequences, matching
// the identity stated in its very first prompt. That same guard is what keeps the rate below from
// dividing by zero. traversalHistory only records the first visit to each cell, so oscillation
// between known cells spends decay without growing the distinct-cell count, pulling the rate down.
export function resolveBatchEfficiencyRank(
  traversalHistory: TraversalHistoryEntry[],
  agent: AgentApiConfig,
): BatchEfficiencyRank {
  // Fresh agent, nothing charged yet — grant trailblazer rather than the neutral baseline.
  if (!agent.decayUnitsCharged) {
    return "trailblazer"
  }

  // New cells reached per decay unit spent; decayUnitsCharged is guaranteed > 0 here since the
  // fresh-agent case above already returned for a falsy count.
  const { uniqueCellsVisited, decayUnitsCharged } = getBatchEfficiencyMetrics(traversalHistory, agent)
  return resolveTraversalSpeedRank(uniqueCellsVisited / decayUnitsCharged)
}

// resolveTraversalSpeedRank is the single place the rate thresholds live. The win summary scores a
// completed round's speed and the prompt scores an agent's running speed; both come through here so
// the two can never disagree about where a rank boundary sits.
export function resolveTraversalSpeedRank(traversalSpeed: number): BatchEfficiencyRank {
  // Below baseline: score is draining faster than new ground is being covered, whether spent on
  // invalid moves, malformed responses, or oscillation between already-visited cells.
  if (traversalSpeed < BATCH_EFFICIENCY_BASELINE_RATE) {
    return "backtracker"
  }

  // Above baseline: batched multi-move turns are covering more than one new cell per decay unit.
  if (traversalSpeed > BATCH_EFFICIENCY_BASELINE_RATE) {
    return "trailblazer"
  }

  // Exactly at baseline: one new cell per decay unit, break-even with nothing to spare.
  return "navigator"
}
