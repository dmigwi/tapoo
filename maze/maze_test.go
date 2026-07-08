package maze_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/dmigwi/tapoo/maze"
)

func TestGenerateMaze(t *testing.T) {
	t.Parallel()

	config := &maze.Dimensions{
		Length: 10,
		Width:  10,
	}

	data, err := config.GenerateMaze(maze.WallWeight(-1))
	if err == nil {
		t.Fatal("GenerateMaze(-1) expected an error but got nil")
	}

	if len(data) != 0 {
		t.Fatalf("expected invalid wall weight to return an empty maze, got %v", data)
	}

	if len(config.StartPosition) != 0 || len(config.FinalPosition) != 0 {
		t.Fatalf(
			"expected invalid wall weight to leave positions unset, got start=%v final=%v",
			config.StartPosition,
			config.FinalPosition,
		)
	}

	if !strings.Contains(err.Error(), "invalid wall weight:") {
		t.Fatalf("unexpected error message: %v", err)
	}

	data, err = config.GenerateMaze(maze.WallWeightRegular)
	if err != nil {
		t.Fatalf("GenerateMaze(1) returned error: %v", err)
	}

	if len(data) == 0 {
		t.Fatal("GenerateMaze(1) returned an empty maze")
	}

	if len(config.StartPosition) == 0 || len(config.FinalPosition) == 0 {
		t.Fatalf(
			"expected maze generation to populate start and final positions, got start=%v final=%v",
			config.StartPosition,
			config.FinalPosition,
		)
	}

	if equalPosition(config.StartPosition, config.FinalPosition) {
		t.Fatalf("expected distinct start and final positions, got %v", config.StartPosition)
	}

	if countPassages(data) == 0 {
		t.Fatal("expected generated maze to contain carved passages")
	}
}

func TestGenerateMazeRepeatable(t *testing.T) {
	t.Parallel()

	tests := []maze.Dimensions{
		{Length: 5, Width: 5},
		{Length: 4, Width: 4},
	}

	for _, config := range tests {
		t.Run(fmt.Sprintf("%dx%d", config.Length, config.Width), func(t *testing.T) {
			t.Parallel()

			data, err := config.GenerateMaze(maze.WallWeightRegular)
			if err != nil {
				t.Fatalf("GenerateMaze returned error: %v", err)
			}

			if countPassages(data) == 0 {
				t.Fatal("expected repeated maze generation to keep carving passages")
			}

			if equalPosition(config.StartPosition, config.FinalPosition) {
				t.Fatalf("expected repeated maze generation to keep distinct endpoints, got %v", config.StartPosition)
			}
		})
	}
}

func countPassages(data [][]string) int {
	count := 0

	for row, cells := range data {
		for col, cell := range cells {
			switch {
			case row%2 == 0 && col%2 == 1 && cell == "   ":
				count++
			case row%2 == 1 && col%2 == 0 && cell == " ":
				count++
			}
		}
	}

	return count
}

func equalPosition(left, right []int) bool {
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
