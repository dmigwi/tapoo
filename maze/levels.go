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
func appendFittingDimensions(candidates []Dimensions, length, width int, terminalSize Dimensions) []Dimensions {
	if length < minMazeDimension || width < minMazeDimension {
		return candidates
	}

	// Each factor pair can fit in landscape, portrait, or both depending on the terminal bounds.
	if terminalSize.Length >= length && terminalSize.Width >= width {
		candidates = append(candidates, Dimensions{Length: length, Width: width})
	}

	if length != width && terminalSize.Length >= width && terminalSize.Width >= length {
		candidates = append(candidates, Dimensions{Length: width, Width: length})
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
	return absInt(candidate.Length*terminalSize.Width - candidate.Width*terminalSize.Length)
}

// isPreferredMazeDimensions compares two fitting candidates and reports whether candidate should win.
// Preference order is:
// 1. Lowest internal skew so more balanced mazes win first.
// 2. Closest aspect ratio match to the terminal.
// Any remaining tie keeps the first deterministic candidate.
func isPreferredMazeDimensions(candidate, currentBest, terminalSize Dimensions) bool {
	candidateSkew := absInt(candidate.Length - candidate.Width)
	bestSkew := absInt(currentBest.Length - currentBest.Width)
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

// GetMazeDimensions obtains the best length and width measurements for the
// current level and terminal size provided.
func GetMazeDimensions(level int, terminalSize Dimensions) (*Dimensions, error) {
	area := GenerateMazeArea(level)
	errMsg := fmt.Sprintf(tooSmallMazeFormat, level)

	// Bail out early when the raw area cannot possibly fit before spending time on factorization.
	if area > (terminalSize.Width * terminalSize.Length) {
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
		Length: nonNegative((h - terminalHeightInset) / terminalHeightScale),
		Width:  nonNegative((w - terminalWidthInset) / terminalWidthScale),
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
