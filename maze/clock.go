package maze

import "time"

// GameClock tracks elapsed and remaining time for a level while excluding
// any span where gameplay is paused.
type GameClock struct {
	startedAt      time.Time
	pausedAt       time.Time
	pausedDuration time.Duration
	levelDuration  time.Duration
}

// NewGameClock creates a new per-level clock using the provided duration budget.
func NewGameClock(levelDuration time.Duration) GameClock {
	return GameClock{
		startedAt:     time.Now(),
		levelDuration: levelDuration,
	}
}

// Elapsed subtracts paused time so scoring and timeout logic continue from the same point after resume.
func (clock *GameClock) Elapsed() time.Duration {
	return clock.elapsedAt(time.Now())
}

// Remaining clamps at zero because timers should never be reset with a negative duration.
func (clock *GameClock) Remaining() time.Duration {
	remaining := clock.levelDuration - clock.Elapsed()
	if remaining < 0 {
		return 0
	}

	return remaining
}

// Pause records when the clock stopped advancing.
func (clock *GameClock) Pause() {
	clock.pausedAt = time.Now()
}

// Resume accumulates the paused duration and resumes elapsed-time accounting.
func (clock *GameClock) Resume() {
	if clock.pausedAt.IsZero() {
		return
	}

	// Resume accumulates the paused span instead of shifting startedAt so elapsed math stays simple.
	clock.pausedDuration += time.Since(clock.pausedAt)
	clock.pausedAt = time.Time{}
}

// BlinkOn reports whether the live goal marker should be visible on the current
// refresh tick. The blink cadence follows elapsed gameplay time, so paused time
// does not advance the animation.
func (clock *GameClock) BlinkOn() bool {
	return clock.blinkOnAt(time.Now())
}

func (clock *GameClock) elapsedAt(now time.Time) time.Duration {
	if !clock.pausedAt.IsZero() {
		now = clock.pausedAt
	}

	return now.Sub(clock.startedAt) - clock.pausedDuration
}

func (clock *GameClock) blinkOnAt(now time.Time) bool {
	return clock.elapsedAt(now)%goalBlinkInterval < goalBlinkOnDuration
}
