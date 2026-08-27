package maze_test

import (
	"errors"
	"strings"
	"sync"
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

// visitedCellGlyph mirrors the maze package's unexported visited-cell marker. The trail colour and
// the traversability of a visited cell are both observable through exported behaviour, so these
// tests assert the rendered glyph and colour rather than reaching into the package.
const visitedCellGlyph = '░'

func TestDrawMazeColorsOnlyTheVisitedTrail(t *testing.T) {
	t.Parallel()

	// fill() decides the foreground per segment. It must key off the visited marker alone: every
	// banner and status string in constants.go begins with a space, so a check based on "is this
	// traversable" instead recoloured the whole UI - including overlay lines that pass their own
	// colour - to the player colour.
	t.Run("leaves banner text in the default color when no cell is visited", func(t *testing.T) {
		t.Parallel()

		ui := newFakeUI(40, 80)
		if err := maze.DrawMaze(ui, sampleMazeGrid()); err != nil {
			t.Fatalf("draw maze returned error: %v", err)
		}

		if !ui.containsText("Arrow Keys") {
			t.Fatal("expected the controls banner to be rendered")
		}

		if ui.hasForegroundColor(termbox.ColorCyan) {
			t.Fatal("expected no cell to use the player color when the grid holds no visited marker")
		}
	})

	t.Run("colors a visited cell with the player color", func(t *testing.T) {
		t.Parallel()

		grid := sampleMazeGrid()
		grid[1][1] = " " + string(visitedCellGlyph) + " "

		ui := newFakeUI(40, 80)
		if err := maze.DrawMaze(ui, grid); err != nil {
			t.Fatalf("draw maze returned error: %v", err)
		}

		if !ui.hasForegroundColor(termbox.ColorCyan) {
			t.Fatal("expected the visited cell to be drawn in the player color")
		}
	})
}

func TestRenderMazeUIKeepsOverlayScoreColor(t *testing.T) {
	t.Parallel()

	// The high-score line is the one overlay row that carries a caller-chosen colour, so it is the
	// clearest witness that fill() no longer overrides the colour it was handed.
	ui := newFakeUI(40, 80)
	overlay := &maze.UIOverlay{
		Message:       "Game paused !!!",
		Color:         termbox.ColorGreen,
		ShowHighScore: true,
		ScorePercent:  42,
	}

	if _, err := maze.RenderMazeUI(ui, nil, 3, 900, sampleMazeGrid(), overlay); err != nil {
		t.Fatalf("render maze ui returned error: %v", err)
	}

	if !ui.hasForegroundColor(termbox.ColorGreen) {
		t.Fatal("expected the overlay high-score line to keep the color supplied by the caller")
	}
}

func TestPlayerMovementLeavesAPaddedVisitedTrail(t *testing.T) {
	t.Parallel()

	// passageGlyph pads the marker so a visited cell occupies exactly the same width as the blank
	// cell it replaced. Width is what matters here: rows are rendered by concatenating segments, so
	// a narrower glyph would shift everything after it on that row out of alignment.
	config := maze.Dimensions{NumCols: 3, NumRows: 3, StartPosition: [2]int{3, 3}}
	grid := cloneGrid(sampleMazeGrid())
	blankWidth := len(grid[3][3])
	runtimeGrid := maze.NewRuntimeMaze(&config, grid)

	config.PlayerMovement(runtimeGrid, 0, -1)
	if got := runtimeGrid.PlayerPosition(); got != [2]int{3, 1} {
		t.Fatalf("expected the player to move left to {3,1}, got %v", got)
	}

	vacated := grid[3][3]
	if !strings.ContainsRune(vacated, visitedCellGlyph) {
		t.Fatalf("expected the vacated cell to hold the visited marker, got %q", vacated)
	}

	if len([]rune(vacated)) != blankWidth {
		t.Fatalf("expected the visited glyph to stay %d cells wide, got %q", blankWidth, vacated)
	}

	// Stepping back onto the trail must keep working. Note this does not exercise isTraversable
	// against the marker: PlayerMovement probes the passage slot between cells, which is always one
	// even index away from a cell centre, so a marker written to a centre is never probed.
	config.PlayerMovement(runtimeGrid, 0, 1)
	if got := runtimeGrid.PlayerPosition(); got != [2]int{3, 3} {
		t.Fatalf("expected the player to step back onto the visited cell, got %v", got)
	}
}

// TestRuntimeMazeConcurrentAccessIsRaceFree pins the invariant the RuntimeMaze lock exists for: the
// keyboard goroutine marks visited cells through PlayerMovement while the render goroutine walks the
// same grid through RenderUI, so both paths must be serialised. Run under -race, it fails if either
// side drops the lock - the original defect was a renderer holding the grid outside it.
func TestRuntimeMazeConcurrentAccessIsRaceFree(t *testing.T) {
	t.Parallel()

	// Note that when this does fail, the race detector marks every test running alongside it as
	// failed too; the report itself still names the two goroutines below.

	// NewRuntimeMaze does not copy, so grid aliases the data both goroutines touch. That is what
	// lets the post-wait assertion below confirm the writer really wrote.
	grid := [][]string{
		{"|", "---", "|", "---", "|"},
		{"|", "   ", " ", "   ", "|"},
		{"|", "---", "|", "   ", "|"},
		{"|", "   ", " ", "   ", "|"},
		{"|", "---", "|", "---", "|"},
	}
	config := &maze.Dimensions{
		NumCols:       2,
		NumRows:       2,
		StartPosition: [2]int{1, 1},
		FinalPosition: [2]int{3, 3},
	}
	mazeData := maze.NewRuntimeMaze(config, grid)
	ui := newFakeUI(40, 80)

	var waitGroup sync.WaitGroup
	waitGroup.Add(2)

	go func() {
		defer waitGroup.Done()
		for range 500 {
			// Steps right and back again, marking the cell it leaves on each move.
			config.PlayerMovement(mazeData, 0, 1)
			config.PlayerMovement(mazeData, 0, -1)
		}
	}()

	go func() {
		defer waitGroup.Done()
		for range 500 {
			if _, err := mazeData.RenderUI(ui, config, 1, 100, nil, true); err != nil {
				t.Errorf("render returned error: %v", err)

				return
			}
		}
	}()

	waitGroup.Wait()

	// Without this the test could silently stop covering anything: if the probe slot were ever walled
	// off, the move would be rejected and no concurrent write would happen at all.
	marked := 0
	for _, row := range grid {
		for _, segment := range row {
			if strings.ContainsRune(segment, visitedCellGlyph) {
				marked++
			}
		}
	}

	if marked == 0 {
		t.Fatal("expected the moving player to have marked at least one visited cell")
	}
}
