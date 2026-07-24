package maze_test

import (
	"strings"
	"testing"

	"github.com/dmigwi/tapoo/maze"
)

func TestCreatePlayingField(t *testing.T) {
	t.Parallel()

	config := &maze.Dimensions{NumCols: 7, NumRows: 7}

	regularWeightMaze := [][]string{
		{"|", "---", "|", "---", "|", "---", "|", "---", "|", "---", "|", "---", "|", "---", "|", "\n"},
		{"|", "   ", "|", "   ", "|", "   ", "|", "   ", "|", "   ", "|", "   ", "|", "   ", "|", "\n"},
		{"|", "---", "|", "---", "|", "---", "|", "---", "|", "---", "|", "---", "|", "---", "|", "\n"},
		{"|", "   ", "|", "   ", "|", "   ", "|", "   ", "|", "   ", "|", "   ", "|", "   ", "|", "\n"},
		{"|", "---", "|", "---", "|", "---", "|", "---", "|", "---", "|", "---", "|", "---", "|", "\n"},
		{"|", "   ", "|", "   ", "|", "   ", "|", "   ", "|", "   ", "|", "   ", "|", "   ", "|", "\n"},
		{"|", "---", "|", "---", "|", "---", "|", "---", "|", "---", "|", "---", "|", "---", "|", "\n"},
		{"|", "   ", "|", "   ", "|", "   ", "|", "   ", "|", "   ", "|", "   ", "|", "   ", "|", "\n"},
		{"|", "---", "|", "---", "|", "---", "|", "---", "|", "---", "|", "---", "|", "---", "|", "\n"},
		{"|", "   ", "|", "   ", "|", "   ", "|", "   ", "|", "   ", "|", "   ", "|", "   ", "|", "\n"},
		{"|", "---", "|", "---", "|", "---", "|", "---", "|", "---", "|", "---", "|", "---", "|", "\n"},
		{"|", "   ", "|", "   ", "|", "   ", "|", "   ", "|", "   ", "|", "   ", "|", "   ", "|", "\n"},
		{"|", "---", "|", "---", "|", "---", "|", "---", "|", "---", "|", "---", "|", "---", "|", "\n"},
		{"|", "   ", "|", "   ", "|", "   ", "|", "   ", "|", "   ", "|", "   ", "|", "   ", "|", "\n"},
		{"|", "---", "|", "---", "|", "---", "|", "---", "|", "---", "|", "---", "|", "---", "|", "\n"},
	}

	mediumWeightMaze := [][]string{
		{"╏", "╍╍╍", "╏", "╍╍╍", "╏", "╍╍╍", "╏", "╍╍╍", "╏", "╍╍╍", "╏", "╍╍╍", "╏", "╍╍╍", "╏", "\n"},
		{"╏", "   ", "╏", "   ", "╏", "   ", "╏", "   ", "╏", "   ", "╏", "   ", "╏", "   ", "╏", "\n"},
		{"╏", "╍╍╍", "╏", "╍╍╍", "╏", "╍╍╍", "╏", "╍╍╍", "╏", "╍╍╍", "╏", "╍╍╍", "╏", "╍╍╍", "╏", "\n"},
		{"╏", "   ", "╏", "   ", "╏", "   ", "╏", "   ", "╏", "   ", "╏", "   ", "╏", "   ", "╏", "\n"},
		{"╏", "╍╍╍", "╏", "╍╍╍", "╏", "╍╍╍", "╏", "╍╍╍", "╏", "╍╍╍", "╏", "╍╍╍", "╏", "╍╍╍", "╏", "\n"},
		{"╏", "   ", "╏", "   ", "╏", "   ", "╏", "   ", "╏", "   ", "╏", "   ", "╏", "   ", "╏", "\n"},
		{"╏", "╍╍╍", "╏", "╍╍╍", "╏", "╍╍╍", "╏", "╍╍╍", "╏", "╍╍╍", "╏", "╍╍╍", "╏", "╍╍╍", "╏", "\n"},
		{"╏", "   ", "╏", "   ", "╏", "   ", "╏", "   ", "╏", "   ", "╏", "   ", "╏", "   ", "╏", "\n"},
		{"╏", "╍╍╍", "╏", "╍╍╍", "╏", "╍╍╍", "╏", "╍╍╍", "╏", "╍╍╍", "╏", "╍╍╍", "╏", "╍╍╍", "╏", "\n"},
		{"╏", "   ", "╏", "   ", "╏", "   ", "╏", "   ", "╏", "   ", "╏", "   ", "╏", "   ", "╏", "\n"},
		{"╏", "╍╍╍", "╏", "╍╍╍", "╏", "╍╍╍", "╏", "╍╍╍", "╏", "╍╍╍", "╏", "╍╍╍", "╏", "╍╍╍", "╏", "\n"},
		{"╏", "   ", "╏", "   ", "╏", "   ", "╏", "   ", "╏", "   ", "╏", "   ", "╏", "   ", "╏", "\n"},
		{"╏", "╍╍╍", "╏", "╍╍╍", "╏", "╍╍╍", "╏", "╍╍╍", "╏", "╍╍╍", "╏", "╍╍╍", "╏", "╍╍╍", "╏", "\n"},
		{"╏", "   ", "╏", "   ", "╏", "   ", "╏", "   ", "╏", "   ", "╏", "   ", "╏", "   ", "╏", "\n"},
		{"╏", "╍╍╍", "╏", "╍╍╍", "╏", "╍╍╍", "╏", "╍╍╍", "╏", "╍╍╍", "╏", "╍╍╍", "╏", "╍╍╍", "╏", "\n"},
	}

	boldWeightMaze := [][]string{
		{"║", "===", "║", "===", "║", "===", "║", "===", "║", "===", "║", "===", "║", "===", "║", "\n"},
		{"║", "   ", "║", "   ", "║", "   ", "║", "   ", "║", "   ", "║", "   ", "║", "   ", "║", "\n"},
		{"║", "===", "║", "===", "║", "===", "║", "===", "║", "===", "║", "===", "║", "===", "║", "\n"},
		{"║", "   ", "║", "   ", "║", "   ", "║", "   ", "║", "   ", "║", "   ", "║", "   ", "║", "\n"},
		{"║", "===", "║", "===", "║", "===", "║", "===", "║", "===", "║", "===", "║", "===", "║", "\n"},
		{"║", "   ", "║", "   ", "║", "   ", "║", "   ", "║", "   ", "║", "   ", "║", "   ", "║", "\n"},
		{"║", "===", "║", "===", "║", "===", "║", "===", "║", "===", "║", "===", "║", "===", "║", "\n"},
		{"║", "   ", "║", "   ", "║", "   ", "║", "   ", "║", "   ", "║", "   ", "║", "   ", "║", "\n"},
		{"║", "===", "║", "===", "║", "===", "║", "===", "║", "===", "║", "===", "║", "===", "║", "\n"},
		{"║", "   ", "║", "   ", "║", "   ", "║", "   ", "║", "   ", "║", "   ", "║", "   ", "║", "\n"},
		{"║", "===", "║", "===", "║", "===", "║", "===", "║", "===", "║", "===", "║", "===", "║", "\n"},
		{"║", "   ", "║", "   ", "║", "   ", "║", "   ", "║", "   ", "║", "   ", "║", "   ", "║", "\n"},
		{"║", "===", "║", "===", "║", "===", "║", "===", "║", "===", "║", "===", "║", "===", "║", "\n"},
		{"║", "   ", "║", "   ", "║", "   ", "║", "   ", "║", "   ", "║", "   ", "║", "   ", "║", "\n"},
		{"║", "===", "║", "===", "║", "===", "║", "===", "║", "===", "║", "===", "║", "===", "║", "\n"},
	}

	wantTopRows := map[maze.WallWeight][][]string{
		maze.WallWeightRegular: regularWeightMaze,
		maze.WallWeightMedium:  mediumWeightMaze,
		maze.WallWeightBold:    boldWeightMaze,
	}

	for _, weight := range []maze.WallWeight{maze.WallWeightRegular, maze.WallWeightMedium, maze.WallWeightBold} {
		gridView, err := config.CreatePlayingField(weight)
		if err != nil {
			t.Fatalf("CreatePlayingField(%d) returned error: %v", weight, err)
		}

		if len(gridView) == 0 {
			t.Fatalf("CreatePlayingField(%d) returned an empty grid", weight)
		}

		for _, line := range gridView {
			if got, want := len(line), (config.NumCols+1)*2; got != want {
				t.Fatalf("unexpected row width for wall weight %d: got %d want %d", weight, got, want)
			}
		}

		mazeTable := wantTopRows[weight]
		for i := range gridView {
			if strings.Join(gridView[i], "") != strings.Join(mazeTable[i], "") {
				t.Fatalf("unexpected top row for %s: got %q want %q",
					weight, strings.Join(gridView[i], ""), strings.Join(mazeTable[i], ""))
			}
		}
	}

	gridView, err := config.CreatePlayingField(maze.WallWeight(10))
	if err == nil {
		t.Fatal("CreatePlayingField(10) expected an error but got nil")
	}

	if !strings.Contains(err.Error(), "invalid wall weight: WallWeight(10)") {
		t.Fatalf("unexpected error message: %v", err)
	}

	if len(gridView) != 0 {
		t.Fatalf("expected invalid wall weight to return an empty grid, got %v", gridView)
	}
}

func TestGetCellAddress(t *testing.T) {
	t.Parallel()

	config := &maze.Dimensions{
		NumCols: 6,
		NumRows: 5,
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
		NumCols: 6,
		NumRows: 5,
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
