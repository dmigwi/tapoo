import { describe, expect, it } from "vitest"

import {
  canPersistRoundStatus,
  canProceedStatus,
  canShowRestart,
  canShowWallsStatus,
} from "./status"
import type { GameStatus, PersistedGameStatus } from "./types"

// ALL_STATUSES is every value GameStatus can take. Driving the tables off it means a new status
// added to the union has to be given an expected answer here rather than silently defaulting.
const ALL_STATUSES: GameStatus[] = [
  "boot",
  "running",
  "paused",
  "won",
  "lost",
  "await-agent",
  "too-small",
]

// PERSISTABLE_STATUSES mirrors PersistedGameStatus as runtime values, so the guard below can check
// a type-level claim that the compiler cannot verify on its own.
const PERSISTABLE_STATUSES: PersistedGameStatus[] = [
  "running",
  "paused",
  "won",
  "lost",
  "await-agent",
]

describe("canProceedStatus", () => {
  it.each<[GameStatus, boolean]>([
    // A stopped round is one the player can advance out of.
    ["paused", true],
    ["won", true],
    ["lost", true],
    ["await-agent", true],
    // Mid-round there is nothing to proceed to.
    ["running", false],
    // No maze is drawn in either of these, so there is no round to advance.
    ["too-small", false],
    ["boot", false],
  ])("returns %s for the %s status", (status, expected) => {
    expect(canProceedStatus(status)).toBe(expected)
  })

  it("accepts exactly the stopped round statuses", () => {
    expect(ALL_STATUSES.filter(canProceedStatus)).toEqual([
      "paused",
      "won",
      "lost",
      "await-agent",
    ])
  })
})

describe("canShowWallsStatus", () => {
  it.each<[GameStatus, boolean]>([
    ["paused", true],
    ["won", true],
    ["lost", true],
    ["await-agent", true],
    // Reweighting mid-round would redraw the maze under the player.
    ["running", false],
    ["too-small", false],
    ["boot", false],
  ])("returns %s for the %s status", (status, expected) => {
    expect(canShowWallsStatus(status)).toBe(expected)
  })

  it("matches canProceedStatus for every status", () => {
    // The two are defined as the same set. Pinning that here means splitting them later has to be
    // a deliberate edit rather than a silent divergence.
    ALL_STATUSES.forEach((status) => {
      expect(canShowWallsStatus(status)).toBe(canProceedStatus(status))
    })
  })
})

describe("canShowRestart", () => {
  it.each<[GameStatus, boolean]>([
    // Offered wherever the round is stopped and the player needs a way to start over.
    ["paused", true],
    ["won", true],
    ["lost", true],
    ["await-agent", true],
    // The viewport is too small to draw a maze, so restarting is the only route out of it. This
    // is what separates canShowRestart from canProceedStatus and canShowWallsStatus.
    ["too-small", true],
    // Hidden mid-round so a stray tap cannot discard live progress.
    ["running", false],
    // Nothing exists to restart before the first round is built.
    ["boot", false],
  ])("returns %s for the %s status", (status, expected) => {
    expect(canShowRestart(status)).toBe(expected)
  })

  it("answers for every status in the union", () => {
    // Guards the table above against drifting out of sync with GameStatus.
    expect(ALL_STATUSES.every((status) => typeof canShowRestart(status) === "boolean")).toBe(true)
    expect(ALL_STATUSES.filter(canShowRestart)).toEqual([
      "paused",
      "won",
      "lost",
      "await-agent",
      "too-small",
    ])
  })

  it("covers canProceedStatus and adds too-small on top", () => {
    ALL_STATUSES.filter(canProceedStatus).forEach((status) => {
      expect(canShowRestart(status)).toBe(true)
    })
    expect(canShowRestart("too-small")).toBe(true)
    expect(canProceedStatus("too-small")).toBe(false)
  })
})

describe("canPersistRoundStatus", () => {
  it.each<[GameStatus, boolean]>([
    // A live round has to survive a reload, which is the whole point of persisting it.
    ["running", true],
    ["paused", true],
    ["won", true],
    ["lost", true],
    ["await-agent", true],
    // Neither has a round to restore: boot precedes the first maze, too-small discarded it.
    ["boot", false],
    ["too-small", false],
  ])("returns %s for the %s status", (status, expected) => {
    expect(canPersistRoundStatus(status)).toBe(expected)
  })

  it("only ever accepts statuses that PersistedGameStatus can hold", () => {
    // canPersistRoundStatus is a type predicate asserting `status is PersistedGameStatus`, but it
    // is now defined as `isRunningStatus || canProceedStatus` and canProceedStatus returns a plain
    // boolean. TypeScript never verifies a predicate body, so nothing at compile time stops
    // canProceedStatus from later widening — folding in too-small would make this function claim a
    // non-persistable status is persistable, and an unrestorable round would reach storage.
    const accepted = ALL_STATUSES.filter(canPersistRoundStatus)
    accepted.forEach((status) => {
      expect(PERSISTABLE_STATUSES).toContain(status)
    })
    expect(accepted).toHaveLength(PERSISTABLE_STATUSES.length)
  })

  it("keeps canProceedStatus within the persistable set", () => {
    // The same invariant stated at its source: every status that can proceed must be persistable,
    // which is what lets canPersistRoundStatus delegate to it without weakening its predicate.
    ALL_STATUSES.filter(canProceedStatus).forEach((status) => {
      expect(PERSISTABLE_STATUSES).toContain(status)
    })
  })
})
