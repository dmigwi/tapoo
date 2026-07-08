package maze_test

import (
	"fmt"
	"slices"
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
		t.Fatal("GenerateMaze with an invalid wall weight expected an error but got nil")
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
		t.Fatalf("GenerateMaze() returned error for regular wall weight: %v", err)
	}

	if len(data) == 0 {
		t.Fatal("GenerateMaze() returned an empty maze")
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

	for _, weight := range []maze.WallWeight{maze.WallWeightMedium, maze.WallWeightBold} {
		newData, errData := config.GenerateMaze(weight)
		if errData != nil {
			t.Fatalf("GenerateMaze(%s) returned error: %v", weight, errData)
		}

		if !mazeContainsWallWeight(newData, weight) {
			t.Fatalf("expected generated maze to contain %s wall characters", weight)
		}
	}
}

func TestGenerateMazeRepeatable(t *testing.T) {
	t.Parallel()

	for _, testCase := range []struct {
		config maze.Dimensions
		weight maze.WallWeight
	}{
		{config: maze.Dimensions{Length: 5, Width: 5}, weight: maze.WallWeightRegular},
		{config: maze.Dimensions{Length: 5, Width: 5}, weight: maze.WallWeightMedium},
		{config: maze.Dimensions{Length: 4, Width: 4}, weight: maze.WallWeightBold},
	} {
		config := testCase.config
		t.Run(fmt.Sprintf("%dx%d-%s", config.Length, config.Width, testCase.weight), func(t *testing.T) {
			t.Parallel()

			data, err := config.GenerateMaze(testCase.weight)
			if err != nil {
				t.Fatalf("GenerateMaze returned error: %v", err)
			}

			if countPassages(data) == 0 {
				t.Fatal("expected repeated maze generation to keep carving passages")
			}

			if equalPosition(config.StartPosition, config.FinalPosition) {
				t.Fatalf("expected repeated maze generation to keep distinct endpoints, got %v", config.StartPosition)
			}

			if !mazeContainsWallWeight(data, testCase.weight) {
				t.Fatalf("expected generated maze to use %s walls", testCase.weight)
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

func mazeContainsWallWeight(data [][]string, weight maze.WallWeight) bool {
	wallSegments := map[maze.WallWeight]string{
		maze.WallWeightRegular: "|",
		maze.WallWeightMedium:  "╏",
		maze.WallWeightBold:    "║",
	}

	for _, row := range data {
		if slices.Contains(row, wallSegments[weight]) {
			return true
		}
	}

	return false
}
