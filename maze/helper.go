package maze

import (
	"crypto/rand"
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

// CreatePlayingField creates the initial version of the maze which is a grid of cells.
// The cells are created with terminal-printable characters, and wall weight controls
// which glyph set is used for the border and passage outlines.
func (config *Dimensions) CreatePlayingField(weight WallWeight) ([][]string, error) {
	chars, err := getWallCharacters(weight)
	if err != nil {
		return nil, err
	}

	rows := (cellSpan * config.Width) + 1
	data := make([][]string, 0, rows)
	passage := strings.Repeat(" ", cellPathWidth)
	rowCapacity := ((config.Length + 1) * cellSpan)

	for rowIndex := range rows {
		row := make([]string, 0, rowCapacity)

		for columnIndex := 0; columnIndex <= config.Length; columnIndex++ {
			row = append(row, chars[0])
			switch {
			case columnIndex != config.Length && rowIndex%2 == 0:
				row = append(row, chars[1])
			case columnIndex != config.Length && rowIndex%2 != 0:
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
	if cellNo <= 0 || cellNo > (config.Length*config.Width) {
		return CellAddress{}
	}

	// Cells are numbered row by row, so zero-based integer division and remainder identify the cell slot.
	row := (((cellNo - 1) / config.Length) + 1) * cellSpan
	column := (((cellNo - 1) % config.Length) + 1) * cellSpan

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
	column := (cellNo - 1) % config.Length
	var (
		right     = cellNo + 1
		left      = cellNo - 1
		top       = cellNo - config.Length
		bottom    = cellNo + config.Length
		neighbors = CellNeighbors{}
	)

	if column < config.Length-1 {
		neighbors.Right = right
	}

	if column > 0 {
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

// isSpaceFound checks for the space character in a given string
// Boolean true is returned if space is found.
func isSpaceFound(item string) bool {
	return strings.Contains(item, " ")
}
