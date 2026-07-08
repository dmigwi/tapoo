package maze

import (
	"time"

	termbox "github.com/nsf/termbox-go"
)

// coldef maintains the original color used on the
// background or the foreground depending on its usage.
const coldef = termbox.ColorDefault

const (
	// Maze cells are rendered on a doubled grid so walls and passages can occupy separate slots.

	cellSpan      = 2
	cellPathWidth = 3
)

const (
	// These values drive movement timing, score decay, and edge detection in the runtime loop.

	moveStep              = 2
	scoreMultiplier       = 100
	refreshInterval       = 50 * time.Millisecond
	quitNavigationStatus  = 0
	mazeEdgeNeighborCount = 4
)

const (
	// Layout constants keep the termbox overlay aligned with the maze grid.

	mazeLeftPadding     = 3
	mazeTopPadding      = 7
	screenTitleDivisor  = 3
	overlayLeftDivisor  = 4
	scoreRowOffset      = 6
	playerMarkerOffset  = 3
	statusRowOffset     = 8
	overlayClearRowOne  = 3
	overlayClearRowTwo  = 5
	overlayClearRowTree = 7
	overlayClearRowFour = 9
	messageRowIntro     = 1
	messageRowWebsite   = 3
	messageRowControls  = 5
	overlayRowMessage   = 4
	overlayRowScore     = 6
	overlayRowNavigate  = 8
)

const (
	// UI strings are centralized so the display code can focus on placement rather than content.
	intro            = "   You are playing the Maze runner, hide and seek game (Tapoo).      "
	website          = " Visit https://www.linkedin.com/in/migwi-ndungu/ to contact the developer.  "
	playerNavigation = "      Use the Arrow Keys to navigate the player (in Blue)           "
	statusMsg        = "         Press Space to Pause.         Scores: %d            "

	space              = "                                                                         "
	pauseMsg           = "                              Game Paused !!!                            "
	gameOverSucceed    = "    Game Over! : Congratulations, Won by Locating the target on time.    "
	gameOverFailed     = "      Game Over! : Ooops!!!, Failed to locate the target on time.        "
	gameOverNavigation = "        Press ESC or Ctrl+C to quit.     Press Ctrl+P to Proceed         "
	highScores         = "                   High Scores: %d                             "
)

// seed defines the size of the maze to be used in the training level (level 0).
// It can also be referred to as the size of the training field.
const seed = 100

// diff defines the difference between maze sizes in consecutive game levels.
const diff = 10

const (
	// Terminal measurements are converted into maze cell counts with these scaling values.

	minMazeDimension    = 5
	terminalHeightInset = 5
	terminalHeightScale = 4
	terminalWidthInset  = 10
	terminalWidthScale  = 2
)

// maxLevel defines the maximum level that can be played in this game.
// Due to the large size of the maze at the final level, it might never be reached especially
// for users with smaller screen sizes.
const maxLevel = 290

const (
	// StatusProceed should be updated if the player wants to continue playing the game after:
	// 1. They paused the game.
	// 2. They successfully located the target on time and would like to play the next level.
	// 3. They failed to locate on time and would like to play the level again.
	StatusProceed = iota + 1

	// StatusFailed is updated after the player fails to locate the target on time.
	StatusFailed

	// StatusPause is updated after the player voluntarily stops the game.
	StatusPause

	// StatusQuit is updated after the player exits after pausing, winning, or failing a level.
	StatusQuit
)
