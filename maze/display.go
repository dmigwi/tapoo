package maze

import (
	"reflect"
	"strconv"
	"strings"

	termbox "github.com/nsf/termbox-go"
)

// fill prints a string to the termbox view box on the given coordinates.
func fill(x, y int, val string, foreground termbox.Attribute) {
	for index, char := range val {
		termbox.SetCell(x+index, y, char, foreground, coldef)
	}
}

// drawMaze draws the maze on the termbox view.
func drawMaze(config *Dimensions, data [][]string) {
	var err = termbox.Clear(coldef, coldef)
	if err != nil {
		panic(err)
	}

	fill(len(data[1])/3, 1, "You are playing the Maze runner, hide and seek game (Tapoo).", coldef)
	fill(len(data[1])/2, 3, "Visit www.tapoo.com for more information.", coldef)
	fill(len(data[1])/2, 5, "Use the Arrow Keys to navigate the player (in green)", coldef)

	for k, d := range data {
		fill(3, 7+k, strings.Join(d, ""), coldef)
	}
}

// refreshUI refreshes the scores value and update the player positions.
func refreshUI(config *Dimensions, count int, data [][]string) {
	drawMaze(config, data)

	termbox.SetCell((targetPos[1]*2)+3, targetPos[0]+7, '#', termbox.ColorRed, termbox.ColorRed)
	termbox.SetCell((startPos[1]*2)+3, startPos[0]+7, '@', termbox.ColorGreen, termbox.ColorGreen)

	fill(len(data[1])/2, len(data)+8, "Press Space to pause.         Scores: "+strconv.Itoa(count), coldef)

	// check if target has been located
	go func() {
		if reflect.DeepEqual(startPos, targetPos) {
			status <- succeeded
		}
	}()

	termbox.Flush()
}

// gameOverUI displays some text indicating the game is
// over after a user won or lost a given tapoo game level.
func gameOverUI(msg string, config *Dimensions, data [][]string, color termbox.Attribute) {
	drawMaze(config, data)

	fill(len(data[1])/3, len(data)/2+3, "                                                         ", coldef)
	fill(len(data[1])/3, len(data)/2+4, "    Game Over! : "+msg, color)
	fill(len(data[1])/3, len(data)/2+5, "                                                         ", coldef)
	fill(len(data[1])/3, len(data)/2+6, "              High Scores: "+strconv.Itoa(scores)+"                        ", color)
	fill(len(data[1])/3, len(data)/2+7, "                                                         ", coldef)
	fill(len(data[1])/3, len(data)/2+8, "     Press ESC or Ctrl+C to quit.     Press Ctrl+P to Proceed       ", coldef)
	fill(len(data[1])/3, len(data)/2+9, "                                                           ", coldef)

	termbox.Flush()
}
