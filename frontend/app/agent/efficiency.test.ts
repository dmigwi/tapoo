import { describe, expect, it } from "vitest"

import {
  BATCH_EFFICIENCY_BASELINE_RATE,
  calculateBatchEfficiencyRate,
  classifyBatchEfficiencyRate,
  getBatchEfficiencyMetrics,
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

describe("calculateBatchEfficiencyRate", () => {
  it("defaults to the neutral baseline when the agent has made no prior requests", () => {
    const agent = createAgent({ requestsCount: undefined })
    const rate = calculateBatchEfficiencyRate([visit("Blue", 0, 1)], agent)

    expect(rate).toBe(BATCH_EFFICIENCY_BASELINE_RATE)
  })

  it("defaults to the neutral baseline when requestsCount is explicitly zero", () => {
    const agent = createAgent({ requestsCount: 0 })
    const rate = calculateBatchEfficiencyRate([visit("Blue", 0, 1)], agent)

    expect(rate).toBe(BATCH_EFFICIENCY_BASELINE_RATE)
  })

  it("only counts distinct cells attributed to the requesting agent's playerName", () => {
    const agent = createAgent({ requestsCount: 2 })
    const traversalHistory = [
      visit("Self", 0, 0),
      visit("Blue", 0, 1),
      visit("Red", 0, 2),
    ]

    expect(calculateBatchEfficiencyRate(traversalHistory, agent)).toBe(0.5)
  })

  it("falls below the baseline when requests outpace distinct progress (oscillation)", () => {
    const agent = createAgent({ requestsCount: 4 })
    const traversalHistory = [visit("Blue", 0, 0)]

    expect(calculateBatchEfficiencyRate(traversalHistory, agent)).toBe(0.25)
  })

  it("rises above the baseline when a batch advances multiple distinct cells per request", () => {
    const agent = createAgent({ requestsCount: 2 })
    const traversalHistory = [
      visit("Blue", 0, 0),
      visit("Blue", 0, 1),
      visit("Blue", 0, 2),
      visit("Blue", 0, 3),
    ]

    expect(calculateBatchEfficiencyRate(traversalHistory, agent)).toBe(2)
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

describe("classifyBatchEfficiencyRate", () => {
  it("labels a below-baseline rate as backtracker", () => {
    expect(classifyBatchEfficiencyRate(0.5)).toBe("backtracker")
  })

  it("labels exactly the baseline rate as navigator", () => {
    expect(classifyBatchEfficiencyRate(BATCH_EFFICIENCY_BASELINE_RATE)).toBe("navigator")
  })

  it("labels an above-baseline rate as trailblazer", () => {
    expect(classifyBatchEfficiencyRate(1.5)).toBe("trailblazer")
  })
})
