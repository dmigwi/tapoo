package maze_test

import (
	"fmt"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/dmigwi/tapoo/maze"
)

func TestGenerateMaze(t *testing.T) {
	t.Parallel()

	config := &maze.Dimensions{
		NumCols: 10,
		NumRows: 10,
	}

	data, err := config.GenerateMaze(maze.WallWeight(-1))
	if err == nil {
		t.Fatal("GenerateMaze with an invalid wall weight expected an error but got nil")
	}

	if len(data) != 0 {
		t.Fatalf("expected invalid wall weight to return an empty maze, got %v", data)
	}

	if config.StartPosition != [2]int{} || config.FinalPosition != [2]int{} {
		t.Fatalf(
			"expected invalid wall weight to leave positions unset, got start=%v final=%v",
			config.StartPosition,
			config.FinalPosition,
		)
	}

	if !strings.Contains(err.Error(), "invalid wall weight:") {
		t.Fatalf("unexpected error message: %v", err)
	}

	singleCellConfig := &maze.Dimensions{NumCols: 1, NumRows: 1}
	data, err = singleCellConfig.GenerateMaze(maze.WallWeightRegular)
	if err == nil {
		t.Fatal("GenerateMaze() expected an error when the maze has fewer than two cells")
	}

	if len(data) != 0 {
		t.Fatalf("expected a single-cell maze generation failure to return an empty maze, got %v", data)
	}

	if singleCellConfig.StartPosition != [2]int{} || singleCellConfig.FinalPosition != [2]int{} {
		t.Fatalf(
			"expected failed endpoint validation to clear positions, got start=%v final=%v",
			singleCellConfig.StartPosition, singleCellConfig.FinalPosition,
		)
	}

	if !strings.Contains(err.Error(), "at least two cells are required") {
		t.Fatalf("unexpected single-cell generation error: %v", err)
	}

	for _, invalidConfig := range []*maze.Dimensions{
		{NumCols: 0, NumRows: 10},
		{NumCols: 10, NumRows: 0},
		{NumCols: -1, NumRows: 10},
		{NumCols: 10, NumRows: -1},
	} {
		data, err = invalidConfig.GenerateMaze(maze.WallWeightRegular)
		if err == nil {
			t.Fatalf("GenerateMaze(%+v) expected an error for invalid dimensions", *invalidConfig)
		}

		if len(data) != 0 {
			t.Fatalf("expected invalid dimensions to return an empty maze, got %v", data)
		}

		if invalidConfig.StartPosition != [2]int{} || invalidConfig.FinalPosition != [2]int{} {
			t.Fatalf(
				"expected invalid dimensions to clear positions, got start=%v final=%v",
				invalidConfig.StartPosition,
				invalidConfig.FinalPosition,
			)
		}

		if !strings.Contains(err.Error(), "both values must be greater than zero") {
			t.Fatalf("unexpected invalid dimensions error: %v", err)
		}
	}

	data, err = config.GenerateMaze(maze.WallWeightRegular)
	if err != nil {
		t.Fatalf("GenerateMaze() returned error for regular wall weight: %v", err)
	}

	if len(data) == 0 {
		t.Fatal("GenerateMaze() returned an empty maze")
	}

	if config.StartPosition == [2]int{} || config.FinalPosition == [2]int{} {
		t.Fatalf(
			"expected maze generation to populate start and final positions, got start=%v final=%v",
			config.StartPosition, config.FinalPosition,
		)
	}

	if slices.Equal(config.StartPosition[:], config.FinalPosition[:]) {
		t.Fatalf("expected distinct start and final positions, got %v", config.StartPosition)
	}

	if countPassages(data) == 0 {
		t.Fatal("expected generated maze to contain carved passages")
	}

	assertPlayableMaze(t, *config, data)

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
		{config: maze.Dimensions{NumCols: 5, NumRows: 5}, weight: maze.WallWeightRegular},
		{config: maze.Dimensions{NumCols: 5, NumRows: 5}, weight: maze.WallWeightMedium},
		{config: maze.Dimensions{NumCols: 4, NumRows: 4}, weight: maze.WallWeightBold},
	} {
		config := testCase.config
		t.Run(fmt.Sprintf("%dx%d-%s", config.NumCols, config.NumRows, testCase.weight), func(t *testing.T) {
			t.Parallel()

			data, err := config.GenerateMaze(testCase.weight)
			if err != nil {
				t.Fatalf("GenerateMaze returned error: %v", err)
			}

			if countPassages(data) == 0 {
				t.Fatal("expected repeated maze generation to keep carving passages")
			}

			if slices.Equal(config.StartPosition[:], config.FinalPosition[:]) {
				t.Fatalf("expected repeated maze generation to keep distinct endpoints, got %v", config.StartPosition)
			}

			if !mazeContainsWallWeight(data, testCase.weight) {
				t.Fatalf("expected generated maze to use %s walls", testCase.weight)
			}

			assertPlayableMaze(t, config, data)
		})
	}
}

