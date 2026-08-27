package maze

import (
	cryptorand "crypto/rand"
	"fmt"
	"math/big"
	"strings"
)

type (
	// CellAddress defines the nine points/coordinates that make up an individual cell.
	// Each of the points define the location of a character that is meant to be a
	// wall or a path of the maze. MiddleCenter represents a part of the path of the maze,
	// while BottomCenter, BottomLeft, BottomRight, MiddleLeft, MiddleRight, TopCenter,
	// TopLeft and TopRight can either be a part of the path or a part the wall of the maze.
	CellAddress struct {
		BottomCenter [2]int
		BottomLeft   [2]int
		BottomRight  [2]int
		MiddleCenter [2]int
		MiddleLeft   [2]int
		MiddleRight  [2]int
		TopCenter    [2]int
		TopLeft      [2]int
		TopRight     [2]int
	}

	// CellNeighbors defines the four nieghbors that may surround a given cell.
	// Cells along the maze edges have two to three nieghbors but cells at the center
	// of the maze have four neighbors.
	CellNeighbors struct {
		Bottom int
		Left   int
		Right  int
		Top    int
	}
)

// PRNGGenerator returns a random integer in the range [0, limit), matching secureRandomIndex's own
// contract. GenerateMaze/GenerateMazeWithProfile accept one as an optional trailing argument,
// defaulting to secureRandomIndex when omitted, so tests can substitute a seeded, deterministic
// generator (e.g. an xorshift128 implementation living in the test file) instead of crypto/rand.
// Production code must never pass one - the default is what keeps maze layouts genuinely
// unpredictable there.
type PRNGGenerator func(limit int) (int, error)

// secureRandomIndex returns a cryptographically random index in the range [0, limit).
// Maze generation only uses this for start-cell selection, where preserving unpredictability matters.
func secureRandomIndex(limit int) (int, error) {
	if limit <= 0 {
		return 0, nil
	}

	value, err := cryptorand.Int(cryptorand.Reader, big.NewInt(int64(limit)))
	if err != nil {
		return 0, err
	}

	return int(value.Int64()), nil
}

// resolveGenerator returns the caller-supplied generator when GenerateMaze/GenerateMazeWithProfile
// received one, otherwise secureRandomIndex. Variadic rather than a plain optional parameter (Go has
// no default argument values) keeps every existing call site compiling unchanged.
func resolveGenerator(generator []PRNGGenerator) PRNGGenerator {
	if len(generator) > 0 && generator[0] != nil {
		return generator[0]
	}

	return secureRandomIndex
}

// CreatePlayingField creates the initial version of the maze which is a grid of cells.
// The cells are created with terminal-printable characters, and wall weight controls
// which glyph set is used for the border and passage outlines.
func (config *Dimensions) CreatePlayingField(weight WallWeight) ([][]string, error) {
	chars, err := getWallCharacters(weight)
	if err != nil {
		return nil, err
	}

	rows := (cellSpan * config.NumRows) + 1
	data := make([][]string, 0, rows)
	passage := passageGlyph(0)
	rowCapacity := ((config.NumCols + 1) * cellSpan)

	for rowIndex := range rows {
		row := make([]string, 0, rowCapacity)

		for columnIndex := 0; columnIndex <= config.NumCols; columnIndex++ {
			row = append(row, chars[0])
			switch {
			case columnIndex != config.NumCols && rowIndex%2 == 0:
				row = append(row, chars[1])
			case columnIndex != config.NumCols && rowIndex%2 != 0:
				row = append(row, passage)
			default:
				row = append(row, "\n")
			}
		}

		data = append(data, row)
	}

	return data, nil
}

