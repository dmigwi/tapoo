import { describe, expect, it } from "vitest"

import {
  calculateTraversalSpeedUnits,
  formatPlayerStatusLabel,
  getTraversalSpeedMetrics,
  resolveAgentTraversalSpeedClass,
  resolveStatusSpeedClass,
  resolveTraversalSpeedClass,
  traversalSpeedUnitsToDisplay,
  traversalSpeedUnitsToRatio,
} from "./traversal-speed"
import { CONFIG } from "../config"
import type { AgentApiSeatConfig, TraversalHistoryEntry } from "../types"

const traversalSpeedDisplayDecimals = String(CONFIG.scoring.traversalSpeedScaleUnits).length - 1

function createAgent(overrides: Partial<AgentApiSeatConfig> = {}): AgentApiSeatConfig {
  return {
    seatId: 1,
    sessionId: 1_700_000_000_000,
    playerName: "Blue",
    model: "qwen3.6:27b",
    endpoint: new URL("https://agents.example/chat"),
    api: "ollama",
    enabled: true,
    ...overrides,
  }
}

function visit(playerName: string, row: number, col: number): TraversalHistoryEntry {
  return { playerName, row, col, openMoves: [], visitCount: 1 }
}

describe("resolveAgentTraversalSpeedClass", () => {
  it("defaults to trailblazer when the agent has been charged nothing yet", () => {
    const agent = createAgent({ decayUnitsCharged: undefined })

    expect(resolveAgentTraversalSpeedClass([visit("Blue", 0, 1)], agent)).toBe("trailblazer")
  })

  it("defaults to trailblazer when decayUnitsCharged is explicitly zero", () => {
    // Also the guard that keeps the rate from dividing by zero.
    const agent = createAgent({ decayUnitsCharged: 0 })

    expect(resolveAgentTraversalSpeedClass([visit("Blue", 0, 1)], agent)).toBe("trailblazer")
  })

  it("only counts distinct cells attributed to the requesting agent's playerName", () => {
    const agent = createAgent({ decayUnitsCharged: 2 })
    const traversalHistory = [
      visit("Self", 0, 0),
      visit("Blue", 0, 1),
      visit("Red", 0, 2),
    ]

    expect(resolveAgentTraversalSpeedClass(traversalHistory, agent)).toBe("backtracker")
  })

  it("falls below the baseline when decay outpaces distinct progress (oscillation)", () => {
    const agent = createAgent({ decayUnitsCharged: 4 })
    const traversalHistory = [visit("Blue", 0, 0)]

    expect(resolveAgentTraversalSpeedClass(traversalHistory, agent)).toBe("backtracker")
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

    expect(resolveAgentTraversalSpeedClass(traversalHistory, agent)).toBe("trailblazer")
  })

  it("labels exactly the baseline rate as navigator", () => {
    const agent = createAgent({ decayUnitsCharged: 1 })
    const traversalHistory = [visit("Blue", 0, 0)]

    expect(resolveAgentTraversalSpeedClass(traversalHistory, agent)).toBe("navigator")
  })

  it("drops a single-stepping agent below the baseline once a mistake is charged", () => {
    // Four turns each advancing one cell, but one of them hit an invalid move: 4 new cells
    // against 3 clean units + 3 for the mistake. Requests alone would still read exactly 1.0000x,
    // which is why the rate is charged against decay rather than request count.
    const agent = createAgent({ turnCount: 4, decayUnitsCharged: 6 })
    const traversalHistory = [
      visit("Blue", 0, 0),
      visit("Blue", 0, 1),
      visit("Blue", 0, 2),
      visit("Blue", 0, 3),
    ]

    expect(resolveAgentTraversalSpeedClass(traversalHistory, agent)).toBe("backtracker")
  })
})

