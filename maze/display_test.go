package maze_test

import (
	"errors"
	"strings"
	"testing"

	termbox "github.com/nsf/termbox-go"

	"github.com/dmigwi/tapoo/maze"
)

func TestRenderMazeUI(t *testing.T) {
	t.Parallel()

	t.Run("renders player goal and score details for the live scene", func(t *testing.T) {
		t.Parallel()

		ui := newFakeUI(40, 80)
		config := &maze.Dimensions{
			NumCols:       3,
			NumRows:       3,
			StartPosition: [2]int{1, 1},
			FinalPosition: [2]int{3, 3},
		}

		reachedTarget, err := maze.RenderMazeUI(ui, config, 1, 900, sampleMazeGrid(), nil)
		if err != nil {
			t.Fatalf("render maze ui returned error: %v", err)
		}

		if reachedTarget {
			t.Fatal("expected render maze ui to report that the target was not reached")
		}

		if ui.flushCalls != 1 {
			t.Fatalf("expected a single flush call, got %d", ui.flushCalls)
		}

		if !ui.hasForegroundColor(termbox.ColorCyan) {
			t.Fatal("expected render maze ui to render the player marker color")
		}

		if !ui.hasForegroundColor(termbox.ColorRed) {
			t.Fatal("expected render maze ui to render the target marker color")
		}

		if !ui.containsText("Scores: 900") {
			t.Fatal("expected render maze ui to render the current score")
		}

		if !ui.containsText("Level: 1") {
			t.Fatal("expected render maze ui to render the current level")
		}
	})

	t.Run("reports when the player is already on the target", func(t *testing.T) {
		t.Parallel()

		ui := newFakeUI(40, 80)
		config := &maze.Dimensions{
			NumCols:       3,
			NumRows:       3,
			StartPosition: [2]int{3, 3},
			FinalPosition: [2]int{3, 3},
		}

		reachedTarget, err := maze.RenderMazeUI(ui, config, 2, 300, sampleMazeGrid(), nil)
		if err != nil {
			t.Fatalf("render maze ui returned error: %v", err)
		}

		if !reachedTarget {
			t.Fatal("expected render maze ui to report a reached target")
		}
	})

	t.Run("renders the interrupt overlay and high score details", func(t *testing.T) {
		t.Parallel()

		ui := newFakeUI(40, 80)
		reachedTarget, err := maze.RenderMazeUI(ui, nil, 4, 400, sampleMazeGrid(), &maze.UIOverlay{
			Message:       "Paused",
			Color:         termbox.ColorYellow,
			ShowHighScore: true,
			ScorePercent:  100,
			WinSummary:    "1.20s faster than previous (new record)",
		})
		if err != nil {
			t.Fatalf("render maze ui returned error: %v", err)
		}

		if reachedTarget {
			t.Fatal("expected overlay rendering not to report a reached target")
		}

		if ui.flushCalls != 1 {
			t.Fatalf("expected a single flush call, got %d", ui.flushCalls)
		}

		if !ui.containsText("Paused") {
			t.Fatal("expected render maze ui to render the overlay message")
		}

		if !ui.containsText("Final Level 4 Scores:  400 (100% retention)") {
			t.Fatal("expected render maze ui to render the high score text")
		}

		if !ui.containsText("1.20s faster than previous (new record)") {
			t.Fatal("expected render maze ui to render the win summary text")
		}
	})

	t.Run("pause overlay only clears the spacer rows it needs", func(t *testing.T) {
		t.Parallel()

		ui := newFakeUI(40, 80)
		_, err := maze.RenderMazeUI(ui, nil, 1, 0, sampleMazeGrid(), &maze.UIOverlay{
			Message:       "Paused",
			Color:         termbox.ColorYellow,
			ShowHighScore: false,
		})
		if err != nil {
			t.Fatalf("render maze ui returned error: %v", err)
		}

		// The pause overlay uses two content lines, so the lower maze rows should stay visible.
		if strings.TrimSpace(ui.rowText(12, 3, 20)) == "" {
			t.Fatal("expected pause overlay not to blank maze rows below the navigation line")
		}
	})

	t.Run("returns flush errors", func(t *testing.T) {
		t.Parallel()

		ui := newFakeUI(40, 80)
		ui.flushErr = errors.New("flush failed")

		_, err := maze.RenderMazeUI(ui, &maze.Dimensions{
			NumCols:       3,
			NumRows:       3,
			StartPosition: [2]int{1, 1},
			FinalPosition: [2]int{3, 3},
		}, 1, 100, sampleMazeGrid(), nil)
		if err == nil {
			t.Fatal("expected render maze ui to return a flush error")
		}

		if !strings.Contains(err.Error(), "flush failed") {
			t.Fatalf("expected flush error to be preserved, got %v", err)
		}
	})

	t.Run("returns an error when live rendering has no dimensions", func(t *testing.T) {
		t.Parallel()

		ui := newFakeUI(40, 80)

		_, err := maze.RenderMazeUI(ui, nil, 1, 100, sampleMazeGrid(), nil)
		if err == nil {
			t.Fatal("expected render maze ui to reject live rendering without dimensions")
		}

		if !strings.Contains(err.Error(), "missing dimensions") {
			t.Fatalf("unexpected error: %v", err)
		}
	})
}

