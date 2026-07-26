import type { AgentApiConfig, TraversalHistoryEntry } from "../types"

// BATCH_EFFICIENCY_BASELINE_RATE is the one-move-per-turn neutral point: matching it means the
// agent is behaving exactly like the conservative single-step strategy, no better and no worse.
export const BATCH_EFFICIENCY_BASELINE_RATE = 1

// BatchEfficiencyRank names the traversal behavior the rate measures, not just a grade, so the
// rank itself carries the corrective instruction: climb out of backtracker, defend trailblazer.
export type BatchEfficiencyRank = "backtracker" | "navigator" | "trailblazer"

// BatchEfficiencyMetrics are the raw counts behind batchEfficiencyRate, exposed to the model
// directly so it can compute and verify the rate/rank itself instead of treating the rank as an
// unexplained label.
export type BatchEfficiencyMetrics = {
  uniqueCellsVisited: number
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
    requestsMade: agent.requestsCount ?? 0,
  }
}

// resolveBatchEfficiencyRank is the single source of truth for an agent's current rank,
// everywhere one is shown or sent. An agent with no tracked requests yet defaults to
// trailblazer — not the neutral baseline — so it starts already primed to predict multi-move
// sequences, matching the identity stated in its very first prompt. traversalHistory only
// records the first visit to each cell, so oscillation or wasted requests grow requestsCount
// without growing the agent's distinct-cell count, pulling the rate below the baseline.
export function resolveBatchEfficiencyRank(
  traversalHistory: TraversalHistoryEntry[],
  agent: AgentApiConfig,
): BatchEfficiencyRank {
  // Fresh agent, no track record yet — grant trailblazer rather than the neutral baseline.
  if (!agent.requestsCount) {
    return "trailblazer"
  }

  // Distinct cells reached per request made; requestsMade is guaranteed > 0 here since the
  // fresh-agent case above already returned for a falsy requestsCount.
  const { uniqueCellsVisited, requestsMade } = getBatchEfficiencyMetrics(traversalHistory, agent)
  const rate = uniqueCellsVisited / requestsMade

  // Below baseline: requests are being wasted on invalid moves or oscillation between cells.
  if (rate < BATCH_EFFICIENCY_BASELINE_RATE) {
    return "backtracker"
  }

  // Above baseline: multi-move batches are paying off with more than one cell per request.
  if (rate > BATCH_EFFICIENCY_BASELINE_RATE) {
    return "trailblazer"
  }

  // Exactly at baseline: matching one move per request, no better and no worse.
  return "navigator"
}