describe("getTraversalSpeedMetrics", () => {
  it("reports zero counts for a fresh agent with no tracked turns", () => {
    const agent = createAgent({ turnCount: undefined, decayUnitsCharged: undefined })

    expect(getTraversalSpeedMetrics([], agent)).toEqual({
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

    expect(getTraversalSpeedMetrics(traversalHistory, agent)).toEqual({
      playerUniqueCellsVisited: 2,
      allUniqueCellsVisited: 4,
      decayUnitsCharged: 5,
      playerTurnsTaken: 3,
    })
  })
})

describe("calculateTraversalSpeedUnits", () => {
  it("normalizes traversal speed into fixed-point units", () => {
    // 4 new cells for 2 decay units is a speed of 2.0000x; single-stepping sits at 1.0000x.
    expect(calculateTraversalSpeedUnits(4, 2)).toBe(20_000)
    expect(calculateTraversalSpeedUnits(5, 5)).toBe(10_000)
    expect(calculateTraversalSpeedUnits(3, 4)).toBe(7_500)
  })

  it("reports zero traversal speed before any decay is charged", () => {
    // Guards the divide-by-zero on a round that ends before a single turn is charged.
    expect(calculateTraversalSpeedUnits(0, 0)).toBe(0)
    expect(calculateTraversalSpeedUnits(4, 0)).toBe(0)
    expect(calculateTraversalSpeedUnits(4, -1)).toBe(0)
  })

  it("rounds normally but clamps the 1.0000x boundary based on the raw speed class", () => {
    // Raw speed is 0.99995, so it must remain visibly Backtracker instead of rounding to Navigator.
    const backtrackerUnits = calculateTraversalSpeedUnits(99_995, 100_000)
    expect(resolveTraversalSpeedClass(backtrackerUnits)).toBe("backtracker")
    expect(traversalSpeedUnitsToDisplay(backtrackerUnits)).toBe("0.9999x")

    // Raw speed is 0.99985, so it must remain visibly Backtracker instead of rounding to Navigator.
    const backtracker1Units = calculateTraversalSpeedUnits(99_985, 100_000)
    expect(resolveTraversalSpeedClass(backtracker1Units)).toBe("backtracker")
    expect(traversalSpeedUnitsToDisplay(backtracker1Units)).toBe("0.9999x")

    // Raw speed is safely below the boundary, so normal rounding still applies.
    const backtracker2Units = calculateTraversalSpeedUnits(45_459, 100_000)
    expect(resolveTraversalSpeedClass(backtracker2Units)).toBe("backtracker")
    expect(traversalSpeedUnitsToDisplay(backtracker2Units)).toBe("0.4546x")

    // Raw speed is 1.00005, so it must remain visibly Trailblazer instead of rounding to Navigator.
    const trailblazerUnits = calculateTraversalSpeedUnits(100_005, 100_000)
    expect(resolveTraversalSpeedClass(trailblazerUnits)).toBe("trailblazer")
    expect(traversalSpeedUnitsToDisplay(trailblazerUnits)).toBe("1.0001x")

    // Raw speed is 1.00001, so even a smaller just-above-boundary Trailblazer cannot display as Navigator.
    const trailblazer1Units = calculateTraversalSpeedUnits(100_001, 100_000)
    expect(resolveTraversalSpeedClass(trailblazer1Units)).toBe("trailblazer")
    expect(traversalSpeedUnitsToDisplay(trailblazer1Units)).toBe("1.0001x")
  })

  it("keeps normal rounding away from the class boundary", () => {
    // 1 / 3 is safely below 1.0000x, so normal rounding applies.
    const backtrackerUnits = calculateTraversalSpeedUnits(1, 3)
    expect(backtrackerUnits).toBe(3_333)
    expect(traversalSpeedUnitsToDisplay(backtrackerUnits)).toBe("0.3333x")

    // 4 / 3 is safely above 1.0000x, so normal rounding applies.
    const trailblazerUnits = calculateTraversalSpeedUnits(4, 3)
    expect(trailblazerUnits).toBe(13_333)
    expect(traversalSpeedUnitsToDisplay(trailblazerUnits)).toBe("1.3333x")
  })
})

describe("resolveTraversalSpeedClass", () => {
  it("classifies a fixed-point value produced by calculateTraversalSpeedUnits directly, with no un-scaling division", () => {
    // calculateTraversalSpeedUnits(4, 2) is 20_000 (a raw ratio of 2.0000x, above the 1.0000x baseline).
    expect(resolveTraversalSpeedClass(calculateTraversalSpeedUnits(4, 2))).toBe("trailblazer")
    // calculateTraversalSpeedUnits(5, 5) is 10_000 (a raw ratio of exactly 1.0000x, the baseline).
    expect(resolveTraversalSpeedClass(calculateTraversalSpeedUnits(5, 5))).toBe("navigator")
    // calculateTraversalSpeedUnits(3, 4) is 7_500 (a raw ratio of 0.7500, below the baseline).
    expect(resolveTraversalSpeedClass(calculateTraversalSpeedUnits(3, 4))).toBe("backtracker")
  })
})

describe("resolveStatusSpeedClass", () => {
  it("classifies from raw counts instead of already-rounded fixed-point units", () => {
    expect(resolveStatusSpeedClass(99_995, 100_000)).toBe("backtracker")
    expect(resolveStatusSpeedClass(100_000, 100_000)).toBe("navigator")
    expect(resolveStatusSpeedClass(100_005, 100_000)).toBe("trailblazer")
  })

  it("keeps the no-decay default separate from computed fixed-point display", () => {
    expect(resolveStatusSpeedClass(0, 0)).toBe("trailblazer")
    expect(resolveStatusSpeedClass(4, 0)).toBe("trailblazer")
    expect(resolveTraversalSpeedClass(calculateTraversalSpeedUnits(4, 0))).toBe("backtracker")
    expect(traversalSpeedUnitsToDisplay(calculateTraversalSpeedUnits(4, 0))).toBe("0.0000x")
  })
})

describe("traversalSpeedUnitsToRatio", () => {
  it("renders the bare ratio that Number() parses back, with the same rounding as the label", () => {
    // Tapoo Oracle reads the logged speed with Number(); "1.3334x" would come back as NaN and every
    // trailblazer win would classify as backtracker.
    for (const units of [0, 3_333, 9_999, 10_000, 10_001, 13_334, 20_000]) {
      const ratio = traversalSpeedUnitsToRatio(units)
      expect(ratio).not.toContain("x")
      expect(Number.isFinite(Number(ratio))).toBe(true)
      expect(traversalSpeedUnitsToDisplay(units)).toBe(`${ratio}x`)
    }
    expect(traversalSpeedUnitsToRatio(13_334)).toBe("1.3334")
    expect(traversalSpeedUnitsToRatio(9_999)).toBe("0.9999")
  })
})

describe("traversalSpeedUnitsToDisplay", () => {
  it("renders fixed-point units with four decimal places at and around the baseline", () => {
    const { traversalSpeedScaleUnits } = CONFIG.scoring

    expect(traversalSpeedUnitsToDisplay(traversalSpeedScaleUnits - 1)).toBe(
      `${((traversalSpeedScaleUnits - 1) / traversalSpeedScaleUnits)
        .toFixed(traversalSpeedDisplayDecimals)}x`,
    )
    expect(traversalSpeedUnitsToDisplay(CONFIG.scoring.traversalSpeedScaleUnits)).toBe(
      `${(traversalSpeedScaleUnits / traversalSpeedScaleUnits)
        .toFixed(traversalSpeedDisplayDecimals)}x`,
    )
    expect(traversalSpeedUnitsToDisplay(traversalSpeedScaleUnits + 1)).toBe(
      `${((traversalSpeedScaleUnits + 1) / traversalSpeedScaleUnits)
        .toFixed(traversalSpeedDisplayDecimals)}x`,
    )
  })
})

describe("formatPlayerStatusLabel", () => {
  it("keeps the visible label class aligned with the boundary-safe displayed speed", () => {
    expect(formatPlayerStatusLabel({
      playerName: "Blue",
      uniqueCellsVisited: 99_995,
      decayUnitsCharged: 100_000,
    })).toBe("Blue the Backtracker - 0.9999x")

    expect(formatPlayerStatusLabel({
      playerName: "Blue",
      uniqueCellsVisited: 100_005,
      decayUnitsCharged: 100_000,
    })).toBe("Blue the Trailblazer - 1.0001x")
  })
})