// GetCellAddress creates and returns the cell address of the provided cell.
// A cell address is defined by the nine coordinates, where each of them represents the
// actual position of a terminal printable character that becomes a part of the maze.
func (config *Dimensions) GetCellAddress(cellNo int) CellAddress {
	if cellNo <= 0 || cellNo > (config.NumCols*config.NumRows) {
		return CellAddress{}
	}

	// Cells are numbered row by row, so zero-based integer division and remainder identify the cell slot.
	row := (((cellNo - 1) / config.NumCols) + 1) * cellSpan
	column := (((cellNo - 1) % config.NumCols) + 1) * cellSpan

	return CellAddress{
		BottomCenter: [2]int{row, column - 1},
		BottomLeft:   [2]int{row, column - cellSpan},
		BottomRight:  [2]int{row, column},
		MiddleCenter: [2]int{row - 1, column - 1},
		MiddleLeft:   [2]int{row - 1, column - cellSpan},
		MiddleRight:  [2]int{row - 1, column},
		TopCenter:    [2]int{row - cellSpan, column - 1},
		TopLeft:      [2]int{row - cellSpan, column - cellSpan},
		TopRight:     [2]int{row - cellSpan, column},
	}
}

// GetCellNeighbors fetches all the possible neighbors of the provided cell.
func (config *Dimensions) GetCellNeighbors(cellNo int) CellNeighbors {
	if cellNo <= 0 || cellNo > (config.NumCols*config.NumRows) {
		return CellNeighbors{}
	}

	// Neighbor numbering follows the same row-major layout as the generated maze cells.
	column := (cellNo - 1) % config.NumCols
	var (
		right     = cellNo + 1
		left      = cellNo - 1
		top       = cellNo - config.NumCols
		bottom    = cellNo + config.NumCols
		neighbors = CellNeighbors{}
	)

	if column < config.NumCols-1 {
		neighbors.Right = right
	}

	if column > 0 {
		neighbors.Left = left
	}

	if top > 0 {
		neighbors.Top = top
	}

	if bottom <= (config.NumCols * config.NumRows) {
		neighbors.Bottom = bottom
	}

	return neighbors
}

// getWallCharacters returns the maze wall characters associated with the provided wall weight.
func getWallCharacters(weight WallWeight) ([3]string, error) {
	switch weight {
	case WallWeightRegular:
		return [3]string{"|", "---", "-"}, nil
	case WallWeightMedium:
		return [3]string{"╏", "╍╍╍", "╍"}, nil
	case WallWeightBold:
		return [3]string{"║", "===", "="}, nil
	default:
		err := fmt.Errorf(
			"invalid wall weight: %s. allowed values are %s, %s, and %s",
			weight, WallWeightRegular, WallWeightMedium, WallWeightBold,
		)
		return [3]string{}, err
	}
}

// reweightMaze returns a copy of the maze data with every wall glyph translated from one
// supported wall weight to the next while preserving the carved passage layout.
func reweightMaze(data [][]string, currentWeight WallWeight) ([][]string, error) {
	fromChars, err := getWallCharacters(currentWeight)
	if err != nil {
		return nil, err
	}

	toChars, err := getWallCharacters(currentWeight.Next())
	if err != nil {
		return nil, err
	}

	translated := make([][]string, len(data))
	replacements := map[string]string{
		fromChars[0]: toChars[0],
		fromChars[1]: toChars[1],
		fromChars[2]: toChars[2],
	}

	for rowIndex, row := range data {
		translated[rowIndex] = append([]string(nil), row...)

		for colIndex, cell := range row {
			if replacement, ok := replacements[cell]; ok {
				translated[rowIndex][colIndex] = replacement
			}
		}
	}

	return translated, nil
}

// passageGlyph returns a cellPathWidth-wide passage segment: blank when marker is zero, or the
// marker surrounded by space padding otherwise. Every writable maze cell slot goes through this so
// its width stays consistent regardless of whether it is blank or visited. The padding is derived
// from cellPathWidth rather than hardcoded, so a marker glyph always keeps a leading space - the
// invariant isTraversable relies on.
func passageGlyph(marker rune) string {
	if marker == 0 {
		return strings.Repeat(" ", cellPathWidth)
	}

	leading := (cellPathWidth - 1) / glyphPaddingSides
	return strings.Repeat(" ", leading) + string(marker) + strings.Repeat(" ", cellPathWidth-1-leading)
}

// isTraversable returns true when the segment is an open passage rather than a wall. Callers only
// ever pass the slot between two cells - PlayerMovement's probe, and replaceChar's neighbours during
// generation - never a cell centre, so it never sees a visited marker and the leading-space check is
// enough. The name reads as broader than that on purpose: what a caller wants to know is whether it
// may move through the segment.
func isTraversable(item string) bool {
	return len(item) > 0 && item[0] == ' '
}
