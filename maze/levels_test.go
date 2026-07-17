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
			config: maze.Dimensions{Length: 10, Width: 11},
			want:   maze.NavigationProfile{SoftCorridorLimit: 8, HardCorridorLimit: 10, PreferTurnPercent: 90},
		},
		{
			name:   "mid area profile",
			config: maze.Dimensions{Length: 20, Width: 20},
			want:   maze.NavigationProfile{SoftCorridorLimit: 5, HardCorridorLimit: 7, PreferTurnPercent: 75},
		},
		{
			name:   "late game profile",
			config: maze.Dimensions{Length: 30, Width: 30},
			want:   maze.NavigationProfile{SoftCorridorLimit: 4, HardCorridorLimit: 5, PreferTurnPercent: 65},
		},
		{
			name:   "max area fallback profile",
			config: maze.Dimensions{Length: 60, Width: 60},
			want:   maze.NavigationProfile{SoftCorridorLimit: 2, HardCorridorLimit: 3, PreferTurnPercent: 55},
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
		maze.GetNavigationProfile(maze.Dimensions{Length: 10, Width: 11}),
		maze.GetNavigationProfile(maze.Dimensions{Length: 20, Width: 20}),
		maze.GetNavigationProfile(maze.Dimensions{Length: 30, Width: 30}),
		maze.GetNavigationProfile(maze.Dimensions{Length: 60, Width: 60}),
	}

	for index := 1; index < len(profiles); index++ {
		previous := profiles[index-1]
		current := profiles[index]

		if current.SoftCorridorLimit > previous.SoftCorridorLimit {
			t.Fatalf(
				"expected soft corridor limit to tighten with maze area: previous=%+v current=%+v",
				previous,
				current,
			)
		}

		if current.HardCorridorLimit > previous.HardCorridorLimit {
			t.Fatalf(
				"expected hard corridor limit to tighten with maze area: previous=%+v current=%+v",
				previous,
				current,
			)
		}

		if current.PreferTurnPercent > previous.PreferTurnPercent {
			t.Fatalf(
				"expected turn preference to stay the same or tighten with maze area: previous=%+v current=%+v",
				previous,
				current,
			)
		}
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
			size:    maze.Dimensions{Length: 4, Width: 20},
			wantErr: "   level 200 needs more screen room; enlarge the window to keep playing   ",
		},
		{
			name:    "area cannot be factorized into supported dimensions",
			level:   0,
			size:    maze.Dimensions{Length: 100, Width: 1},
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
			want:  maze.Dimensions{Length: 12, Width: 5},
		},
		{
			name:  "single portrait fit",
			level: 0,
			size:  maze.Dimensions{Length: 5, Width: 20},
			want:  maze.Dimensions{Length: 5, Width: 12},
		},
		{
			name:  "prefers closest aspect match when multiple fits exist",
			level: 2,
			size:  maze.Dimensions{Length: 16, Width: 10},
			want:  maze.Dimensions{Length: 10, Width: 8},
		},
		{
			name:  "prefers balanced dimensions before viewport aspect ratio",
			level: 2,
			size:  maze.Dimensions{Length: 30, Width: 10},
			want:  maze.Dimensions{Length: 10, Width: 8},
		},
		{
			name:  "prefers balanced fit when aspect score ties",
			level: 2,
			size:  maze.Dimensions{Length: 15, Width: 10},
			want:  maze.Dimensions{Length: 10, Width: 8},
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
