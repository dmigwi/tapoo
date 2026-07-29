package maze

import (
	"errors"
	"fmt"
	"slices"
	"strings"
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

	// ScorePercent reports how much of the level's starting score was preserved on a winning run.
	ScorePercent int

	// WinSummary reports how the latest winning pace compares with the stored attempt history.
	WinSummary string
}

// fill prints a string to the termbox view box on the given coordinates.
func fill(ui UI, x, y int, val string, foreground termbox.Attribute) int {
	width := 0
	if isTraversable(val) {
		foreground = playerColor
	}

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

	for _, message := range []struct {
		row int
		msg string
	}{
		{row: messageRowIntro, msg: introMessage(ui.AppVersion())},
		{row: messageRowWebsite, msg: website},
		{row: messageRowControls, msg: playerNavigation},
	} {
		fill(ui, mazeLeftPadding, message.row, message.msg, coldef)
	}

	for rowIndex, row := range data {
		column := mazeLeftPadding
		for _, segment := range row {
			column += fill(ui, column, mazeTopPadding+rowIndex, segment, coldef)
		}
	}
	return nil
}

// introMessage adds the build version to the startup banner when one is available from the UI.
func introMessage(version string) string {
	return fmt.Sprintf(introFormat, strings.TrimSpace(version))
}

// RenderMazeUI redraws the maze either as the live game view or as an interrupt overlay.
// When overlay is nil, the current player, target, and score banner are rendered and the
// returned bool reports whether the player is already on the goal. When overlay is provided,
// the centered pause or game-over panel is rendered instead.
func RenderMazeUI(ui UI, config *Dimensions, level, score int, data [][]string, overlay *UIOverlay) (bool, error) {
	return renderMazeUI(ui, config, level, score, data, overlay, true)
}

func renderMazeUI(
	ui UI, config *Dimensions, level, score int, data [][]string, overlay *UIOverlay, showGoal bool,
) (bool, error) {
	if err := DrawMaze(ui, data); err != nil {
		return false, err
	}

	if overlay == nil {
		if config == nil {
			return false, errors.New("render live maze ui: missing dimensions")
		}

		targetReached := renderLiveScene(ui, config, level, score, data, showGoal)
		if err := ui.Flush(); err != nil {
			return false, err
		}
		return targetReached, nil
	}

	renderOverlayScene(ui, level, score, data, overlay)
	if err := ui.Flush(); err != nil {
		return false, err
	}

	return false, nil
}

// renderLiveScene adds the player marker, goal marker, and status banner to the base maze view.
func renderLiveScene(ui UI, config *Dimensions, level, score int, data [][]string, showGoal bool) bool {
	targetPos := config.FinalPosition
	startPos := config.StartPosition

	// StartPosition and FinalPosition store maze-grid coordinates, so they are remapped into
	// termbox coordinates here using the same doubled-grid math used during generation.
	if showGoal {
		ui.SetCell(
			(targetPos[1]*cellSpan)+mazeLeftPadding,
			targetPos[0]+mazeTopPadding,
			goalMarker,
			targetColor,
			targetColor,
		)
	}
	ui.SetCell(
		(startPos[1]*cellSpan)+mazeLeftPadding,
		startPos[0]+mazeTopPadding,
		playerMarker,
		playerColor,
		playerColor,
	)

	msg := fmt.Sprintf(statusMsg, level, score)
	fill(ui, mazeLeftPadding, len(data)+statusRowOffset, msg, coldef)

	// The caller decides how to react; the live renderer only reports whether the player reached the goal.
	return slices.Equal(startPos[:], targetPos[:])
}

// renderOverlayScene clears the center panel area and draws the pause or game-over content.
func renderOverlayScene(ui UI, level, score int, data [][]string, overlay *UIOverlay) {
	xAxis := mazeWidth(data) / overlayLeftDivisor

	type overlayLine struct {
		msg   string
		color termbox.Attribute
	}

	lines := []overlayLine{{
		msg:   overlay.Message,
		color: coldef,
	}}

	if overlay.ShowHighScore {
		lines = append(lines, overlayLine{
			msg:   fmt.Sprintf(highScores, level, score, overlay.ScorePercent),
			color: overlay.Color,
		})
	}

	if overlay.WinSummary != "" {
		lines = append(lines, overlayLine{
			msg:   overlay.WinSummary,
			color: overlay.Color,
		})
	}

	lines = append(lines, overlayLine{
		msg:   gameOverNavigation,
		color: coldef,
	})

	// Clear one spacer row above the first overlay line, one between each line, and one below the last.
	for spacerIndex := 0; spacerIndex <= len(lines); spacerIndex++ {
		yAxis := len(data)/2 + overlayRowMessage - 1 + spacerIndex*overlayRowSpacing
		fill(ui, xAxis, yAxis, space, coldef)
	}

	for index, line := range lines {
		fill(ui, xAxis, len(data)/2+overlayRowMessage+(index*overlayRowSpacing), line.msg, line.color)
	}
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
