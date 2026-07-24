package maze

import (
	"errors"
	"fmt"
	"math"
)

// GenerateMazeArea generates the full maze size depending on the provided game level.
func GenerateMazeArea(level int) int {
	return (level * diff) + seed
}

// appendFittingDimensions adds every orientation of the factor pair that fits within the terminal bounds.
func appendFittingDimensions(candidates []Dimensions, numCols, numRows int, terminalSize Dimensions) []Dimensions {
	if numCols < minMazeDimension || numRows < minMazeDimension {
		return candidates
	}

	// Each factor pair can fit in landscape, portrait, or both depending on the terminal bounds.
	if terminalSize.NumCols >= numCols && terminalSize.NumRows >= numRows {
		candidates = append(candidates, Dimensions{NumCols: numCols, NumRows: numRows})
	}

	if numCols != numRows && terminalSize.NumCols >= numRows && terminalSize.NumRows >= numCols {
		candidates = append(candidates, Dimensions{NumCols: numRows, NumRows: numCols})
	}

	return candidates
}

// fittingDimensionsForArea returns every factor pair for the maze area that can fit within the terminal.
// Trial division starts at sqrt(area) so each factor pair is discovered exactly once.
func fittingDimensionsForArea(mazeArea int, terminalSize Dimensions) []Dimensions {
	candidates := make([]Dimensions, 0, cellSpan)

	for divisor := int(math.Sqrt(float64(mazeArea))); divisor >= minMazeDimension; divisor-- {
		if mazeArea%divisor != 0 {
			continue
		}
		candidates = appendFittingDimensions(candidates, divisor, mazeArea/divisor, terminalSize)
	}
	return candidates
}

// aspectMismatchScore measures how far a candidate maze shape is from the terminal aspect ratio.
// Lower scores indicate a better fit for the available drawing area.
func aspectMismatchScore(candidate, terminalSize Dimensions) int {
	return absInt(candidate.NumCols*terminalSize.NumRows - candidate.NumRows*terminalSize.NumCols)
}

// isPreferredMazeDimensions compares two fitting candidates and reports whether candidate should win.
// Preference order is:
// 1. Lowest internal skew so more balanced mazes win first.
// 2. Closest aspect ratio match to the terminal.
// Any remaining tie keeps the first deterministic candidate.
func isPreferredMazeDimensions(candidate, currentBest, terminalSize Dimensions) bool {
	candidateSkew := absInt(candidate.NumCols - candidate.NumRows)
	bestSkew := absInt(currentBest.NumCols - currentBest.NumRows)
	if candidateSkew != bestSkew {
		return candidateSkew < bestSkew
	}

	candidatePenalty := aspectMismatchScore(candidate, terminalSize)
	bestPenalty := aspectMismatchScore(currentBest, terminalSize)
	if candidatePenalty != bestPenalty {
		return candidatePenalty < bestPenalty
	}

	return false
}

// chooseBestMazeDimensions selects the single candidate that best matches the current terminal.
func chooseBestMazeDimensions(candidates []Dimensions, terminalSize Dimensions) Dimensions {
	best := candidates[0]
	for _, candidate := range candidates[1:] {
		if isPreferredMazeDimensions(candidate, best, terminalSize) {
			best = candidate
		}
	}

	return best
}

// GetMazeDimensions obtains the best numCols and numRows measurements for the
// current level and terminal size provided.
func GetMazeDimensions(level int, terminalSize Dimensions) (*Dimensions, error) {
	area := GenerateMazeArea(level)
	errMsg := fmt.Sprintf(tooSmallMazeFormat, level)

	// Bail out early when the raw area cannot possibly fit before spending time on factorization.
	if area > (terminalSize.NumRows * terminalSize.NumCols) {
		return &Dimensions{}, errors.New(errMsg)
	}

	candidates := fittingDimensionsForArea(area, terminalSize)
	if len(candidates) == 0 {
		return &Dimensions{}, errors.New(errMsg)
	}

	best := chooseBestMazeDimensions(candidates, terminalSize)
	return &best, nil
}

// GetTerminalSize calculate the terminal size from the values captured by the
// termbox.Size() function.
func GetTerminalSize(h, w int) Dimensions {
	// The termbox canvas reserves header and margin space, so only part of the terminal is available to the maze.
	return Dimensions{
		NumCols: nonNegative((h - terminalHeightInset) / terminalHeightScale),
		NumRows: nonNegative((w - terminalWidthInset) / terminalWidthScale),
	}
}

func nonNegative(value int) int {
	if value < 0 {
		return 0
	}

	return value
}

func absInt(value int) int {
	if value < 0 {
		return -value
	}
	return value
}
