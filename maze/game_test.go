package maze_test

import (
	"errors"
	"strings"
	"testing"
	"time"

	termbox "github.com/nsf/termbox-go"

	"github.com/dmigwi/tapoo/maze"
)

func TestPlayerMovement(t *testing.T) {
	t.Parallel()

	data := [][]string{
		{"|", "---", "|", "---", "|", "---", "|"},
		{"|", " A ", " ", "   ", "|", "   ", "|"},
		{"|", "   ", "|", "   ", "|", "---", "|"},
		{"|", "   ", " ", " B ", " ", "   ", "|"},
		{"|", "---", "|", "   ", "|", "---", "|"},
		{"|", "   ", "|", "   ", "|", "   ", "|"},
		{"|", "---", "|", "---", "|", "---", "|"},
	}

	tests := []struct {
		name      string
		startPos  []int
		direction string
		wantPos   []int
	}{
		{name: "move left", startPos: []int{3, 3}, direction: "LEFT", wantPos: []int{3, 1}},
		{name: "move right", startPos: []int{3, 3}, direction: "RIGHT", wantPos: []int{3, 5}},
		{name: "move up", startPos: []int{3, 3}, direction: "UP", wantPos: []int{1, 3}},
		{name: "move down", startPos: []int{3, 3}, direction: "DOWN", wantPos: []int{5, 3}},
		{name: "blocked left at edge", startPos: []int{1, 1}, direction: "LEFT", wantPos: []int{1, 1}},
		{name: "allowed right at edge", startPos: []int{1, 1}, direction: "RIGHT", wantPos: []int{1, 3}},
		{name: "allowed down at edge", startPos: []int{1, 1}, direction: "DOWN", wantPos: []int{3, 1}},
		{name: "blocked up at edge", startPos: []int{1, 1}, direction: "UP", wantPos: []int{1, 1}},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			dimensions := maze.Dimensions{
				Length:        3,
				Width:         3,
				StartPosition: append([]int(nil), testCase.startPos...),
			}

			dimensions.PlayerMovement(data, testCase.direction)
			if !equalIntSlice(dimensions.StartPosition, testCase.wantPos) {
				t.Fatalf(
					"unexpected position after %s: got %v want %v",
					testCase.direction,
					dimensions.StartPosition,
					testCase.wantPos,
				)
			}
		})
	}
}

func TestHandlePlayerMovement(t *testing.T) {
	t.Parallel()

	data := [][]string{
		{"|", "---", "|", "---", "|", "---", "|"},
		{"|", " A ", " ", "   ", "|", "   ", "|"},
		{"|", "   ", "|", "   ", "|", "---", "|"},
		{"|", "   ", " ", " B ", " ", "   ", "|"},
		{"|", "---", "|", "   ", "|", "---", "|"},
		{"|", "   ", "|", "   ", "|", "   ", "|"},
		{"|", "---", "|", "---", "|", "---", "|"},
	}

	t.Run("arrow keys move without a status", func(t *testing.T) {
		t.Parallel()

		tests := []struct {
			name     string
			key      termbox.Key
			startPos []int
			wantPos  []int
		}{
			{name: "left", key: termbox.KeyArrowLeft, startPos: []int{3, 3}, wantPos: []int{3, 1}},
			{name: "right", key: termbox.KeyArrowRight, startPos: []int{3, 3}, wantPos: []int{3, 5}},
			{name: "up", key: termbox.KeyArrowUp, startPos: []int{3, 1}, wantPos: []int{1, 1}},
			{name: "down", key: termbox.KeyArrowDown, startPos: []int{3, 3}, wantPos: []int{5, 3}},
		}

		for _, testCase := range tests {
			t.Run(testCase.name, func(t *testing.T) {
				t.Parallel()

				dimensions := maze.Dimensions{
					Length:        3,
					Width:         3,
					StartPosition: append([]int(nil), testCase.startPos...),
				}

				status, ok := dimensions.HandlePlayerMovement(testCase.key, data)
				if ok {
					t.Fatalf("expected no status for arrow key %v, got %d", testCase.key, status)
				}

				if status != 0 {
					t.Fatalf("expected zero status for arrow key %v, got %d", testCase.key, status)
				}

				if !equalIntSlice(dimensions.StartPosition, testCase.wantPos) {
					t.Fatalf(
						"unexpected position for key %v: got %v want %v",
						testCase.key,
						dimensions.StartPosition,
						testCase.wantPos,
					)
				}
			})
		}
	})

	t.Run("control keys return statuses", func(t *testing.T) {
		t.Parallel()

		tests := []struct {
			name string
			key  termbox.Key
			want int
		}{
			{name: "quit", key: termbox.KeyEsc, want: maze.StatusQuit},
			{name: "proceed", key: termbox.KeyCtrlP, want: maze.StatusProceed},
			{name: "pause", key: termbox.KeySpace, want: maze.StatusPause},
		}

		for _, testCase := range tests {
			t.Run(testCase.name, func(t *testing.T) {
				t.Parallel()

				dimensions := maze.Dimensions{Length: 3, Width: 3}
				got, ok := dimensions.HandlePlayerMovement(testCase.key, data)
				if !ok {
					t.Fatalf("expected a status for key %v", testCase.key)
				}

				if got != testCase.want {
					t.Fatalf("unexpected status for key %v: got %d want %d", testCase.key, got, testCase.want)
				}
			})
		}
	})
}

