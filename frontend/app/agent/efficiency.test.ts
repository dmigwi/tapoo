import { describe, expect, it } from "vitest"

import {
  getBatchEfficiencyMetrics,
  resolveBatchEfficiencyRank,
} from "./efficiency"
import type { AgentApiConfig, TraversalHistoryEntry } from "../types"

function createAgent(overrides: Partial<AgentApiConfig> = {}): AgentApiConfig {
  return {
    id: 1,
    playerName: "Blue",
    model: "qwen3.6:27b",
    endpoint: new URL("https://agents.example/chat"),
    enabled: true,
    ...overrides,
  }
}

function visit(playerName: string, row: number, col: number): TraversalHistoryEntry {
  return { playerName, row, col, openMoves: [] }
}

describe("resolveBatchEfficiencyRank", () => {
  it("defaults to trailblazer when the agent has made no prior requests", () => {
    const agent = createAgent({ requestsCount: undefined })

    expect(resolveBatchEfficiencyRank([visit("Blue", 0, 1)], agent)).toBe("trailblazer")
  })

  it("defaults to trailblazer when requestsCount is explicitly zero", () => {
    const agent = createAgent({ requestsCount: 0 })

    expect(resolveBatchEfficiencyRank([visit("Blue", 0, 1)], agent)).toBe("trailblazer")
  })

  it("only counts distinct cells attributed to the requesting agent's playerName", () => {
    const agent = createAgent({ requestsCount: 2 })
    const traversalHistory = [
      visit("Self", 0, 0),
      visit("Blue", 0, 1),
      visit("Red", 0, 2),
    ]

    expect(resolveBatchEfficiencyRank(traversalHistory, agent)).toBe("backtracker")
  })

  it("falls below the baseline when requests outpace distinct progress (oscillation)", () => {
    const agent = createAgent({ requestsCount: 4 })
    const traversalHistory = [visit("Blue", 0, 0)]

    expect(resolveBatchEfficiencyRank(traversalHistory, agent)).toBe("backtracker")
  })

  it("rises above the baseline when a batch advances multiple distinct cells per request", () => {
    const agent = createAgent({ requestsCount: 2 })
    const traversalHistory = [
      visit("Blue", 0, 0),
      visit("Blue", 0, 1),
      visit("Blue", 0, 2),
      visit("Blue", 0, 3),
    ]

    expect(resolveBatchEfficiencyRank(traversalHistory, agent)).toBe("trailblazer")
  })

  it("labels exactly the baseline rate as navigator", () => {
    const agent = createAgent({ requestsCount: 1 })
    const traversalHistory = [visit("Blue", 0, 0)]

    expect(resolveBatchEfficiencyRank(traversalHistory, agent)).toBe("navigator")
  })
})

describe("getBatchEfficiencyMetrics", () => {
  it("reports zero counts for a fresh agent with no prior requests", () => {
    const agent = createAgent({ requestsCount: undefined })

    expect(getBatchEfficiencyMetrics([], agent)).toEqual({
      uniqueCellsVisited: 0,
      requestsMade: 0,
    })
  })

  it("counts only distinct cells attributed to the requesting agent's playerName", () => {
    const agent = createAgent({ requestsCount: 3 })
    const traversalHistory = [
      visit("Self", 0, 0),
      visit("Blue", 0, 1),
      visit("Blue", 0, 2),
      visit("Red", 0, 3),
    ]

    expect(getBatchEfficiencyMetrics(traversalHistory, agent)).toEqual({
      uniqueCellsVisited: 2,
      requestsMade: 3,
    })
  })
})
