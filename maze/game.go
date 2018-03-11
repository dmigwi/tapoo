package maze

import (
	"fmt"
	"os"
	"reflect"
	"strconv"
	"strings"
	"time"

	termbox "github.com/nsf/termbox-go"
)

// coldef maintains the original color used on the
// background or the foreground depending on its usage.
const coldef = termbox.ColorDefault

const (
	succeeded = iota
	proceed
	failed
	quit
)

var (
	scores              int
	startPos, targetPos []int

	status = make(chan int)
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

	fill(len(data[1])/2, len(data)+8, "Press ESC or Ctrl+C to quit.         Scores: "+strconv.Itoa(count), coldef)

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

// playerMovement calculates the actual player position
// depending on the navigation keys pressed.
func playerMovement(config *Dimensions, data [][]string, direction string) {
	var xVal, zVal = startPos[1], startPos[0]

	switch direction {
	case "LEFT":
		if (xVal-2) > 0 && strings.Contains(data[zVal][xVal-1], " ") {
			startPos[1] = xVal - 2
		}
	case "RIGHT":
		if (xVal+2) <= config.Length*2 && strings.Contains(data[zVal][xVal+1], " ") {
			startPos[1] = xVal + 2
		}
	case "UP":
		if (zVal-2) > 0 && strings.Contains(data[zVal-1][xVal], " ") {
			startPos[0] = zVal - 2
		}
	case "DOWN":
		if (zVal+2) <= config.Width*2 && strings.Contains(data[zVal+1][xVal], " ") {
			startPos[0] = zVal + 2
		}
	}
}

// handlePlayerMovement detects that keys pressed on the keyboard
// and provides that direction that the player should move to.
func handlePlayerMovement(config *Dimensions, data [][]string) {
	for {
		switch ev := termbox.PollEvent(); ev.Type {
		case termbox.EventKey:

			switch ev.Key {
			case termbox.KeyEsc, termbox.KeyCtrlC:
				status <- quit

			case termbox.KeyCtrlP:
				status <- proceed

			case termbox.KeyArrowLeft:
				playerMovement(config, data, "LEFT")

			case termbox.KeyArrowRight:
				playerMovement(config, data, "RIGHT")

			case termbox.KeyArrowUp:
				playerMovement(config, data, "UP")

			case termbox.KeyArrowDown:
				playerMovement(config, data, "DOWN")
			}
		case termbox.EventError:
			panic(ev.Err)
		}
	}
}

// Start define where the tapoo game starts at.
func Start() {
	var (
		data [][]string

		// If an error is thrown print it and exit
		errfunc = func(err error) {
			if err != nil {
				fmt.Println(err)
				os.Exit(1)
			}
		}
	)

	errfunc(termbox.Init())

	defer termbox.Close()
	termbox.SetInputMode(termbox.InputEsc)

	val, err := getMazeDimensions(1, getTerminalSize(termbox.Size()))
	errfunc(err)

	data, startPos, targetPos, err = val.GenerateMaze(1)
	errfunc(err)

	go handlePlayerMovement(val, data)

	var (
		timer       = time.NewTicker(500 * time.Microsecond)
		totalCells  = val.Length * val.Width
		timeout     = time.NewTimer(time.Duration(totalCells) * time.Second)
		currentTime = time.Now().Unix()
	)

mainloop:
	for {
		select {
		case timeVal := <-timer.C:
			scores = (totalCells - int(timeVal.Unix()-currentTime)) * 100

			refreshUI(val, scores, data)
		case <-timeout.C:
			go func() { status <- failed }()

		case returnedStatus := <-status:
			timer.Stop()
			timeout.Stop()
			switch returnedStatus {
			case succeeded:
				gameOverUI("You won after locating the target on time. ", val, data, termbox.ColorGreen)
			case failed:
				gameOverUI("You failed to locate the target on time. ", val, data, termbox.ColorRed)
			case quit:
				break mainloop
			case proceed:
			}
		}
	}
}