// newXorshift128Generator returns a small, deterministic maze.PRNGGenerator for tests - mirrors
// frontend/app/maze.test.ts's createXorshift128Generator algorithm exactly (same standard 4-word
// xorshift128 state update, same 32-bit word arithmetic) so both codebases' test suites inject the
// same generator rather than each rolling their own. Using uint32 throughout keeps every shift a
// logical (zero-filling) shift, matching JS's explicit >>> operator bit for bit.
func newXorshift128Generator(seed int) maze.PRNGGenerator {
	x := uint32(seed)
	if x == 0 {
		x = 1
	}
	y, z, w := uint32(362436069), uint32(521288629), uint32(88675123)

	return func(limit int) (int, error) {
		if limit <= 0 {
			return 0, nil
		}

		t := x ^ (x << 11)
		x, y, z = y, z, w
		w = (w ^ (w >> 19)) ^ (t ^ (t >> 8))
		return int(w % uint32(limit)), nil
	}
}

// TestGenerateMazeDeterministicWithFixedGenerator swaps secureRandomIndex for a seeded generator
// (newXorshift128Generator above) instead of exercising real crypto/rand, mirroring
// frontend/app/maze.test.ts's "generates a deterministic maze layout for a fixed random source" test
// with the same xorshift128 algorithm - proving GenerateMaze's new optional generator parameter
// actually makes layout generation fully reproducible.
func TestGenerateMazeDeterministicWithFixedGenerator(t *testing.T) {
	t.Parallel()

	first := maze.Dimensions{NumCols: 5, NumRows: 5}
	firstData, err := first.GenerateMaze(maze.WallWeightRegular, newXorshift128Generator(1))
	if err != nil {
		t.Fatalf("GenerateMaze returned error: %v", err)
	}

	second := maze.Dimensions{NumCols: 5, NumRows: 5}
	secondData, err := second.GenerateMaze(maze.WallWeightRegular, newXorshift128Generator(1))
	if err != nil {
		t.Fatalf("GenerateMaze returned error: %v", err)
	}

	if !reflect.DeepEqual(firstData, secondData) {
		t.Fatalf("expected the same seeded generator to reproduce an identical maze layout")
	}

	if first.StartPosition != second.StartPosition || first.FinalPosition != second.FinalPosition {
		t.Fatalf(
			"expected the same seeded generator to reproduce identical endpoints, got start=%v/%v final=%v/%v",
			first.StartPosition, second.StartPosition, first.FinalPosition, second.FinalPosition,
		)
	}

	assertPlayableMaze(t, first, firstData)
}

func assertPlayableMaze(t *testing.T, config maze.Dimensions, data [][]string) {
	t.Helper()

	if !isBoundaryPosition(config, config.StartPosition) {
		t.Fatalf("expected start position to be on the maze boundary, got %v", config.StartPosition)
	}

	if !isTraversableCell(data, config.StartPosition) {
		t.Fatalf("expected start position to be on a traversable cell, got %v", config.StartPosition)
	}

	if !isTraversableCell(data, config.FinalPosition) {
		t.Fatalf("expected final position to be on a traversable cell, got %v", config.FinalPosition)
	}

	if !hasMazeRoute(data, config.StartPosition, config.FinalPosition) {
		t.Fatalf("expected a traversable path between %v and %v", config.StartPosition, config.FinalPosition)
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

func isBoundaryPosition(config maze.Dimensions, position [2]int) bool {
	maxRow := (config.NumRows * 2) - 1
	maxColumn := (config.NumCols * 2) - 1

	return position[0] == 1 || position[0] == maxRow || position[1] == 1 || position[1] == maxColumn
}

func isTraversableCell(data [][]string, position [2]int) bool {
	row, column := position[0], position[1]
	if row < 0 || row >= len(data) {
		return false
	}

	if column < 0 || column >= len(data[row]) {
		return false
	}

	return strings.HasPrefix(data[row][column], " ")
}

func hasMazeRoute(data [][]string, start, target [2]int) bool {
	if start == target {
		return true
	}

	type queueEntry struct {
		row    int
		column int
	}

	queue := []queueEntry{{row: start[0], column: start[1]}}
	visited := map[[2]int]bool{start: true}
	deltas := [][2]int{
		{0, -2},
		{0, 2},
		{-2, 0},
		{2, 0},
	}

	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]

		for _, delta := range deltas {
			next := [2]int{current.row + delta[0], current.column + delta[1]}
			if visited[next] {
				continue
			}

			midpoint := [2]int{current.row + (delta[0] / 2), current.column + (delta[1] / 2)}
			if !isTraversableCell(data, midpoint) || !isTraversableCell(data, next) {
				continue
			}

			if next == target {
				return true
			}

			visited[next] = true
			queue = append(queue, queueEntry{row: next[0], column: next[1]})
		}
	}

	return false
}
