package maze_test

import (
	"testing"
	"time"

	"github.com/dmigwi/tapoo/maze"
)

func TestGameClock(t *testing.T) {
	t.Parallel()

	t.Run("starts with near-zero elapsed time and nearly full remaining budget", func(t *testing.T) {
		t.Parallel()

		clock := maze.NewGameClock(time.Second)

		if elapsed := clock.Elapsed(); elapsed < 0 || elapsed > 20*time.Millisecond {
			t.Fatalf("expected a fresh clock to have near-zero elapsed time, got %v", elapsed)
		}

		remaining := clock.Remaining()
		if remaining > time.Second || remaining < 900*time.Millisecond {
			t.Fatalf("expected a fresh clock to preserve most of its budget, got %v", remaining)
		}
	})

	t.Run("tracks elapsed time across pause and resume", func(t *testing.T) {
		t.Parallel()

		clock := maze.NewGameClock(maze.RefreshInterval)

		time.Sleep(30 * time.Millisecond)
		clock.Pause()
		time.Sleep(120 * time.Millisecond)
		clock.Resume()

		remainingAfterResume := clock.Remaining()
		if remainingAfterResume < 160*time.Millisecond {
			t.Fatalf("expected paused time to be excluded from remaining duration, got %v", remainingAfterResume)
		}

		time.Sleep(40 * time.Millisecond)

		elapsed := clock.Elapsed()
		if elapsed < 50*time.Millisecond || elapsed > 140*time.Millisecond {
			t.Fatalf("unexpected elapsed duration after pause and resume: %v", elapsed)
		}

		if got := clock.Remaining(); got >= remainingAfterResume {
			t.Fatalf(
				"expected remaining duration to keep decreasing after resume: before=%v after=%v",
				remainingAfterResume,
				got,
			)
		}
	})

	t.Run("freezes elapsed time and remaining budget while paused", func(t *testing.T) {
		t.Parallel()

		clock := maze.NewGameClock(time.Second)

		time.Sleep(40 * time.Millisecond)
		clock.Pause()
		elapsedWhenPaused := clock.Elapsed()
		remainingWhenPaused := clock.Remaining()

		time.Sleep(120 * time.Millisecond)

		elapsedWhilePaused := clock.Elapsed()
		if elapsedWhilePaused > elapsedWhenPaused+20*time.Millisecond {
			t.Fatalf(
				"expected elapsed time to stop advancing while paused: paused=%v later=%v",
				elapsedWhenPaused,
				elapsedWhilePaused,
			)
		}

		remainingWhilePaused := clock.Remaining()
		if remainingWhilePaused < remainingWhenPaused-20*time.Millisecond {
			t.Fatalf(
				"expected remaining duration to stop decreasing while paused: paused=%v later=%v",
				remainingWhenPaused,
				remainingWhilePaused,
			)
		}
	})

	t.Run("resume is a no-op when the clock was never paused", func(t *testing.T) {
		t.Parallel()

		clock := maze.NewGameClock(time.Second)
		time.Sleep(40 * time.Millisecond)
		elapsedBeforeResume := clock.Elapsed()

		clock.Resume()

		time.Sleep(40 * time.Millisecond)
		elapsedAfterResume := clock.Elapsed()
		if elapsedAfterResume <= elapsedBeforeResume {
			t.Fatalf(
				"expected elapsed time to keep advancing when resume is called on a running clock: before=%v after=%v",
				elapsedBeforeResume,
				elapsedAfterResume,
			)
		}
	})

	t.Run("clamps remaining time at zero after expiration", func(t *testing.T) {
		t.Parallel()

		clock := maze.NewGameClock(20 * time.Millisecond)
		clock.Resume()

		time.Sleep(40 * time.Millisecond)

		if got := clock.Remaining(); got != 0 {
			t.Fatalf("expected remaining duration to clamp at zero, got %v", got)
		}
	})

	t.Run("blinks the destination on and off at half-second intervals", func(t *testing.T) {
		t.Parallel()

		clock := maze.NewGameClock(3 * time.Second)
		if !clock.BlinkOn() {
			t.Fatalf("expected a fresh game clock to begin with the destination visible")
		}

		time.Sleep(600 * time.Millisecond)

		if clock.BlinkOn() {
			t.Fatalf("expected destination blink to switch off after half a second")
		}

		time.Sleep(500 * time.Millisecond)

		if !clock.BlinkOn() {
			t.Fatalf("expected destination blink to switch back on after a full second")
		}
	})

	t.Run("freezes blink state while paused", func(t *testing.T) {
		t.Parallel()

		clock := maze.NewGameClock(3 * time.Second)

		time.Sleep(600 * time.Millisecond)
		if clock.BlinkOn() {
			t.Fatalf("expected blink to be off before pause so the paused-state check is meaningful")
		}

		clock.Pause()
		blinkWhenPaused := clock.BlinkOn()

		time.Sleep(700 * time.Millisecond)

		if clock.BlinkOn() != blinkWhenPaused {
			t.Fatalf("expected blink state to stay frozen while paused")
		}
	})
}
