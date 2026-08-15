import { describe, expect, it } from "vitest"

import {
  canPersistRoundStatus,
  canProceedStatus,
  canShowRestart,
  canShowWallsStatus,
  hasActiveRoundState,
  isSuccessfulMoveStatus,
  isTooSmallStatus,
  stateInvariantError,
} from "./status"
import type { TooSmallStatus, ViewportFitStatus } from "./status"
import type { GameStatus, MoveStatus, PersistedGameStatus, State } from "./types"

// valuesOf turns an exhaustive record into the runtime list the tables below iterate. The record is
// what does the work: annotating a plain array as Status[] only asks that each element belong to the
// union, so a stale list stays valid when the union grows and every table silently keeps its old
// coverage. Requiring a key per member instead makes a widened union a compile error here.
function valuesOf<T extends string>(members: Record<T, true>): T[] {
  return Object.keys(members) as T[]
}

// ALL_STATUSES is every value GameStatus can take. Driving the tables off it means a new status
// added to the union has to be given an expected answer here rather than silently defaulting.
const ALL_STATUSES = valuesOf<GameStatus>({
  "boot": true,
  "running": true,
  "paused": true,
  "won": true,
  "lost": true,
  "await-agent": true,
  "too-small": true,
})

// PERSISTABLE_STATUSES mirrors PersistedGameStatus as runtime values, so the guard below can check
// a type-level claim that the compiler cannot verify on its own.
const PERSISTABLE_STATUSES = valuesOf<PersistedGameStatus>({
  "running": true,
  "paused": true,
  "won": true,
  "lost": true,
  "await-agent": true,
})

// ALL_VIEWPORT_FIT_STATUSES completes the input union isTooSmallStatus accepts, since it takes
// GameStatus | ViewportFitStatus and the two overlap only in meaning, never in values.
const ALL_VIEWPORT_FIT_STATUSES = valuesOf<ViewportFitStatus>({
  "fits": true,
  "too-small-length": true,
  "too-small-width": true,
  "too-small-all": true,
})

// TOO_SMALL_STATUSES mirrors TooSmallStatus as runtime values. That type is computed rather than
// written out — "too-small" | Exclude<ViewportFitStatus, "fits"> — so a new ViewportFitStatus member
// widens it with nothing written down changing. The missing key here is what surfaces that.
const TOO_SMALL_STATUSES = valuesOf<TooSmallStatus>({
  "too-small": true,
  "too-small-length": true,
  "too-small-width": true,
  "too-small-all": true,
})

function createClock(isPaused: boolean): State["clock"] {
  return {
    isPaused,
    pause: () => {},
    resume: () => {},
    elapsed: () => 0,
    blink: () => true,
    remaining: () => 1_000,
  } as State["clock"]
}

function createState(overrides: Partial<State> = {}): State {
  return {
    controlMode: "interactive",
    level: 1,
    status: "running",
    mazeDimensions: { numCols: 1, numRows: 1, area: 1 },
    maze: [
      ["|", "---", "|"],
      ["|", "   ", "|"],
      ["|", "---", "|"],
    ],
    startPosition: { x: 1, y: 1 },
    playerPosition: { x: 1, y: 1 },
    finalPosition: { x: 1, y: 1 },
    traversalHistory: [{ playerName: "Self", row: 0, col: 0, openMoves: [] }],
    score: 100,
    lastRoundScore: 0,
    lastAttemptRetentionUnits: null,
    bestWinRetentionUnits: null,
    lastWinTraversalSpeedUnits: null,
    bestWinTraversalSpeedUnits: null,
    winSummary: "",
    wallWeight: 1,
    scoreDecayUnits: 0,
    turnCount: 0,
    cumulativeRoundCount: 0,
    clock: createClock(false),
    ...overrides,
  }
}

describe("hasActiveRoundState", () => {
  it("accepts a round holding every field needed to draw, move, or save it", () => {
    expect(hasActiveRoundState(createState())).toBe(true)
  })

  // Each field is dropped on its own so a guard that stops checking one is caught here rather than
  // surfacing later as a null dereference in the render or persistence path.
  it.each([
    ["mazeDimensions", { mazeDimensions: null }],
    ["maze", { maze: null }],
    ["startPosition", { startPosition: null }],
    ["playerPosition", { playerPosition: null }],
    ["finalPosition", { finalPosition: null }],
    ["traversalHistory", { traversalHistory: [] }],
  ] as [string, Partial<State>][])("rejects a round missing %s", (_label, missing) => {
    expect(hasActiveRoundState(createState(missing))).toBe(false)
  })

  // The narrowing hasActiveRoundState claims is a type predicate, which the compiler takes on trust.
  // Reading each field back proves the runtime check actually covers everything the type promises.
  it("proves every field the predicate narrows is really present", () => {
    const state = createState()
    if (!hasActiveRoundState(state)) {
      throw new Error("fixture should satisfy hasActiveRoundState")
    }

    expect(state.mazeDimensions.area).toBe(1)
    expect(state.maze.length).toBeGreaterThan(0)
    expect(state.startPosition.x).toBe(1)
    expect(state.playerPosition.x).toBe(1)
    expect(state.finalPosition.x).toBe(1)
  })
})

