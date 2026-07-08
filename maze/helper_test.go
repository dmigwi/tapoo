package maze_test

import (
	"strings"
	"testing"

	"github.com/dmigwi/tapoo/maze"
)

func TestCreatePlayingField(t *testing.T) {
	t.Parallel()

	config := &maze.Dimensions{
		Length: 17,
		Width:  5,
	}

	for _, intensity := range []int{1, 2, 3} {
		gridView, err := config.CreatePlayingField(intensity)
		if err != nil {
			t.Fatalf("CreatePlayingField(%d) returned error: %v", intensity, err)
		}

		if len(gridView) == 0 {
			t.Fatalf("CreatePlayingField(%d) returned an empty grid", intensity)
		}

		for _, line := range gridView {
			if got, want := len(line), (config.Length+1)*2; got != want {
				t.Fatalf("unexpected row width for intensity %d: got %d want %d", intensity, got, want)
			}
		}
	}

	gridView, err := config.CreatePlayingField(10)
	if err == nil {
		t.Fatal("CreatePlayingField(10) expected an error but got nil")
	}

	if !strings.Contains(err.Error(), "invalid value of intensity found: 10") {
		t.Fatalf("unexpected error message: %v", err)
	}

	if len(gridView) != 0 {
		t.Fatalf("expected invalid intensity to return an empty grid, got %v", gridView)
	}
}

func TestGetCellAddress(t *testing.T) {
	t.Parallel()

	config := &maze.Dimensions{
		Length: 6,
		Width:  5,
	}

	got := config.GetCellAddress(17)
	want := maze.CellAddress{
		BottomCenter: [2]int{6, 9},
		BottomLeft:   [2]int{6, 8},
		BottomRight:  [2]int{6, 10},
		MiddleCenter: [2]int{5, 9},
		MiddleLeft:   [2]int{5, 8},
		MiddleRight:  [2]int{5, 10},
		TopCenter:    [2]int{4, 9},
		TopLeft:      [2]int{4, 8},
		TopRight:     [2]int{4, 10},
	}

	if got != want {
		t.Fatalf("unexpected cell address: got %+v want %+v", got, want)
	}

	if empty := config.GetCellAddress(5000); empty != (maze.CellAddress{}) {
		t.Fatalf("expected missing cell to return zero value, got %+v", empty)
	}
}

func TestGetCellNeighbors(t *testing.T) {
	t.Parallel()

	config := &maze.Dimensions{
		Length: 6,
		Width:  5,
	}

	got := config.GetCellNeighbors(17)
	want := maze.CellNeighbors{
		Bottom: 23,
		Left:   16,
		Right:  18,
		Top:    11,
	}

	if got != want {
		t.Fatalf("unexpected cell neighbors: got %+v want %+v", got, want)
	}

	if empty := config.GetCellNeighbors(31); empty != (maze.CellNeighbors{}) {
		t.Fatalf("expected missing cell to return zero neighbors, got %+v", empty)
	}
}
