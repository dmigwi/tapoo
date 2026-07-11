package maze

import (
	"errors"
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
// 1. Closest aspect ratio match to the terminal.
// 2. Lowest internal skew so more balanced mazes win ties.
// 3. Largest smaller edge so narrow mazes lose when quality is otherwise equal.
// 4. Deterministic final ordering by length, then width.
func isPreferredMazeDimensions(candidate, currentBest, terminalSize Dimensions) bool {
	candidatePenalty := aspectMismatchScore(candidate, terminalSize)
	bestPenalty := aspectMismatchScore(currentBest, terminalSize)
	if candidatePenalty != bestPenalty {
		return candidatePenalty < bestPenalty
	}

	candidateSkew := absInt(candidate.Length - candidate.Width)
	bestSkew := absInt(currentBest.Length - currentBest.Width)
	if candidateSkew != bestSkew {
		return candidateSkew < bestSkew
	}

	candidateMinEdge := min(candidate.Length, candidate.Width)
	bestMinEdge := min(currentBest.Length, currentBest.Width)
	if candidateMinEdge != bestMinEdge {
		return candidateMinEdge > bestMinEdge
	}

	if candidate.Length != currentBest.Length {
		return candidate.Length > currentBest.Length
	}

	return candidate.Width > currentBest.Width
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
	errMsg := "the next maze needs more screen room; enlarge the window to keep playing"

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
		Length: (h - terminalHeightInset) / terminalHeightScale,
		Width:  (w - terminalWidthInset) / terminalWidthScale,
	}
}

func absInt(value int) int {
	if value < 0 {
		return -value
	}
	return value
}