describe("isTooSmallStatus", () => {
  it.each<[GameStatus | ViewportFitStatus, boolean]>([
    // The rendered state, plus the three internal measurements naming the axis that blocked the maze.
    ["too-small", true],
    ["too-small-length", true],
    ["too-small-width", true],
    ["too-small-all", true],
    // fits is the other half of ViewportFitStatus and the one case that must not be swept in.
    ["fits", false],
    // No game status other than too-small describes a viewport that cannot hold the maze.
    ["boot", false],
    ["running", false],
    ["paused", false],
    ["won", false],
    ["lost", false],
    ["await-agent", false],
  ])("returns %s for the %s status", (status, expected) => {
    expect(isTooSmallStatus(status)).toBe(expected)
  })

  it("only ever accepts statuses that TooSmallStatus can hold", () => {
    // isTooSmallStatus asserts `status is TooSmallStatus`, and TypeScript never checks a predicate
    // body against that claim. TooSmallStatus is derived from ViewportFitStatus, so adding a member
    // there widens the promised type while this four-way body keeps checking the old values —
    // callers would then narrow to a status the function never actually verified. Filtering both
    // input unions and matching the result against TOO_SMALL_STATUSES is what catches that.
    const inputs = [...ALL_STATUSES, ...ALL_VIEWPORT_FIT_STATUSES]
    const accepted = inputs.filter(isTooSmallStatus)
    accepted.forEach((status) => {
      expect(TOO_SMALL_STATUSES).toContain(status)
    })
    expect(accepted).toHaveLength(TOO_SMALL_STATUSES.length)
  })
})

describe("isSuccessfulMoveStatus", () => {
  it.each<[MoveStatus | undefined, boolean]>([
    ["applied", true],
    ["reached-target", true],
    ["invalid-move", false],
    ["malformed-response", false],
    ["token-limit-exhaustion", false],
    ["network-error", false],
    [undefined, false],
  ])("returns %s for %s", (status, expected) => {
    expect(isSuccessfulMoveStatus(status)).toBe(expected)
  })
})

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
    // Hidden mid-round so a stray tap cannot discard live progress.
    ["running", false],
    // Nothing exists to restart before the first round is built.
    ["boot", false],
  ])("returns %s for the %s status at level 1", (status, expected) => {
    expect(canShowRestart(status, 1)).toBe(expected)
  })

  it("answers for every status in the union, at level 1", () => {
    // Guards the table above against drifting out of sync with GameStatus.
    expect(
      ALL_STATUSES.every((status) => typeof canShowRestart(status, 1) === "boolean"),
    ).toBe(true)
    expect(ALL_STATUSES.filter((status) => canShowRestart(status, 1))).toEqual([
      "paused",
      "won",
      "lost",
      "await-agent",
    ])
  })

  it("covers canProceedStatus regardless of level", () => {
    ALL_STATUSES.filter(canProceedStatus).forEach((status) => {
      expect(canShowRestart(status, 1)).toBe(true)
      expect(canShowRestart(status, 3)).toBe(true)
    })
  })

  // Reset Progress always restarts at level 1 (restartGame in game.ts), so too-small only offers a
  // way out when there's a lower level to fall back to.
  it("offers restart from too-small only when a lower level exists", () => {
    expect(canShowRestart("too-small", 1)).toBe(false)
    expect(canShowRestart("too-small", 2)).toBe(true)
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

describe("stateInvariantError", () => {
  it("accepts internally consistent running and paused states", () => {
    expect(stateInvariantError(createState({ status: "running", clock: createClock(false) }))).toBeNull()
    expect(stateInvariantError(createState({ status: "paused", clock: createClock(true) }))).toBeNull()
  })

  it("rejects paused status when the clock is not paused", () => {
    expect(stateInvariantError(createState({ status: "paused", clock: createClock(false) }))).toBe(
      "invalid game state: paused status requires a paused clock",
    )
  })

  it("rejects running status when the clock is paused", () => {
    expect(stateInvariantError(createState({ status: "running", clock: createClock(true) }))).toBe(
      "invalid game state: running status requires an active clock",
    )
  })

  it("rejects active statuses without round data", () => {
    expect(
      stateInvariantError(createState({
        status: "running",
        maze: null,
        mazeDimensions: null,
        startPosition: null,
        playerPosition: null,
        finalPosition: null,
        traversalHistory: [],
      })),
    ).toBe("invalid game state: running status requires an active round")
  })

  it("rejects boot and too-small states that still keep active round data", () => {
    expect(stateInvariantError(createState({ status: "boot", clock: null }))).toBe(
      "invalid game state: boot status cannot keep an active round",
    )
    expect(stateInvariantError(createState({ status: "too-small", clock: null }))).toBe(
      "invalid game state: too-small status cannot keep an active round",
    )
  })
})
