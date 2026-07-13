const blinkIntervalMs = 500

// GameClock tracks elapsed play time, pause state, and destination blinking cadence.
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

  // elapsed reports active time only, excluding any paused duration.
  elapsed(now = performance.now()): number {
    // Freeze elapsed time while paused so reloads and manual pauses keep the remaining time stable.
    const effectiveNow = this.pausedAt || now
    return effectiveNow - this.startedAt - this.pausedDuration
  }

  // remaining returns the still-playable time clamped at zero.
  remaining(now = performance.now()): number {
    return Math.max(0, this.levelDurationMs - this.elapsed(now))
  }

  // blink toggles the destination marker in half-second phases.
  blink(now = performance.now()): boolean {
    // Alternate the destination visibility in half-second phases while the round is active.
    return Math.floor(this.elapsed(now) / blinkIntervalMs) % 2 === 0
  }

  // pause captures the instant at which active time should stop advancing.
  pause(now = performance.now()): void {
    if (!this.pausedAt) {
      this.pausedAt = now
    }
  }

  // resume folds the paused span back into the accumulated pause duration.
  resume(now = performance.now()): void {
    if (!this.pausedAt) {
      return
    }

    this.pausedDuration += now - this.pausedAt
    this.pausedAt = 0
  }
}
