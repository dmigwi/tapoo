package maze

import (
	"crypto/rand"
	"fmt"
	"math"
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

// CreatePlayingField creates the initial version of the maze which is a grid of cells.
// The cells are created with characters that are printable on the terminal.
// CreatePlayingField accept a paramenter with intensity of how thick the
// maze walls should be.
func (config *Dimensions) CreatePlayingField(intensity int) ([][]string, error) {
	var (
		chars []string
		err   error

		data = [][]string{}
	)

	if chars, err = getWallCharacters(intensity); err != nil {
		return data, err
	}

	for i := range (cellSpan * config.Width) + 1 {
		var val []string

		for k := range config.Length + 1 {
			val = append(val, chars[0])

			switch {
			case k != config.Length && i%2 == 0:
				val = append(val, chars[1])
			case k != config.Length && i%2 != 0:
				val = append(val, strings.Repeat(" ", cellPathWidth))
			default:
				val = append(val, "\n")
			}
		}

		data = append(data, val)
	}
	return data, nil
}

// GetCellAddress creates and returns the cell address of the provided cell.
// A cell address is defined by the nine coordinates, where each of them represents the
// actual position of a terminal printable character that becomes a part of the maze.
func (config *Dimensions) GetCellAddress(cellNo int) CellAddress {
	if cellNo <= 0 || cellNo > (config.Length*config.Width) {
		return CellAddress{}
	}

	// Cells are numbered row by row, so the column is the remainder and the row is the ceiled quotient.
	column := cellNo % config.Length
	if column == 0 {
		column = config.Length
	}

	row := getCeiledDivisor(cellNo, config.Length) * cellSpan
	column *= cellSpan

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
	if cellNo <= 0 || cellNo > (config.Length*config.Width) {
		return CellNeighbors{}
	}

	// Neighbor numbering follows the same row-major layout as the generated maze cells.
	var (
		right     = cellNo + 1
		left      = cellNo - 1
		top       = cellNo - config.Length
		bottom    = cellNo + config.Length
		neighbors = CellNeighbors{}
	)

	if getCeiledDivisor(right, config.Length) == getCeiledDivisor(cellNo, config.Length) {
		neighbors.Right = right
	}

	if getCeiledDivisor(left, config.Length) == getCeiledDivisor(cellNo, config.Length) {
		neighbors.Left = left
	}

	if top > 0 {
		neighbors.Top = top
	}

	if bottom <= (config.Length * config.Width) {
		neighbors.Bottom = bottom
	}

	return neighbors
}

// getRandomNo returns a pseudo-random number in the range [0, limit).
func getRandomNo(limit int) int {
	if limit <= 0 {
		return 0
	}

	// Random cell selection does not need determinism, but it should not depend on shared mutable state.
	value, err := rand.Int(rand.Reader, big.NewInt(int64(limit)))
	if err != nil {
		panic(err)
	}

	return int(value.Int64())
}

// getCeiledDivisor calculates the ceiled divisor of the two values passed.
func getCeiledDivisor(num, dinom int) int {
	return int(math.Ceil(float64(num) / float64(dinom)))
}

// getWallCharacters returns the maze wall characters associated with the provided intensity.
// If invalid intensity is used an error is thrown.
func getWallCharacters(intensity int) ([]string, error) {
	chars, ok := map[int][]string{
		1: {"|", "---", "-"},
		2: {"╏", "╍╍╍", "╍"},
		3: {"║", "===", "="},
	}[intensity]

	// Wall styles are grouped by intensity so generation and optimization can share the same lookup.
	if ok {
		return chars, nil
	}

	return chars, fmt.Errorf(
		"invalid value of intensity found: %d. allowed 1, 2 and 3", intensity)
}

// isSpaceFound checks for the space character in a given string
// Boolean true is returned if space is found.
func isSpaceFound(item string) bool {
	return strings.Contains(item, " ")
}
