package maze_test

import (
	"strings"
	"testing"

	"github.com/dmigwi/tapoo/maze"
)

func TestGenerateMazeArea(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		level int
		want  int
	}{
		{name: "seed level", level: 0, want: 60},
		{name: "normal level", level: 23, want: 290},
		{name: "large level stays uncapped", level: 30000, want: 300060},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			if got := maze.GenerateMazeArea(testCase.level); got != testCase.want {
				t.Fatalf("unexpected maze area: got %v want %v", got, testCase.want)
			}
		})
	}
}

func TestGetNavigationProfile(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		config maze.Dimensions
		want   maze.NavigationProfile
	}{
		{
			name:   "welcoming early profile",
			config: maze.Dimensions{NumCols: 10, NumRows: 11},
			want:   maze.NavigationProfile{MaxCorridorLength: 10, LeastNeighborsBias: 100},
		},
		{
			name:   "mid area profile",
			config: maze.Dimensions{NumCols: 20, NumRows: 20},
			want:   maze.NavigationProfile{MaxCorridorLength: 7, LeastNeighborsBias: 57},
		},
		{
			name:   "late game profile",
			config: maze.Dimensions{NumCols: 30, NumRows: 30},
			want:   maze.NavigationProfile{MaxCorridorLength: 5, LeastNeighborsBias: 28},
		},
		{
			name:   "max area fallback profile",
			config: maze.Dimensions{NumCols: 60, NumRows: 60},
			want:   maze.NavigationProfile{MaxCorridorLength: 3, LeastNeighborsBias: 0},
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			got := maze.GetNavigationProfile(testCase.config)
			if got != testCase.want {
				t.Fatalf("unexpected navigation profile: got %+v want %+v", got, testCase.want)
			}
		})
	}
}

func TestGetNavigationProfileTightensAsAreaGrows(t *testing.T) {
	t.Parallel()

	profiles := []maze.NavigationProfile{
		maze.GetNavigationProfile(maze.Dimensions{NumCols: 10, NumRows: 11}),
		maze.GetNavigationProfile(maze.Dimensions{NumCols: 20, NumRows: 20}),
		maze.GetNavigationProfile(maze.Dimensions{NumCols: 30, NumRows: 30}),
		maze.GetNavigationProfile(maze.Dimensions{NumCols: 60, NumRows: 60}),
	}

	for index := 1; index < len(profiles); index++ {
		previous := profiles[index-1]
		current := profiles[index]

		if current.MaxCorridorLength > previous.MaxCorridorLength {
			t.Fatalf(
				"expected max corridor length to tighten with maze area: previous=%+v current=%+v",
				previous,
				current,
			)
		}

		if current.LeastNeighborsBias > previous.LeastNeighborsBias {
			t.Fatalf(
				"expected least-neighbors bias to stay the same or tighten with maze area: previous=%+v current=%+v",
				previous,
				current,
			)
		}
	}
}

// countOpenExits reports how many of a cell's grid-adjacent neighbors are reachable
// through an open (space-filled) wall segment in the generated maze grid.
func countOpenExits(config maze.Dimensions, grid [][]string, cellNo int) int {
	address := config.GetCellAddress(cellNo)
	neighbors := config.GetCellNeighbors(cellNo)
	open := 0

	isOpen := func(point [2]int) bool {
		return strings.TrimSpace(grid[point[0]][point[1]]) == ""
	}

	if neighbors.Bottom != 0 && isOpen(address.BottomCenter) {
		open++
	}
	if neighbors.Left != 0 && isOpen(address.MiddleLeft) {
		open++
	}
	if neighbors.Right != 0 && isOpen(address.MiddleRight) {
		open++
	}
	if neighbors.Top != 0 && isOpen(address.TopCenter) {
		open++
	}

	return open
}

// TestLeastNeighborsBiasCutsJunctionDensity verifies the real GenerateMaze wiring, not
// just the simulation the bias was derived from: small mazes (LeastNeighborsBias=100)
// should produce far fewer junction cells (3+ open exits) than large ones (bias=0).
func TestLeastNeighborsBiasCutsJunctionDensity(t *testing.T) {
	t.Parallel()

	junctionFraction := func(config maze.Dimensions) float64 {
		grid, err := config.GenerateMaze(maze.WallWeightRegular)
		if err != nil {
			t.Fatalf("GenerateMaze returned error: %v", err)
		}

		junctions, total := 0, config.NumCols*config.NumRows
		for cellNo := 1; cellNo <= total; cellNo++ {
			if countOpenExits(config, grid, cellNo) >= 3 {
				junctions++
			}
		}

		return float64(junctions) / float64(total)
	}

	average := func(config maze.Dimensions, samples int) float64 {
		var sum float64
		for range samples {
			sum += junctionFraction(config)
		}
		return sum / float64(samples)
	}

	// Small maze: area well below friendlyMaxArea, so LeastNeighborsBias resolves to 100.
	smallMazeJunctionFraction := average(maze.Dimensions{NumCols: 10, NumRows: 7}, 20)
	// Large maze: area at/above hardestArea, so LeastNeighborsBias resolves to 0.
	largeMazeJunctionFraction := average(maze.Dimensions{NumCols: 40, NumRows: 40}, 20)

	// The bias should cut junction density substantially, not just nudge it — the simulation
	// this was derived from measured roughly a 10x reduction at full bias strength.
	if smallMazeJunctionFraction >= largeMazeJunctionFraction/2 {
		t.Fatalf(
			"expected small-maze junction density to be less than half of large-maze density: small=%v large=%v",
			smallMazeJunctionFraction,
			largeMazeJunctionFraction,
		)
	}
}

