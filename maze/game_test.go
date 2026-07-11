package maze_test

import (
	"errors"
	"path/filepath"
	"slices"
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
		name     string
		startPos [2]int
		rowDelta int
		colDelta int
		wantPos  [2]int
	}{
		{name: "move left", startPos: [2]int{3, 3}, rowDelta: 0, colDelta: -1, wantPos: [2]int{3, 1}},
		{name: "move right", startPos: [2]int{3, 3}, rowDelta: 0, colDelta: 1, wantPos: [2]int{3, 5}},
		{name: "move up", startPos: [2]int{3, 3}, rowDelta: -1, colDelta: 0, wantPos: [2]int{1, 3}},
		{name: "move down", startPos: [2]int{3, 3}, rowDelta: 1, colDelta: 0, wantPos: [2]int{5, 3}},
		{name: "blocked left at edge", startPos: [2]int{1, 1}, rowDelta: 0, colDelta: -1, wantPos: [2]int{1, 1}},
		{name: "allowed right at edge", startPos: [2]int{1, 1}, rowDelta: 0, colDelta: 1, wantPos: [2]int{1, 3}},
		{name: "allowed down at edge", startPos: [2]int{1, 1}, rowDelta: 1, colDelta: 0, wantPos: [2]int{3, 1}},
		{name: "blocked up at edge", startPos: [2]int{1, 1}, rowDelta: -1, colDelta: 0, wantPos: [2]int{1, 1}},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			dimensions := maze.Dimensions{
				Length:        3,
				Width:         3,
				StartPosition: testCase.startPos,
			}

			dimensions.PlayerMovement(data, testCase.rowDelta, testCase.colDelta)
			if !slices.Equal(dimensions.StartPosition[:], testCase.wantPos[:]) {
				t.Fatalf(
					"unexpected position after delta (%d,%d): got %v want %v",
					testCase.rowDelta,
					testCase.colDelta,
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
			startPos [2]int
			wantPos  [2]int
		}{
			{name: "left", key: termbox.KeyArrowLeft, startPos: [2]int{3, 3}, wantPos: [2]int{3, 1}},
			{name: "right", key: termbox.KeyArrowRight, startPos: [2]int{3, 3}, wantPos: [2]int{3, 5}},
			{name: "up", key: termbox.KeyArrowUp, startPos: [2]int{3, 1}, wantPos: [2]int{1, 1}},
			{name: "down", key: termbox.KeyArrowDown, startPos: [2]int{3, 3}, wantPos: [2]int{5, 3}},
		}

		for _, testCase := range tests {
			t.Run(testCase.name, func(t *testing.T) {
				t.Parallel()

				dimensions := maze.Dimensions{
					Length:        3,
					Width:         3,
					StartPosition: testCase.startPos,
				}

				status, ok := dimensions.HandlePlayerMovement(testCase.key, data)
				if ok {
					t.Fatalf("expected no status for arrow key %v, got %d", testCase.key, status)
				}

				if status != 0 {
					t.Fatalf("expected zero status for arrow key %v, got %d", testCase.key, status)
				}

				if !slices.Equal(dimensions.StartPosition[:], testCase.wantPos[:]) {
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
			{name: "cycle wall weight", key: termbox.KeyCtrlB, want: maze.StatusCycleWallWeight},
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

		err := maze.PlayPreparedGameWithStore(ui, &maze.Dimensions{Length: 3, Width: 3},
			sampleMazeGrid(), maze.StoredGameState{
				Level:      1,
				WallWeight: maze.WallWeightRegular,
				State:      maze.GameProgressInProgress,
			}, nil)
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

		err := maze.PlayPreparedGameWithStore(ui, &maze.Dimensions{
			Length:        3,
			Width:         3,
			StartPosition: [2]int{1, 1},
			FinalPosition: [2]int{3, 3},
		}, sampleMazeGrid(), maze.StoredGameState{
			Level:      1,
			WallWeight: maze.WallWeightRegular,
			State:      maze.GameProgressInProgress,
		}, nil)
		if err != nil {
			t.Fatalf("play with ui returned error: %v", err)
		}

		if ui.flushCalls == 0 {
			t.Fatal("expected play with ui to render at least one overlay during pause handling")
		}

		if !ui.containsText("Scores:") {
			t.Fatal("expected Ctrl+P after pause to return to the live game view")
		}
	})

	t.Run("cycles wall weight and renders the updated maze on the next refresh tick", func(t *testing.T) {
		t.Parallel()

		ui := newFakeUI(40, 80)
		t.Cleanup(ui.Close)

		ui.enqueueEvents(termbox.Event{Type: termbox.EventKey, Key: termbox.KeyCtrlB})
		go func() {
			time.Sleep(2 * maze.RefreshInterval)
			ui.enqueueEvents(termbox.Event{Type: termbox.EventKey, Key: termbox.KeyEsc})
		}()

		err := maze.PlayPreparedGameWithStore(ui, &maze.Dimensions{
			Length:        3,
			Width:         3,
			StartPosition: [2]int{1, 1},
			FinalPosition: [2]int{3, 3},
		}, sampleMazeGrid(), maze.StoredGameState{
			Level:      1,
			WallWeight: maze.WallWeightRegular,
			State:      maze.GameProgressInProgress,
		}, nil)
		if err != nil {
			t.Fatalf("play with ui returned error: %v", err)
		}

		want := "   ╏╍╍╍╏╍╍╍╏╍╍╍╏"
		got := ui.rowText(7, 0, len([]rune(want))-1)
		if got != want {
			t.Fatalf("expected Ctrl+B to update the maze on the next refresh tick: got %q want %q", got, want)
		}
	})

	t.Run("wraps wall weight back to the initial weight after the last supported style", func(t *testing.T) {
		t.Parallel()

		ui := newFakeUI(40, 80)
		t.Cleanup(ui.Close)

		ui.enqueueEvents(
			termbox.Event{Type: termbox.EventKey, Key: termbox.KeyCtrlB},
			termbox.Event{Type: termbox.EventKey, Key: termbox.KeyCtrlB},
			termbox.Event{Type: termbox.EventKey, Key: termbox.KeyCtrlB},
		)
		go func() {
			time.Sleep(2 * maze.RefreshInterval)
			ui.enqueueEvents(termbox.Event{Type: termbox.EventKey, Key: termbox.KeyEsc})
		}()

		err := maze.PlayPreparedGameWithStore(ui, &maze.Dimensions{
			Length:        3,
			Width:         3,
			StartPosition: [2]int{1, 1},
			FinalPosition: [2]int{3, 3},
		}, sampleMazeGrid(), maze.StoredGameState{
			Level:      1,
			WallWeight: maze.WallWeightRegular,
			State:      maze.GameProgressInProgress,
		}, nil)
		if err != nil {
			t.Fatalf("play with ui returned error: %v", err)
		}

		want := "   |---|---|---|"
		got := ui.rowText(7, 0, len([]rune(want))-1)
		if got != want {
			t.Fatalf("expected Ctrl+B wraparound to restore the initial wall weight: got %q want %q", got, want)
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

		err := maze.PlayPreparedGameWithStore(ui, &maze.Dimensions{}, sampleMazeGrid(), maze.StoredGameState{
			Level:      1,
			WallWeight: maze.WallWeightRegular,
			State:      maze.GameProgressInProgress,
		}, nil)
		if err != nil {
			t.Fatalf("play with ui returned error: %v", err)
		}

		if !ui.containsText("You failed to locate the target on time") {
			t.Fatal("expected timeout handling to render the failure overlay")
		}
	})

	t.Run("proceeds to the same level after a failed run", func(t *testing.T) {
		t.Parallel()

		ui := newFakeUI(40, 80)
		t.Cleanup(ui.Close)

		go func() {
			time.Sleep(40 * time.Millisecond)
			ui.enqueueEvents(termbox.Event{Type: termbox.EventKey, Key: termbox.KeyCtrlP})
			time.Sleep(40 * time.Millisecond)
			ui.enqueueEvents(termbox.Event{Type: termbox.EventKey, Key: termbox.KeyEsc})
		}()

		err := maze.PlayPreparedGameWithStore(ui, &maze.Dimensions{}, sampleMazeGrid(), maze.StoredGameState{
			Level:      1,
			WallWeight: maze.WallWeightRegular,
			State:      maze.GameProgressInProgress,
		}, nil)
		if err != nil {
			t.Fatalf("play with ui returned error: %v", err)
		}

		if !ui.containsText("Scores: 11000") {
			t.Fatal("expected Ctrl+P after failure to reload level 1 with its initial score")
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

		err := maze.PlayPreparedGameWithStore(ui, &maze.Dimensions{
			Length:        1,
			Width:         1,
			StartPosition: [2]int{1, 1},
			FinalPosition: [2]int{1, 1},
		}, sampleMazeGrid(), maze.StoredGameState{
			Level:      1,
			WallWeight: maze.WallWeightRegular,
			State:      maze.GameProgressInProgress,
		}, nil)
		if err != nil {
			t.Fatalf("play with ui returned error: %v", err)
		}

		if !ui.containsText("Congratulations") {
			t.Fatal("expected the winning tick to render the success overlay")
		}
	})

	t.Run("proceeds to the next level after a win", func(t *testing.T) {
		t.Parallel()

		ui := newFakeUI(40, 80)
		t.Cleanup(ui.Close)

		go func() {
			time.Sleep(80 * time.Millisecond)
			ui.enqueueEvents(termbox.Event{Type: termbox.EventKey, Key: termbox.KeyCtrlP})
			time.Sleep(40 * time.Millisecond)
			ui.enqueueEvents(termbox.Event{Type: termbox.EventKey, Key: termbox.KeyEsc})
		}()

		err := maze.PlayPreparedGameWithStore(ui, &maze.Dimensions{
			Length:        1,
			Width:         1,
			StartPosition: [2]int{1, 1},
			FinalPosition: [2]int{1, 1},
		}, sampleMazeGrid(), maze.StoredGameState{
			Level:      1,
			WallWeight: maze.WallWeightRegular,
			State:      maze.GameProgressInProgress,
		}, nil)
		if err != nil {
			t.Fatalf("play with ui returned error: %v", err)
		}

		if !ui.containsText("Scores: 12000") {
			t.Fatal("expected Ctrl+P after a win to load level 2 with its initial score")
		}
	})
}

func TestPlayWithUIRestoresPersistedProgressState(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name      string
		progress  maze.GameProgress
		wantLevel string
		wantScore string
	}{
		{
			name:      "loads the next level when the last persisted game was won",
			progress:  maze.GameProgressWon,
			wantLevel: "Level: 2",
			wantScore: "Scores: 12000",
		},
		{
			name:      "reloads the current level when the last persisted game failed",
			progress:  maze.GameProgressFail,
			wantLevel: "Level: 1",
			wantScore: "Scores: 11000",
		},
		{
			name:      "reloads the current level when the last persisted game was still in progress",
			progress:  maze.GameProgressInProgress,
			wantLevel: "Level: 1",
			wantScore: "Scores: 11000",
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			tempDir := t.TempDir()
			storePath := filepath.Join(tempDir, ".tapoo.store")

			gameStore, errStore := maze.NewStore(storePath)
			if errStore != nil {
				t.Fatalf("new store returned error: %v", errStore)
			}

			if err := gameStore.Save(maze.StoredGameState{
				Level:      1,
				WallWeight: maze.WallWeightRegular,
				State:      testCase.progress,
			}); err != nil {
				t.Fatalf("save returned error: %v", err)
			}

			ui := newFakeUI(40, 80)
			ui.setStorePath(storePath)
			t.Cleanup(ui.Close)

			go func() {
				time.Sleep(120 * time.Millisecond)
				ui.enqueueEvents(termbox.Event{Type: termbox.EventKey, Key: termbox.KeyEsc})
			}()

			if err := maze.PlayWithUI(ui); err != nil {
				t.Fatalf("play with ui returned error: %v", err)
			}

			if !ui.containsText(testCase.wantLevel) {
				t.Fatalf("expected restored session to render %q", testCase.wantLevel)
			}

			if !ui.containsText(testCase.wantScore) {
				t.Fatalf("expected restored session to render %q", testCase.wantScore)
			}
		})
	}
}
