import { describe, expect, it } from "vitest"

import { GameClock } from "./clock"

describe("GameClock", () => {
  it("tracks elapsed and remaining time from the level duration", () => {
    const clock = new GameClock(10_000)
    clock.startedAt = 100

    expect(clock.elapsed(2_600)).toBe(2_500)
    expect(clock.remaining(2_600)).toBe(7_500)
  })

  it("freezes elapsed time while paused and resumes from the paused offset", () => {
    const clock = new GameClock(10_000)
    clock.startedAt = 100

    clock.pause(2_600)
    expect(clock.elapsed(4_000)).toBe(2_500)
    expect(clock.remaining(4_000)).toBe(7_500)

    clock.resume(5_100)
    expect(clock.elapsed(5_100)).toBe(2_500)
    expect(clock.elapsed(6_100)).toBe(3_500)
    expect(clock.remaining(6_100)).toBe(6_500)
  })

  it("toggles the blink phase every half second", () => {
    const clock = new GameClock(10_000)
    clock.startedAt = 100

    expect(clock.blink(100)).toBe(true)
    expect(clock.blink(599)).toBe(true)
    expect(clock.blink(600)).toBe(false)
    expect(clock.blink(1_100)).toBe(true)
  })
})