func TestGetMazeDimensionsErrors(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		level   int
		size    maze.Dimensions
		wantErr string
	}{
		{
			name:    "maze area exceeds terminal area",
			level:   200,
			size:    maze.Dimensions{NumCols: 4, NumRows: 20},
			wantErr: "   level 200 needs more screen room; enlarge the window to keep playing   ",
		},
		{
			name:    "area cannot be factorized into supported dimensions",
			level:   0,
			size:    maze.Dimensions{NumCols: 100, NumRows: 1},
			wantErr: "   level 0 needs more screen room; enlarge the window to keep playing   ",
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			got, err := maze.GetMazeDimensions(testCase.level, testCase.size)
			if err == nil {
				t.Fatal("expected an error but got nil")
			}

			if err.Error() != testCase.wantErr {
				t.Fatalf("unexpected error: got %q want %q", err.Error(), testCase.wantErr)
			}

			if got == nil {
				t.Fatal("expected a zero dimensions result when an error is returned")
			}

			if got.NumCols != 0 || got.NumRows != 0 {
				t.Fatalf("expected zero dimensions on error, got %+v", *got)
			}
		})
	}
}

func TestGetMazeDimensionsFits(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		level int
		size  maze.Dimensions
		want  maze.Dimensions
	}{
		{
			name:  "single landscape fit",
			level: 0,
			size:  maze.Dimensions{NumCols: 20, NumRows: 5},
			want:  maze.Dimensions{NumCols: 12, NumRows: 5},
		},
		{
			name:  "single portrait fit",
			level: 0,
			size:  maze.Dimensions{NumCols: 5, NumRows: 20},
			want:  maze.Dimensions{NumCols: 5, NumRows: 12},
		},
		{
			name:  "prefers closest aspect match when multiple fits exist",
			level: 2,
			size:  maze.Dimensions{NumCols: 16, NumRows: 10},
			want:  maze.Dimensions{NumCols: 10, NumRows: 8},
		},
		{
			name:  "prefers balanced dimensions before viewport aspect ratio",
			level: 2,
			size:  maze.Dimensions{NumCols: 30, NumRows: 10},
			want:  maze.Dimensions{NumCols: 10, NumRows: 8},
		},
		{
			name:  "prefers balanced fit when aspect score ties",
			level: 2,
			size:  maze.Dimensions{NumCols: 15, NumRows: 10},
			want:  maze.Dimensions{NumCols: 10, NumRows: 8},
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			got, err := maze.GetMazeDimensions(testCase.level, testCase.size)
			if err != nil {
				t.Fatalf("GetMazeDimensions returned error: %v", err)
			}

			if got == nil {
				t.Fatal("GetMazeDimensions returned nil without an error")
			}

			if got.NumCols != testCase.want.NumCols || got.NumRows != testCase.want.NumRows {
				t.Fatalf("unexpected dimensions: got %+v want %+v", *got, testCase.want)
			}
		})
	}
}

func TestGetTerminalSize(t *testing.T) {
	t.Parallel()

	t.Run("converts normal termbox size into drawable maze room", func(t *testing.T) {
		t.Parallel()

		got := maze.GetTerminalSize(202, 52)
		want := maze.Dimensions{
			NumCols: 49,
			NumRows: 21,
		}

		if got.NumCols != want.NumCols || got.NumRows != want.NumRows {
			t.Fatalf("unexpected terminal size: got %+v want %+v", got, want)
		}
	})

	t.Run("keeps tiny terminal room tiny instead of inflating it", func(t *testing.T) {
		t.Parallel()

		got := maze.GetTerminalSize(8, 7)
		want := maze.Dimensions{
			NumCols: 0,
			NumRows: 0,
		}

		if got.NumCols != want.NumCols || got.NumRows != want.NumRows {
			t.Fatalf("unexpected tiny terminal size: got %+v want %+v", got, want)
		}
	})
}
