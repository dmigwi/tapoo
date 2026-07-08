package maze

import (
	"errors"
	"math"
)

// GenerateMazeArea generates the full maze size depending on the provided game level.
func GenerateMazeArea(level int) float64 {
	// Higher levels only increase area; clamping keeps the factorization search bounded.
	if level >= maxLevel {
		level = maxLevel
	}
	return float64((level * diff) + seed)
}

// appendFunc appends the valid dimensions to the size array.
func appendFunc(remaider float64, x, y int, tSize Dimensions) []Dimensions {
	if remaider != 0 {
		return nil
	}

	// Each factor pair can fit in landscape, portrait, or both depending on the terminal bounds.
	items := make([]Dimensions, 0, cellSpan)

	if (tSize.Length >= y) && (tSize.Width >= x) {
		items = append(items, Dimensions{Length: y, Width: x})
	}

	if (tSize.Length >= x) && (tSize.Width >= y) {
		items = append(items, Dimensions{Length: x, Width: y})
	}

	return items
}

// factorizeMazeArea factorizes the MazeArea using the trial division algorithm
// to get all possible factors for the length and the width values.
// The smallest value of either length or width can only be 5.
func factorizeMazeArea(mazeArea float64, c Dimensions) []Dimensions {
	var size = make([]Dimensions, 0)

	// Trial division starts at sqrt(area) so each valid factor pair is discovered exactly once.
	for i := int(math.Sqrt(mazeArea)); i >= minMazeDimension; i-- {
		remaider := math.Remainder(mazeArea, float64(i))
		val := int(mazeArea) / i

		size = append(size, appendFunc(remaider, i, val, c)...)
	}

	return size
}

// GetMazeDimensions obtains the best length and width measurements for the
// current level and terminal size provided.
func GetMazeDimensions(level int, terminalSize Dimensions) (*Dimensions, error) {
	area := GenerateMazeArea(level)
	errMsg := "terminal size is too small for the current level"

	// Bail out early when the raw area cannot possibly fit before spending time on factorization.
	if int(area) > (terminalSize.Width * terminalSize.Length) {
		return &Dimensions{}, errors.New(errMsg)
	}

	dimensions := factorizeMazeArea(area, terminalSize)
	totalCount := len(dimensions)

	if totalCount == 0 {
		return &Dimensions{}, errors.New(errMsg)
	}

	return &dimensions[getRandomNo(totalCount)], nil
}

// GetTerminalSize calculate the terminal size from the values captured by the
// termbox.Size() function.
func GetTerminalSize(h, w int) Dimensions {
	// The termbox canvas reserves header and margin space, so only part of the terminal is available to the maze.
	return Dimensions{
		Length: (h - terminalHeightInset) / terminalHeightScale,
		Width:  (w - terminalWidthInset) / terminalWidthScale,
	}
}
