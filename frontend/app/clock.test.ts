import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { GameClock } from "./clock"
import { CONFIG } from "./config"

function stubMatchMedia(matches: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  )
}

// These tests keep timing, pause, and blink semantics stable across refactors.
describe("GameClock", () => {
  // blink() reads prefers-reduced-motion on every call; default matches: false so the tests below
  // keep exercising the normal toggle unless a test explicitly overrides it.
  beforeEach(() => {
    stubMatchMedia(false)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

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

  it("toggles the blink phase at the configured interval", () => {
    const clock = new GameClock(10_000)
    clock.startedAt = 100
    const { blinkIntervalMs } = CONFIG.timing

    expect(clock.blink(100)).toBe(true)
    expect(clock.blink(100 + blinkIntervalMs - 1)).toBe(true)
    expect(clock.blink(100 + blinkIntervalMs)).toBe(false)
    expect(clock.blink(100 + blinkIntervalMs * 2)).toBe(true)
  })

  it("stays steadily visible instead of toggling when prefers-reduced-motion is set", () => {
    stubMatchMedia(true)
    const clock = new GameClock(10_000)
    clock.startedAt = 100
    const { blinkIntervalMs } = CONFIG.timing

    // Same instants the toggle test above uses - every one of them would normally alternate,
    // so a steady true across all of them proves reduced motion is actually overriding the phase.
    expect(clock.blink(100)).toBe(true)
    expect(clock.blink(100 + blinkIntervalMs - 1)).toBe(true)
    expect(clock.blink(100 + blinkIntervalMs)).toBe(true)
    expect(clock.blink(100 + blinkIntervalMs * 2)).toBe(true)
  })
})
