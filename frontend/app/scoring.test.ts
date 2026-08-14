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

  it("builds agent-api win summaries from traversal speeds", () => {
    // Every summary leads with the pace actually achieved and the rank it earned, since that is
    // the only figure comparable across mazes of different sizes.
    expect(buildAgentWinSummary(200, null, null)).toBe(
      "2.00 (Trailblazer) — new traversal speed record",
    )
    // Speed is better when higher, the opposite direction to the request count it replaced.
    expect(buildAgentWinSummary(200, 150, 250)).toBe(
      "2.00 (Trailblazer) — 0.50 faster than previous (0.50 behind best)",
    )
  })

  it("labels the leading speed with the rank that speed earned", () => {
    // The rank is derived from the achieved pace, never from the delta: a round can be behind the
    // stored best and still have earned trailblazer, or ahead of it and still be a backtracker.
    expect(buildAgentWinSummary(50, 25, 300)).toBe(
      "0.50 (Backtracker) — 0.25 faster than previous (2.50 behind best)",
    )
    expect(buildAgentWinSummary(100, 100, 100)).toBe(
      "1.00 (Navigator) — matched previous traversal speed (matched as best)",
    )
  })

  it("resolves interactive win summaries and retention metrics together", () => {
    expect(
      resolveWinScore({
        bestWinRetentionUnits: 1_000_000,
        bestWinTraversalSpeedUnits: null,
        controlMode: "interactive",
        lastAttemptRetentionUnits: 800_000,
        lastWinTraversalSpeedUnits: null,
        score: 900,
        totalCells: 10,
        traversalSpeedUnits: 200,
      }),
    ).toEqual({
      bestWinRetentionUnits: 1_000_000,
      // Interactive rounds carry the stored speed record through untouched: only agent-api play
      // is scored on traversal speed.
      bestWinTraversalSpeedUnits: null,
      lastAttemptRetentionUnits: 900_000,
      lastWinTraversalSpeedUnits: null,
      winSummary: "1.00s faster than previous (1.00s behind best)",
    })
  })

  it("resolves agent-api win summaries and traversal speed metrics together", () => {
    expect(
      resolveWinScore({
        bestWinRetentionUnits: 800_000,
        bestWinTraversalSpeedUnits: 250,
        controlMode: "agent-api",
        lastAttemptRetentionUnits: 700_000,
        lastWinTraversalSpeedUnits: 150,
        score: 900,
        totalCells: 10,
        traversalSpeedUnits: 200,
      }),
    ).toEqual({
      bestWinRetentionUnits: 900_000,
      // 2.00 does not beat the stored 2.50, so the record stands.
      bestWinTraversalSpeedUnits: 250,
      lastAttemptRetentionUnits: 900_000,
      lastWinTraversalSpeedUnits: 200,
      winSummary: "2.00 (Trailblazer) — 0.50 faster than previous (0.50 behind best)",
    })
  })

  it("stores a new agent-api speed record once the round beats the stored best", () => {
    expect(
      resolveWinScore({
        bestWinRetentionUnits: 800_000,
        bestWinTraversalSpeedUnits: 250,
        controlMode: "agent-api",
        lastAttemptRetentionUnits: 700_000,
        lastWinTraversalSpeedUnits: 150,
        score: 900,
        totalCells: 10,
        traversalSpeedUnits: 300,
      }),
    ).toMatchObject({
      bestWinTraversalSpeedUnits: 300,
      lastWinTraversalSpeedUnits: 300,
      winSummary: "3.00 (Trailblazer) — 1.50 faster than previous (new record)",
    })
  })
})