func TestDrawMaze(t *testing.T) {
	t.Parallel()

	t.Run("renders supported wall weights with expected spacing and organization", func(t *testing.T) {
		t.Parallel()

		config := &maze.Dimensions{NumCols: 4, NumRows: 3}
		expectedMazeRows := map[maze.WallWeight][]string{
			maze.WallWeightRegular: {
				"   |---|---|---|---|\n",
				"   |   |   |   |   |\n",
				"   |---|---|---|---|\n",
				"   |   |   |   |   |\n",
				"   |---|---|---|---|\n",
				"   |   |   |   |   |\n",
				"   |---|---|---|---|\n",
			},
			maze.WallWeightMedium: {
				"   ╏╍╍╍╏╍╍╍╏╍╍╍╏╍╍╍╏\n",
				"   ╏   ╏   ╏   ╏   ╏\n",
				"   ╏╍╍╍╏╍╍╍╏╍╍╍╏╍╍╍╏\n",
				"   ╏   ╏   ╏   ╏   ╏\n",
				"   ╏╍╍╍╏╍╍╍╏╍╍╍╏╍╍╍╏\n",
				"   ╏   ╏   ╏   ╏   ╏\n",
				"   ╏╍╍╍╏╍╍╍╏╍╍╍╏╍╍╍╏\n",
			},
			maze.WallWeightBold: {
				"   ║===║===║===║===║\n",
				"   ║   ║   ║   ║   ║\n",
				"   ║===║===║===║===║\n",
				"   ║   ║   ║   ║   ║\n",
				"   ║===║===║===║===║\n",
				"   ║   ║   ║   ║   ║\n",
				"   ║===║===║===║===║\n",
			},
		}

		for _, weight := range []maze.WallWeight{
			maze.WallWeightRegular,
			maze.WallWeightMedium,
			maze.WallWeightBold,
		} {
			t.Run(weight.String(), func(t *testing.T) {
				t.Parallel()

				ui := newFakeUI(40, 80)
				data, errField := config.CreatePlayingField(weight)
				if errField != nil {
					t.Fatalf("create playing field returned error: %v", errField)
				}

				if err := maze.DrawMaze(ui, data); err != nil {
					t.Fatalf("draw maze returned error: %v", err)
				}

				if ui.flushCalls != 0 {
					t.Fatalf("expected draw maze not to flush directly, got %d flush calls", ui.flushCalls)
				}

				if !ui.containsText("Maze runner") {
					t.Fatal("expected draw maze to render the intro text")
				}

				if !ui.containsText("Tapoo " + fakeUIVersion) {
					t.Fatal("expected draw maze to render the embedded version in the intro text")
				}

				if !ui.containsText("linkedin.com/in/migwi-ndungu") {
					t.Fatal("expected draw maze to render the developer contact text")
				}

				if !ui.containsText("Arrow Keys") {
					t.Fatal("expected draw maze to render the controls hint")
				}

				if !ui.containsText("Ctrl+B") {
					t.Fatal("expected draw maze to render the wall-weight shortcut help")
				}

				for rowIndex, want := range expectedMazeRows[weight] {
					got := ui.rowText(7+rowIndex, 0, len([]rune(want))-1)
					if got != want {
						t.Fatalf(
							"unexpected rendered maze row %d for %s: got %q want %q",
							rowIndex, weight, got, want,
						)
					}
				}
			})
		}
	})

	t.Run("returns clear errors", func(t *testing.T) {
		t.Parallel()

		ui := newFakeUI(40, 80)
		ui.clearErr = errors.New("clear failed")

		err := maze.DrawMaze(ui, sampleMazeGrid())
		if err == nil {
			t.Fatal("expected draw maze to return a clear error")
		}

		if !strings.Contains(err.Error(), "clear failed") {
			t.Fatalf("expected clear error to be preserved, got %v", err)
		}
	})
}