func TestGameClock(t *testing.T) {
	t.Parallel()

	t.Run("tracks elapsed time across pause and resume", func(t *testing.T) {
		t.Parallel()

		clock := maze.NewGameClock(250 * time.Millisecond)

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

	t.Run("clamps remaining time at zero after expiration", func(t *testing.T) {
		t.Parallel()

		clock := maze.NewGameClock(20 * time.Millisecond)
		clock.Resume()

		time.Sleep(40 * time.Millisecond)

		if got := clock.Remaining(); got != 0 {
			t.Fatalf("expected remaining duration to clamp at zero, got %v", got)
		}
	})
}

func TestCalculateScore(t *testing.T) {
	t.Parallel()

	got := maze.CalculateScore(10, 3*time.Second)
	if got != 700 {
		t.Fatalf("unexpected score: got %d want %d", got, 700)
	}
}

func TestStartWithUI(t *testing.T) {
	t.Parallel()

	t.Run("returns initialization errors", func(t *testing.T) {
		t.Parallel()

		ui := newFakeUI(40, 80)
		ui.initErr = errors.New("init failed")

		err := maze.StartWithUI(ui)
		if err == nil {
			t.Fatal("expected start with ui to return an initialization error")
		}

		if !strings.Contains(err.Error(), "initialize termbox: init failed") {
			t.Fatalf("unexpected initialization error: %v", err)
		}

		if ui.closeCalls != 0 {
			t.Fatalf("expected no close calls after init failure, got %d", ui.closeCalls)
		}
	})

	t.Run("returns setup errors for undersized terminals", func(t *testing.T) {
		t.Parallel()

		ui := newFakeUI(10, 10)

		err := maze.StartWithUI(ui)
		if err == nil {
			t.Fatal("expected start with ui to return a setup error")
		}

		if !strings.Contains(err.Error(), "get maze dimensions") {
			t.Fatalf("unexpected setup error: %v", err)
		}

		if ui.closeCalls != 1 {
			t.Fatalf("expected close to be called after setup failure, got %d", ui.closeCalls)
		}
	})

	t.Run("runs the generated maze until quit", func(t *testing.T) {
		t.Parallel()

		ui := newFakeUI(60, 40)
		ui.enqueueEvents(termbox.Event{Type: termbox.EventKey, Key: termbox.KeyEsc})

		err := maze.StartWithUI(ui)
		if err != nil {
			t.Fatalf("start with ui returned error: %v", err)
		}

		if ui.initCalls != 1 {
			t.Fatalf("expected a single init call, got %d", ui.initCalls)
		}

		if ui.closeCalls != 1 {
			t.Fatalf("expected a single close call, got %d", ui.closeCalls)
		}

		if ui.inputMode != termbox.InputEsc {
			t.Fatalf("expected input mode %v, got %v", termbox.InputEsc, ui.inputMode)
		}
	})
}

func TestPlayWithUI(t *testing.T) {
	t.Parallel()

	t.Run("returns keyboard polling errors", func(t *testing.T) {
		t.Parallel()

		ui := newFakeUI(40, 80)
		t.Cleanup(ui.Close)

		ui.enqueueEvents(termbox.Event{Type: termbox.EventError, Err: errors.New("keyboard failed")})

		err := maze.PlayWithUI(ui, &maze.Dimensions{Length: 3, Width: 3}, sampleMazeGrid())
		if err == nil {
			t.Fatal("expected play with ui to return a keyboard error")
		}

		if !strings.Contains(err.Error(), "read keyboard input: keyboard failed") {
			t.Fatalf("unexpected keyboard error: %v", err)
		}
	})

	t.Run("handles pause resume and quit statuses", func(t *testing.T) {
		t.Parallel()

		ui := newFakeUI(40, 80)
		t.Cleanup(ui.Close)

		ui.enqueueEvents(
			termbox.Event{Type: termbox.EventKey, Key: termbox.KeySpace},
			termbox.Event{Type: termbox.EventKey, Key: termbox.KeyCtrlP},
			termbox.Event{Type: termbox.EventKey, Key: termbox.KeyEsc},
		)

		err := maze.PlayWithUI(ui, &maze.Dimensions{
			Length:        3,
			Width:         3,
			StartPosition: []int{1, 1},
			FinalPosition: []int{3, 3},
		}, sampleMazeGrid())
		if err != nil {
			t.Fatalf("play with ui returned error: %v", err)
		}

		if ui.flushCalls == 0 {
			t.Fatal("expected play with ui to render at least one overlay during pause handling")
		}

		if !ui.containsText("Game Paused") {
			t.Fatal("expected pause handling to render the pause overlay")
		}
	})

	t.Run("handles timeout screens", func(t *testing.T) {
		t.Parallel()

		ui := newFakeUI(40, 80)
		t.Cleanup(ui.Close)

		go func() {
			time.Sleep(100 * time.Millisecond)
			ui.enqueueEvents(termbox.Event{Type: termbox.EventKey, Key: termbox.KeyEsc})
		}()

		err := maze.PlayWithUI(ui, &maze.Dimensions{}, sampleMazeGrid())
		if err != nil {
			t.Fatalf("play with ui returned error: %v", err)
		}

		if !ui.containsText("Failed to locate the target on time") {
			t.Fatal("expected timeout handling to render the failure overlay")
		}
	})

	t.Run("handles a winning tick", func(t *testing.T) {
		t.Parallel()

		ui := newFakeUI(40, 80)
		t.Cleanup(ui.Close)

		go func() {
			time.Sleep(120 * time.Millisecond)
			ui.enqueueEvents(termbox.Event{Type: termbox.EventKey, Key: termbox.KeyEsc})
		}()

		err := maze.PlayWithUI(ui, &maze.Dimensions{
			Length:        1,
			Width:         1,
			StartPosition: []int{1, 1},
			FinalPosition: []int{1, 1},
		}, sampleMazeGrid())
		if err != nil {
			t.Fatalf("play with ui returned error: %v", err)
		}

		if !ui.containsText("Congratulations") {
			t.Fatal("expected the winning tick to render the success overlay")
		}
	})
}

func equalIntSlice(left, right []int) bool {
	if len(left) != len(right) {
		return false
	}

	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}

	return true
}
