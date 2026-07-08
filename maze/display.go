package maze

import (
	"errors"
	"fmt"
	"unicode/utf8"

	termbox "github.com/nsf/termbox-go"
)

// UIOverlay defines the interrupt content rendered above the base maze view.
type UIOverlay struct {
	// Message is the primary pause or game-over text shown in the center overlay.
	Message string

	// Color controls the overlay score color when ShowHighScore is enabled.
	Color termbox.Attribute

	// ShowHighScore controls whether the overlay renders the high score banner.
	ShowHighScore bool
}

// fill prints a string to the termbox view box on the given coordinates.
func fill(ui UI, x, y int, val string, foreground termbox.Attribute) int {
	width := 0
	for _, char := range val {
		ui.SetCell(x+width, y, char, foreground, coldef)
		width++
	}

	return width
}

// DrawMaze draws the maze on the termbox view.
func DrawMaze(ui UI, data [][]string) error {
	if err := ui.Clear(coldef, coldef); err != nil {
		return err
	}

	// The header is centered relative to the rendered maze width so it scales with level size.
	titleColumn := mazeWidth(data) / screenTitleDivisor
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

	for rowIndex, row := range data {
		column := mazeLeftPadding
		for _, segment := range row {
			column += fill(ui, column, mazeTopPadding+rowIndex, segment, coldef)
		}
	}

	return nil
}

// RenderMazeUI redraws the maze either as the live game view or as an interrupt overlay.
// When overlay is nil, the current player, target, and score banner are rendered and the
// returned bool reports whether the player is already on the goal. When overlay is provided,
// the centered pause or game-over panel is rendered instead.
func RenderMazeUI(ui UI, config *Dimensions, level, score int, data [][]string, overlay *UIOverlay) (bool, error) {
	if err := DrawMaze(ui, data); err != nil {
		return false, err
	}

	if overlay == nil {
		if config == nil {
			return false, errors.New("render live maze ui: missing dimensions")
		}

		if len(config.StartPosition) != cellSpan || len(config.FinalPosition) != cellSpan {
			return false, errors.New("render live maze ui: missing start or goal positions")
		}

		targetReached := renderLiveScene(ui, config, level, score, data)
		if err := ui.Flush(); err != nil {
			return false, err
		}
		return targetReached, nil
	}

	renderOverlayScene(ui, score, data, overlay)
	if err := ui.Flush(); err != nil {
		return false, err
	}

	return false, nil
}

// renderLiveScene adds the player marker, goal marker, and status banner to the base maze view.
func renderLiveScene(ui UI, config *Dimensions, level, score int, data [][]string) bool {
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

	fill(
		ui,
		mazeWidth(data)/screenTitleDivisor,
		len(data)+statusRowOffset,
		fmt.Sprintf(statusMsg, level, score),
		coldef,
	)

	// The caller decides how to react; the live renderer only reports whether the player reached the goal.
	return positionsEqual(startPos, targetPos)
}

// renderOverlayScene clears the center panel area and draws the pause or game-over content.
func renderOverlayScene(ui UI, score int, data [][]string, overlay *UIOverlay) {
	// The overlay clears a small box in the middle of the maze before drawing pause or game-over text.
	xAxis := mazeWidth(data) / overlayLeftDivisor

	for _, loc := range []int{overlayClearRowOne, overlayClearRowTwo, overlayClearRowTree, overlayClearRowFour} {
		fill(ui, xAxis, len(data)/2+loc, space, coldef)
	}

	for _, message := range []struct {
		row int
		msg string
	}{
		{row: overlayRowMessage, msg: overlay.Message},
		{row: overlayRowNavigate, msg: gameOverNavigation},
	} {
		fill(ui, xAxis, len(data)/2+message.row, message.msg, coldef)
	}

	scoresMsg := space
	if overlay.ShowHighScore {
		scoresMsg = fmt.Sprintf(highScores, score)
	}

	fill(ui, xAxis, len(data)/2+scoreRowOffset, scoresMsg, overlay.Color)
}

func mazeWidth(data [][]string) int {
	if len(data) == 0 {
		return 0
	}

	width := 0
	for _, segment := range data[0] {
		width += utf8.RuneCountInString(segment)
	}

	return width
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
