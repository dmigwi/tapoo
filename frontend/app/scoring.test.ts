import { describe, expect, it } from "vitest"

import {
  buildAgentWinSummary,
  buildWinSummary,
  calculateElapsedScore,
  calculateMaxScore,
  calculateScoreAfterDecay,
  calculateScoreRetentionUnits,
  resolveWinScore,
  retentionUnitDeltaToDurationMs,
  retentionUnitsToDisplayPercent,
} from "./scoring"

describe("score helpers", () => {
  it("calculates the maximum round score from the maze area", () => {
    expect(calculateMaxScore(9)).toBe(900)
  })

  it("decays interactive scores from elapsed time", () => {
    expect(calculateElapsedScore(9, 1_000, 1_000)).toBe(800)
  })

  it("decays agent-api scores from submitted move units", () => {
    expect(calculateScoreAfterDecay(9, 2)).toBe(700)
  })

  it("normalizes score retention into fixed-point units", () => {
    expect(calculateScoreRetentionUnits(9, 900)).toBe(1_000_000)
    expect(calculateScoreRetentionUnits(9, 450)).toBe(500_000)
  })

  it("clamps retention units to the supported range", () => {
    expect(calculateScoreRetentionUnits(9, -100)).toBe(0)
    expect(calculateScoreRetentionUnits(9, 1_000)).toBe(1_000_000)
  })

  it("converts fixed-point retention units into display percentages", () => {
    expect(retentionUnitsToDisplayPercent(500_000)).toBe(50)
    expect(retentionUnitsToDisplayPercent(1_000_000)).toBe(100)
  })

  it("projects retention deltas onto the current round duration", () => {
    expect(retentionUnitDeltaToDurationMs(500_000, 10_000)).toBe(5_000)
  })

  it("builds retention win summaries from previous and best scores", () => {
    expect(buildWinSummary(1_000_000, null, null, 10_000)).toBe(
      "New scores retention record",
    )
    expect(buildWinSummary(900_000, 800_000, 1_000_000, 10_000)).toBe(
      "1.00s faster than previous (1.00s behind best)",
    )
  })

  it("builds agent-api win summaries from request counts", () => {
    expect(buildAgentWinSummary(4, null, null)).toBe(
      "New lowest request count",
    )
    expect(buildAgentWinSummary(4, 6, 3)).toBe(
      "2 fewer requests than previous (1 behind best)",
    )
  })

  it("resolves interactive win summaries and retention metrics together", () => {
    expect(
      resolveWinScore({
        agentRequestCount: 0,
        bestWinRequestCount: null,
        bestWinRetentionUnits: 1_000_000,
        controlMode: "interactive",
        lastAttemptRetentionUnits: 800_000,
        lastWinRequestCount: null,
        score: 900,
        totalCells: 10,
      }),
    ).toEqual({
      bestWinRequestCount: null,
      bestWinRetentionUnits: 1_000_000,
      lastAttemptRetentionUnits: 900_000,
      lastWinRequestCount: null,
      winSummary: "1.00s faster than previous (1.00s behind best)",
    })
  })

  it("resolves agent-api win summaries and request metrics together", () => {
    expect(
      resolveWinScore({
        agentRequestCount: 4,
        bestWinRequestCount: 3,
        bestWinRetentionUnits: 800_000,
        controlMode: "agent-api",
        lastAttemptRetentionUnits: 700_000,
        lastWinRequestCount: 6,
        score: 900,
        totalCells: 10,
      }),
    ).toEqual({
      bestWinRequestCount: 3,
      bestWinRetentionUnits: 900_000,
      lastAttemptRetentionUnits: 900_000,
      lastWinRequestCount: 4,
      winSummary: "2 fewer requests than previous (1 behind best)",
    })
  })
})
