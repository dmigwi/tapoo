package maze

import (
	"fmt"
	"strings"

	termbox "github.com/nsf/termbox-go"
)

// fill prints a string to the termbox view box on the given coordinates.
func fill(ui UI, x, y int, val string, foreground termbox.Attribute) {
	for index, char := range []rune(val) {
		ui.SetCell(x+index, y, char, foreground, coldef)
	}
}

// DrawMaze draws the maze on the termbox view.
func DrawMaze(ui UI, data [][]string) error {
	if err := ui.Clear(coldef, coldef); err != nil {
		return err
	}

	// The header is centered relative to the rendered maze width so it scales with level size.
	titleColumn := len(data[1]) / screenTitleDivisor
	for _, message := range []struct {
		row int
		msg string
	}{
		{row: messageRowIntro, msg: intro},
		{row: messageRowWebsite, msg: website},
		{row: messageRowControls, msg: playerNavigation},
	} {
		fill(ui, titleColumn, message.row, message.msg, coldef)
	}

	for k, d := range data {
		fill(ui, mazeLeftPadding, mazeTopPadding+k, strings.Join(d, ""), coldef)
	}

	return nil
}

// RefreshUI redraws the maze, player, goal, and score banner and reports whether the goal was reached.
func RefreshUI(ui UI, config *Dimensions, count int, data [][]string) (bool, error) {
	if err := DrawMaze(ui, data); err != nil {
		return false, err
	}

	targetPos := config.FinalPosition
	startPos := config.StartPosition

	// StartPosition and FinalPosition store maze-grid coordinates, so they are remapped into
	// termbox coordinates here using the same doubled-grid math used during generation.
	ui.SetCell(
		(targetPos[1]*cellSpan)+playerMarkerOffset,
		targetPos[0]+mazeTopPadding,
		'#',
		termbox.ColorRed,
		termbox.ColorRed,
	)
	ui.SetCell(
		(startPos[1]*cellSpan)+playerMarkerOffset,
		startPos[0]+mazeTopPadding,
		'@',
		termbox.ColorCyan,
		termbox.ColorCyan,
	)

	fill(ui, len(data[1])/screenTitleDivisor, len(data)+statusRowOffset, fmt.Sprintf(statusMsg, count), coldef)

	if err := ui.Flush(); err != nil {
		return false, err
	}

	// The caller decides how to react; RefreshUI only reports whether the player reached the goal.
	return positionsEqual(startPos, targetPos), nil
}

// InterruptUI overlays a pause or game-over message on top of the current maze render.
func InterruptUI(
	ui UI, msg string, data [][]string, color termbox.Attribute, showHighScore bool, score int,
) error {
	if err := DrawMaze(ui, data); err != nil {
		return err
	}

	// The overlay clears a small box in the middle of the maze before drawing pause or game-over text.
	xAxis := len(data[1]) / overlayLeftDivisor

	for _, loc := range []int{overlayClearRowOne, overlayClearRowTwo, overlayClearRowTree, overlayClearRowFour} {
		fill(ui, xAxis, len(data)/2+loc, space, coldef)
	}

	for _, message := range []struct {
		row int
		msg string
	}{
		{row: overlayRowMessage, msg: msg},
		{row: overlayRowNavigate, msg: gameOverNavigation},
	} {
		fill(ui, xAxis, len(data)/2+message.row, message.msg, coldef)
	}

	scoresMsg := space
	if showHighScore {
		scoresMsg = fmt.Sprintf(highScores, score)
	}

	fill(ui, xAxis, len(data)/2+scoreRowOffset, scoresMsg, color)

	return ui.Flush()
}

func positionsEqual(left, right []int) bool {
	if len(left) != len(right) {
		return false
	}

	// Slices are used throughout the package for positions, so equality is kept explicit and allocation free.
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}

	return true
}
