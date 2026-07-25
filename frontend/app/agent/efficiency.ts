import type { AgentApiConfig, TraversalHistoryEntry } from "../types"

// BATCH_EFFICIENCY_BASELINE_RATE is the one-move-per-turn neutral point: matching it means the
// agent is behaving exactly like the conservative single-step strategy, no better and no worse.
export const BATCH_EFFICIENCY_BASELINE_RATE = 1

// BatchEfficiencyLevel names the traversal behavior the rate measures, not just a grade, so the
// rank itself carries the corrective instruction: climb out of backtracker, defend trailblazer.
export type BatchEfficiencyLevel = "backtracker" | "navigator" | "trailblazer"

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

// calculateBatchEfficiencyRate is a self-diagnostic signal only; it never affects score.
// traversalHistory only records the first visit to each cell, so oscillation or wasted requests
// grow requestsCount without growing the agent's distinct-cell count, pulling the rate below the
// baseline. A fresh agent with no prior requests reports the neutral baseline rate here — see
// resolveBatchEfficiencyLevel for the rank a fresh agent is actually assigned.
export function calculateBatchEfficiencyRate(
  traversalHistory: TraversalHistoryEntry[],
  agent: AgentApiConfig,
): number {
  const { uniqueCellsVisited, requestsMade } = getBatchEfficiencyMetrics(traversalHistory, agent)
  return requestsMade > 0 ? uniqueCellsVisited / requestsMade : BATCH_EFFICIENCY_BASELINE_RATE
}

// classifyBatchEfficiencyRate labels a raw rate so the model doesn't have to compare it itself.
export function classifyBatchEfficiencyRate(rate: number): BatchEfficiencyLevel {
  if (rate < BATCH_EFFICIENCY_BASELINE_RATE) {
    return "backtracker"
  }

  if (rate > BATCH_EFFICIENCY_BASELINE_RATE) {
    return "trailblazer"
  }

  return "navigator"
}

// resolveBatchEfficiencyLevel is the single source of truth for an agent's current rank,
// everywhere one is shown or sent. An agent with no tracked requests yet defaults to
// trailblazer — not the neutral baseline — so it starts the level already primed to predict
// multi-move sequences, matching the identity stated in its very first prompt.
export function resolveBatchEfficiencyLevel(
  traversalHistory: TraversalHistoryEntry[],
  agent: AgentApiConfig,
): BatchEfficiencyLevel {
  if (!agent.requestsCount) {
    return "trailblazer"
  }

  return classifyBatchEfficiencyRate(
    calculateBatchEfficiencyRate(traversalHistory, agent),
  )
}
