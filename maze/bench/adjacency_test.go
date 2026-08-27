package maze_test

import (
	"strings"
	"testing"

	"github.com/dmigwi/tapoo/maze"
)

// TestMazeAdjacencyHashIsDeterministic hashes a real generated maze twice and checks the format -
// the same grid must always hash to the same value, and the value must be shaped the way
// parity-harness/bench-report.mjs and frontend/app/logs.ts's fnv1a64Checksum expect (0x-prefixed, 16 hex
// digits) so the driver can compare Go's and TypeScript's hash sequences with plain string equality.
func TestMazeAdjacencyHashIsDeterministic(t *testing.T) {
	t.Parallel()

	config := maze.Dimensions{NumCols: 5, NumRows: 5}
	grid, err := config.GenerateMaze(maze.WallWeightRegular, newXorshift128Generator(1))
	if err != nil {
		t.Fatalf("GenerateMaze returned error: %v", err)
	}

	first := mazeAdjacencyHash(config, grid)
	second := mazeAdjacencyHash(config, grid)

	if first != second {
		t.Fatalf("expected hashing the same grid twice to produce the same hash, got %s and %s", first, second)
	}

	if !strings.HasPrefix(first, "0x") || len(first) != 18 {
		t.Fatalf("expected a 0x-prefixed 16-hex-digit hash, got %q", first)
	}
}

// TestMazeAdjacencyHashDiffersOnASinglePassage proves the hash actually discriminates rather than
// only ever separating wildly-different mazes: two grids that are byte-for-byte identical except for
// one single passage being open in one and closed in the other must hash differently. Without this,
// a check that only ever compares gross mismatches could pass even with a bug that's far too lenient.
func TestMazeAdjacencyHashDiffersOnASinglePassage(t *testing.T) {
	t.Parallel()

	config := maze.Dimensions{NumCols: 2, NumRows: 1}

	closedGrid, err := config.CreatePlayingField(maze.WallWeightRegular)
	if err != nil {
		t.Fatalf("CreatePlayingField returned error: %v", err)
	}

	openGrid := make([][]string, len(closedGrid))
	for i, row := range closedGrid {
		openGrid[i] = append([]string(nil), row...)
	}

	// Open the single passage between cell 1 and cell 2 (their only shared wall) in openGrid only -
	// everything else about the two grids stays identical.
	address := config.GetCellAddress(1)
	openGrid[address.MiddleRight[0]][address.MiddleRight[1]] = " "

	closedHash := mazeAdjacencyHash(config, closedGrid)
	openHash := mazeAdjacencyHash(config, openGrid)

	if closedHash == openHash {
		t.Fatalf(
			"expected opening a single passage to change the adjacency hash, both hashed to %s",
			closedHash,
		)
	}
}
