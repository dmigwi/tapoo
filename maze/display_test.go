package maze_test

import (
	"errors"
	"strings"
	"testing"

	termbox "github.com/nsf/termbox-go"

	"github.com/dmigwi/tapoo/maze"
)

func TestRefreshUI(t *testing.T) {
	t.Parallel()

	t.Run("renders player goal and score details", func(t *testing.T) {
		t.Parallel()

		ui := newFakeUI(40, 80)
		config := &maze.Dimensions{
			Length:        3,
			Width:         3,
			StartPosition: []int{1, 1},
			FinalPosition: []int{3, 3},
		}

		reachedTarget, err := maze.RefreshUI(ui, config, 900, sampleMazeGrid())
		if err != nil {
			t.Fatalf("refresh ui returned error: %v", err)
		}

		if reachedTarget {
			t.Fatal("expected refresh ui to report that the target was not reached")
		}

		if ui.flushCalls != 1 {
			t.Fatalf("expected a single flush call, got %d", ui.flushCalls)
		}

		if !ui.hasRune('@') {
			t.Fatal("expected refresh ui to render the player marker")
		}

		if !ui.hasRune('#') {
			t.Fatal("expected refresh ui to render the target marker")
		}

		if !ui.containsText("Scores: 900") {
			t.Fatal("expected refresh ui to render the current score")
		}
	})

	t.Run("reports when the player is already on the target", func(t *testing.T) {
		t.Parallel()

		ui := newFakeUI(40, 80)
		config := &maze.Dimensions{
			Length:        3,
			Width:         3,
			StartPosition: []int{3, 3},
			FinalPosition: []int{3, 3},
		}

		reachedTarget, err := maze.RefreshUI(ui, config, 300, sampleMazeGrid())
		if err != nil {
			t.Fatalf("refresh ui returned error: %v", err)
		}

		if !reachedTarget {
			t.Fatal("expected refresh ui to report a reached target")
		}
	})

	t.Run("returns flush errors", func(t *testing.T) {
		t.Parallel()

		ui := newFakeUI(40, 80)
		ui.flushErr = errors.New("flush failed")

		_, err := maze.RefreshUI(ui, &maze.Dimensions{
			Length:        3,
			Width:         3,
			StartPosition: []int{1, 1},
			FinalPosition: []int{3, 3},
		}, 100, sampleMazeGrid())
		if err == nil {
			t.Fatal("expected refresh ui to return a flush error")
		}

		if !strings.Contains(err.Error(), "flush failed") {
			t.Fatalf("expected flush error to be preserved, got %v", err)
		}
	})
}

func TestInterruptUI(t *testing.T) {
	t.Parallel()

	ui := newFakeUI(40, 80)

	err := maze.InterruptUI(ui, "Paused", sampleMazeGrid(), termbox.ColorYellow, true, 400)
	if err != nil {
		t.Fatalf("interrupt ui returned error: %v", err)
	}

	if ui.flushCalls != 1 {
		t.Fatalf("expected a single flush call, got %d", ui.flushCalls)
	}

	if !ui.containsText("Paused") {
		t.Fatal("expected interrupt ui to render the overlay message")
	}

	if !ui.containsText("High Scores: 400") {
		t.Fatal("expected interrupt ui to render the high score text")
	}
}
