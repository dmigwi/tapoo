package maze_test

import (
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
		{name: "seed level", level: 0, want: 100},
		{name: "normal level", level: 23, want: 330},
		{name: "clamped max level", level: 30000, want: 3100},
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
			name:   "small area profile",
			config: maze.Dimensions{Length: 10, Width: 11},
			want:   maze.NavigationProfile{SoftCorridorLimit: 2, HardCorridorLimit: 3, PreferTurnPercent: 80},
		},
		{
			name:   "mid area profile",
			config: maze.Dimensions{Length: 20, Width: 20},
			want:   maze.NavigationProfile{SoftCorridorLimit: 4, HardCorridorLimit: 5, PreferTurnPercent: 60},
		},
		{
			name:   "max area fallback profile",
			config: maze.Dimensions{Length: 60, Width: 60},
			want:   maze.NavigationProfile{SoftCorridorLimit: 6, HardCorridorLimit: 8, PreferTurnPercent: 35},
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

func TestGetMazeDimensionsErrors(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		level int
		size  maze.Dimensions
	}{
		{
			name:  "maze area exceeds terminal area",
			level: 200,
			size:  maze.Dimensions{Length: 4, Width: 20},
		},
		{
			name:  "area cannot be factorized into supported dimensions",
			level: 0,
			size:  maze.Dimensions{Length: 100, Width: 1},
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			got, err := maze.GetMazeDimensions(testCase.level, testCase.size)
			if err == nil {
				t.Fatal("expected an error but got nil")
			}

			if got == nil {
				t.Fatal("expected a zero dimensions result when an error is returned")
			}

			if got.Length != 0 || got.Width != 0 {
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
			size:  maze.Dimensions{Length: 20, Width: 5},
			want:  maze.Dimensions{Length: 20, Width: 5},
		},
		{
			name:  "single portrait fit",
			level: 0,
			size:  maze.Dimensions{Length: 5, Width: 20},
			want:  maze.Dimensions{Length: 5, Width: 20},
		},
		{
			name:  "prefers closest aspect match when multiple fits exist",
			level: 2,
			size:  maze.Dimensions{Length: 16, Width: 10},
			want:  maze.Dimensions{Length: 15, Width: 8},
		},
		{
			name:  "prefers balanced fit when aspect score ties",
			level: 2,
			size:  maze.Dimensions{Length: 15, Width: 10},
			want:  maze.Dimensions{Length: 12, Width: 10},
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

			if got.Length != testCase.want.Length || got.Width != testCase.want.Width {
				t.Fatalf("unexpected dimensions: got %+v want %+v", *got, testCase.want)
			}
		})
	}
}

func TestGetTerminalSize(t *testing.T) {
	t.Parallel()

	got := maze.GetTerminalSize(202, 52)
	want := maze.Dimensions{
		Length: 49,
		Width:  21,
	}

	if got.Length != want.Length || got.Width != want.Width {
		t.Fatalf("unexpected terminal size: got %+v want %+v", got, want)
	}
}
