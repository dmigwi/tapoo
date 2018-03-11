package maze

import (
	"errors"
	"math"
)

// seed defines the size of the maze to be used in the training level (level 0).
// It can also be referred to as the size of the training field.
const seed = 100

// diff defines the difference between maze sizes in consecutive game levels.
const diff = 10

// max_level defines the maximum level that can be played in this game.
// Due to the large size of the maze at the final level, it might never be reached especially
// for users with smaller screen sizes.
const max_level = 290

// generateMazeArea generates the full maze size depending on the provided game level.
func generateMazeArea(level int) float64 {
	// Level larger than max_level should never be used
	if level >= max_level {
		level = max_level
	}
	return float64((level * diff) + seed)
}

// factorizeMazeArea factorizes the MazeArea using the trial division algorithm
// to get all possible factors for the length and the width values.
// The smallest value of either length or width can only be 5.
func factorizeMazeArea(mazeArea float64, tSize Dimensions) []Dimensions {
	var (
		val      int
		remaider float64

		size = make([]Dimensions, 0)
	)

	for i := int(math.Sqrt(mazeArea)); i > 4; i-- {
		val = int(mazeArea) / i
		remaider = math.Remainder(mazeArea, float64(i))

		if remaider == 0 && (tSize.Length >= val) && (tSize.Width >= i) {
			size = append(size, Dimensions{Length: int(mazeArea) / i, Width: i})
		}

		if remaider == 0 && (tSize.Length >= i) && (tSize.Width >= val) {
			size = append(size, Dimensions{Length: i, Width: val})
		}
	}

	return size
}

// getMazeDimension obtains the best length and width measurements for the
// current level and terminal size provided.
func getMazeDimension(level int, terminalSize Dimensions) (*Dimensions, error) {
	area := generateMazeArea(level)
	errMsg := "terminal size is too small for the current level"

	if int(area) > (terminalSize.Width * terminalSize.Length) {
		return &Dimensions{}, errors.New(errMsg)
	}

	dimensions := factorizeMazeArea(area, terminalSize)
	totalCount := len(dimensions)

	for i := 0; i < totalCount; i++ {
		return &dimensions[getRandomNo(totalCount)], nil
	}

	// If the terminal size hasn't been minimized, It should never get here
	return &Dimensions{}, errors.New(errMsg)
}
