const blinkIntervalMs = 500

// GameClock tracks elapsed play time, pause state, and destination blinking cadence.
export class GameClock {
  levelDurationMs: number
  startedAt: number
  // pausedAt is a timestamp, not a flag: 0 means the clock has never been stopped or has since
  // resumed, and any other value is the instant the current pause began. isPaused is the only
  // place that sentinel is read, so no caller has to remember which way round it goes.
  pausedAt: number
  pausedDuration: number

  constructor(levelDurationMs: number) {
    this.levelDurationMs = levelDurationMs
    this.startedAt = performance.now()
    this.pausedAt = 0
    this.pausedDuration = 0
  }

  // isPaused reports whether active time is currently frozen.
  get isPaused(): boolean {
    return this.pausedAt !== 0
  }

  // elapsed reports active time only, excluding any paused duration.
  elapsed(now = performance.now()): number {
    // Freeze elapsed time while paused so reloads and manual pauses keep the remaining time stable.
    const effectiveNow = this.isPaused ? this.pausedAt : now
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
    // Already stopped: keep the original instant so a repeated pause cannot extend the frozen span.
    if (this.isPaused) {
      return
    }

    this.pausedAt = now
  }

  // resume folds the paused span back into the accumulated pause duration.
  resume(now = performance.now()): void {
    // Already running: there is no frozen span to fold back in.
    if (!this.isPaused) {
      return
    }

    this.pausedDuration += now - this.pausedAt
    this.pausedAt = 0
  }
}
