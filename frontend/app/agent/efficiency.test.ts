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
  it("defaults to trailblazer when the agent has been charged nothing yet", () => {
    const agent = createAgent({ decayUnitsCharged: undefined })

    expect(resolveBatchEfficiencyRank([visit("Blue", 0, 1)], agent)).toBe("trailblazer")
  })

  it("defaults to trailblazer when decayUnitsCharged is explicitly zero", () => {
    // Also the guard that keeps the rate from dividing by zero.
    const agent = createAgent({ decayUnitsCharged: 0 })

    expect(resolveBatchEfficiencyRank([visit("Blue", 0, 1)], agent)).toBe("trailblazer")
  })

  it("only counts distinct cells attributed to the requesting agent's playerName", () => {
    const agent = createAgent({ decayUnitsCharged: 2 })
    const traversalHistory = [
      visit("Self", 0, 0),
      visit("Blue", 0, 1),
      visit("Red", 0, 2),
    ]

    expect(resolveBatchEfficiencyRank(traversalHistory, agent)).toBe("backtracker")
  })

  it("falls below the baseline when decay outpaces distinct progress (oscillation)", () => {
    const agent = createAgent({ decayUnitsCharged: 4 })
    const traversalHistory = [visit("Blue", 0, 0)]

    expect(resolveBatchEfficiencyRank(traversalHistory, agent)).toBe("backtracker")
  })

  it("rises above the baseline when a batch advances multiple distinct cells per decay unit", () => {
    // Two turns, one decay unit each, four new cells: batching is what lifts the rate, since a
    // turn is charged the same whether it carried one move or many.
    const agent = createAgent({ decayUnitsCharged: 2 })
    const traversalHistory = [
      visit("Blue", 0, 0),
      visit("Blue", 0, 1),
      visit("Blue", 0, 2),
      visit("Blue", 0, 3),
    ]

    expect(resolveBatchEfficiencyRank(traversalHistory, agent)).toBe("trailblazer")
  })

  it("labels exactly the baseline rate as navigator", () => {
    const agent = createAgent({ decayUnitsCharged: 1 })
    const traversalHistory = [visit("Blue", 0, 0)]

    expect(resolveBatchEfficiencyRank(traversalHistory, agent)).toBe("navigator")
  })

  it("drops a single-stepping agent below the baseline once a mistake is charged", () => {
    // Four turns each advancing one cell, but one of them hit an invalid move: 4 new cells
    // against 3 clean units + 3 for the mistake. Requests alone would still read exactly 1.0,
    // which is why the rate is charged against decay rather than request count.
    const agent = createAgent({ requestsCount: 4, decayUnitsCharged: 6 })
    const traversalHistory = [
      visit("Blue", 0, 0),
      visit("Blue", 0, 1),
      visit("Blue", 0, 2),
      visit("Blue", 0, 3),
    ]

    expect(resolveBatchEfficiencyRank(traversalHistory, agent)).toBe("backtracker")
  })
})

describe("getBatchEfficiencyMetrics", () => {
  it("reports zero counts for a fresh agent with no tracked turns", () => {
    const agent = createAgent({ requestsCount: undefined, decayUnitsCharged: undefined })

    expect(getBatchEfficiencyMetrics([], agent)).toEqual({
      uniqueCellsVisited: 0,
      decayUnitsCharged: 0,
      requestsMade: 0,
    })
  })

  it("counts only distinct cells attributed to the requesting agent's playerName", () => {
    const agent = createAgent({ requestsCount: 3, decayUnitsCharged: 5 })
    const traversalHistory = [
      visit("Self", 0, 0),
      visit("Blue", 0, 1),
      visit("Blue", 0, 2),
      visit("Red", 0, 3),
    ]

    expect(getBatchEfficiencyMetrics(traversalHistory, agent)).toEqual({
      uniqueCellsVisited: 2,
      decayUnitsCharged: 5,
      requestsMade: 3,
    })
  })
})
