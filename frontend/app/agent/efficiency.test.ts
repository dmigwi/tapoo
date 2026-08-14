import { describe, expect, it } from "vitest"

import {
  calculateTraversalSpeedUnits,
  getBatchEfficiencyMetrics,
  resolveBatchEfficiencyClass,
  resolveTraversalSpeedClass,
} from "./efficiency"
import type { AgentApiConfig, TraversalHistoryEntry } from "../types"

function createAgent(overrides: Partial<AgentApiConfig> = {}): AgentApiConfig {
  return {
    id: 1,
    playerName: "Blue",
    model: "qwen3.6:27b",
    endpoint: new URL("https://agents.example/chat"),
    api: "ollama",
    enabled: true,
    ...overrides,
  }
}

function visit(playerName: string, row: number, col: number): TraversalHistoryEntry {
  return { playerName, row, col, openMoves: [] }
}

describe("resolveBatchEfficiencyClass", () => {
  it("defaults to trailblazer when the agent has been charged nothing yet", () => {
    const agent = createAgent({ decayUnitsCharged: undefined })

    expect(resolveBatchEfficiencyClass([visit("Blue", 0, 1)], agent)).toBe("trailblazer")
  })

  it("defaults to trailblazer when decayUnitsCharged is explicitly zero", () => {
    // Also the guard that keeps the rate from dividing by zero.
    const agent = createAgent({ decayUnitsCharged: 0 })

    expect(resolveBatchEfficiencyClass([visit("Blue", 0, 1)], agent)).toBe("trailblazer")
  })

  it("only counts distinct cells attributed to the requesting agent's playerName", () => {
    const agent = createAgent({ decayUnitsCharged: 2 })
    const traversalHistory = [
      visit("Self", 0, 0),
      visit("Blue", 0, 1),
      visit("Red", 0, 2),
    ]

    expect(resolveBatchEfficiencyClass(traversalHistory, agent)).toBe("backtracker")
  })

  it("falls below the baseline when decay outpaces distinct progress (oscillation)", () => {
    const agent = createAgent({ decayUnitsCharged: 4 })
    const traversalHistory = [visit("Blue", 0, 0)]

    expect(resolveBatchEfficiencyClass(traversalHistory, agent)).toBe("backtracker")
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

    expect(resolveBatchEfficiencyClass(traversalHistory, agent)).toBe("trailblazer")
  })

  it("labels exactly the baseline rate as navigator", () => {
    const agent = createAgent({ decayUnitsCharged: 1 })
    const traversalHistory = [visit("Blue", 0, 0)]

    expect(resolveBatchEfficiencyClass(traversalHistory, agent)).toBe("navigator")
  })

  it("drops a single-stepping agent below the baseline once a mistake is charged", () => {
    // Four turns each advancing one cell, but one of them hit an invalid move: 4 new cells
    // against 3 clean units + 3 for the mistake. Requests alone would still read exactly 1.0,
    // which is why the rate is charged against decay rather than request count.
    const agent = createAgent({ turnCount: 4, decayUnitsCharged: 6 })
    const traversalHistory = [
      visit("Blue", 0, 0),
      visit("Blue", 0, 1),
      visit("Blue", 0, 2),
      visit("Blue", 0, 3),
    ]

    expect(resolveBatchEfficiencyClass(traversalHistory, agent)).toBe("backtracker")
  })
})

describe("getBatchEfficiencyMetrics", () => {
  it("reports zero counts for a fresh agent with no tracked turns", () => {
    const agent = createAgent({ turnCount: undefined, decayUnitsCharged: undefined })

    expect(getBatchEfficiencyMetrics([], agent)).toEqual({
      playerUniqueCellsVisited: 0,
      allUniqueCellsVisited: 0,
      decayUnitsCharged: 0,
      playerTurnsTaken: 0,
    })
  })

  it("counts only distinct cells attributed to the requesting agent's playerName, alongside every player's combined total", () => {
    const agent = createAgent({ turnCount: 3, decayUnitsCharged: 5 })
    const traversalHistory = [
      visit("Self", 0, 0),
      visit("Blue", 0, 1),
      visit("Blue", 0, 2),
      visit("Red", 0, 3),
    ]

    expect(getBatchEfficiencyMetrics(traversalHistory, agent)).toEqual({
      playerUniqueCellsVisited: 2,
      allUniqueCellsVisited: 4,
      decayUnitsCharged: 5,
      playerTurnsTaken: 3,
    })
  })
})

describe("calculateTraversalSpeedUnits", () => {
  it("normalizes traversal speed into fixed-point units", () => {
    // 4 new cells for 2 decay units is a speed of 2.00; a single-stepping round sits at 1.00.
    expect(calculateTraversalSpeedUnits(4, 2)).toBe(200)
    expect(calculateTraversalSpeedUnits(5, 5)).toBe(100)
    expect(calculateTraversalSpeedUnits(3, 4)).toBe(75)
  })

  it("reports zero traversal speed before any decay is charged", () => {
    // Guards the divide-by-zero on a round that ends before a single turn is charged.
    expect(calculateTraversalSpeedUnits(0, 0)).toBe(0)
    expect(calculateTraversalSpeedUnits(4, 0)).toBe(0)
  })
})

describe("resolveTraversalSpeedClass", () => {
  it("classifies a fixed-point value produced by calculateTraversalSpeedUnits directly, with no un-scaling division", () => {
    // calculateTraversalSpeedUnits(4, 2) is 200 (a raw ratio of 2.00, above the 1.0 baseline).
    expect(resolveTraversalSpeedClass(calculateTraversalSpeedUnits(4, 2))).toBe("trailblazer")
    // calculateTraversalSpeedUnits(5, 5) is 100 (a raw ratio of exactly 1.0, the baseline).
    expect(resolveTraversalSpeedClass(calculateTraversalSpeedUnits(5, 5))).toBe("navigator")
    // calculateTraversalSpeedUnits(3, 4) is 75 (a raw ratio of 0.75, below the baseline).
    expect(resolveTraversalSpeedClass(calculateTraversalSpeedUnits(3, 4))).toBe("backtracker")
  })
})
