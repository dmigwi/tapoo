export class GameClock {
  levelDurationMs: number
  startedAt: number
  pausedAt: number
  pausedDuration: number

  constructor(levelDurationMs: number) {
    this.levelDurationMs = levelDurationMs
    this.startedAt = performance.now()
    this.pausedAt = 0
    this.pausedDuration = 0
  }

  elapsed(now = performance.now()): number {
    // Freeze elapsed time while paused so reloads and manual pauses keep the remaining time stable.
    const effectiveNow = this.pausedAt || now
    return effectiveNow - this.startedAt - this.pausedDuration
  }

  remaining(now = performance.now()): number {
    return Math.max(0, this.levelDurationMs - this.elapsed(now))
  }

  pause(now = performance.now()): void {
    if (!this.pausedAt) {
      this.pausedAt = now
    }
  }

  resume(now = performance.now()): void {
    if (!this.pausedAt) {
      return
    }

    this.pausedDuration += now - this.pausedAt
    this.pausedAt = 0
  }
}
