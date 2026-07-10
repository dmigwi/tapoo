package maze

import (
	"fmt"
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
	minPlayableMazeCells  = 2
	scoreMultiplier       = 100
	percentScale          = 100
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
	playerNavigation = " Use the Arrow Keys to navigate the player (in Blue). Press Ctrl+B to change walls thickness. "
	statusMsg        = "   Press Space to Pause.   Press Ctrl+B to Change Walls.   Level: %d   Scores: %d   "

	space              = "                                                                         "
	pauseMsg           = "                              Game Paused !!!                            "
	gameOverSucceed    = "    Game Over! Congratulations, You won by locating the target on time.  "
	gameOverFailed     = "      Game Over! Ooops!!!, You failed to locate the target on time.      "
	gameOverNavigation = "        Press ESC or Ctrl+C to quit.     Press Ctrl+P to Proceed         "
	highScores         = "                   Final Game Level Scores: %d                           "

	// playerMarker is the glyph used to show the current player position inside the maze.
	playerMarker = '▓'

	// goalMarker is the glyph used to mark the target cell the player is trying to reach.
	goalMarker = '█'
)

// storeFileName is the production runtime state file written beside the launched command.
const storeFileName = ".tapoo.store"

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
const maxLevel = 300

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

	// StatusCycleWallWeight is updated after the player requests a heavier wall style.
	StatusCycleWallWeight

	// StatusQuit is updated after the player exits after pausing, winning, or failing a level.
	StatusQuit
)

// WallWeight defines the visual weight of maze wall glyphs.
// The zero value selects the default regular wall set.
type WallWeight int

const (
	WallWeightRegular WallWeight = iota
	WallWeightMedium
	WallWeightBold
)

// IsValid reports whether the wall weight is one of the supported render styles.
func (weight WallWeight) IsValid() bool {
	switch weight {
	case WallWeightRegular, WallWeightMedium, WallWeightBold:
		return true
	default:
		return false
	}
}

// Next returns the next supported wall weight value and wraps back to regular after bold.
func (weight WallWeight) Next() WallWeight {
	temp := weight + 1
	if temp.IsValid() {
		return temp
	}
	return WallWeightRegular
}

// String returns the stable name used for the wall weight value.
func (weight WallWeight) String() string {
	switch weight {
	case WallWeightRegular:
		return "Regular wall weight"
	case WallWeightMedium:
		return "Medium wall weight"
	case WallWeightBold:
		return "Bold wall weight"
	default:
		return fmt.Sprintf("WallWeight(%d)", weight)
	}
}

// direction identifies the cell-to-cell travel direction used while tracking
// straight corridor runs and turn decisions during maze generation.
type direction int

const (
	// directionNone records the absence of a prior move, which only happens at the starting cell.
	directionNone direction = iota

	// directionUp records a move into the cell directly above the current one.
	directionUp

	// directionDown records a move into the cell directly below the current one.
	directionDown

	// directionLeft records a move into the cell directly to the left.
	directionLeft

	// directionRight records a move into the cell directly to the right.
	directionRight
)

// NavigationProfile tunes how maze generation manages corridor length as the maze grows.
// Smaller mazes can tolerate more frequent turns, while larger mazes need slightly longer
// straight runs so navigation stays challenging without becoming exhausting.
type NavigationProfile struct {
	// SoftCorridorLimit is the straight-run length after which turns should become preferred.
	SoftCorridorLimit int

	// HardCorridorLimit is the straight-run length that should rarely be exceeded when a turn exists.
	HardCorridorLimit int

	// PreferTurnPercent controls how often a turn should win over continuing straight when both are valid.
	PreferTurnPercent int
}

// GetNavigationProfile returns the corridor-management profile derived from the
// provided maze dimensions. It shapes how quickly the generator should break up
// long straight passages without changing the separate maze-area progression rules.
func GetNavigationProfile(config Dimensions) NavigationProfile {
	type navigationProfileBand struct {
		maxArea int
		profile NavigationProfile
	}

	//nolint:mnd // Tuned corridor-length bands used to keep maze generation readable and challenging.
	bands := [...]navigationProfileBand{
		{maxArea: 180, profile: NavigationProfile{SoftCorridorLimit: 2, HardCorridorLimit: 3, PreferTurnPercent: 80}},
		{maxArea: 300, profile: NavigationProfile{SoftCorridorLimit: 3, HardCorridorLimit: 4, PreferTurnPercent: 70}},
		{maxArea: 450, profile: NavigationProfile{SoftCorridorLimit: 4, HardCorridorLimit: 5, PreferTurnPercent: 60}},
		{maxArea: 600, profile: NavigationProfile{SoftCorridorLimit: 5, HardCorridorLimit: 6, PreferTurnPercent: 50}},
		{maxArea: 1000, profile: NavigationProfile{SoftCorridorLimit: 5, HardCorridorLimit: 7, PreferTurnPercent: 45}},
		{maxArea: 1600, profile: NavigationProfile{SoftCorridorLimit: 6, HardCorridorLimit: 7, PreferTurnPercent: 40}},
		{
			maxArea: (maxLevel * diff) + seed,
			profile: NavigationProfile{SoftCorridorLimit: 6, HardCorridorLimit: 8, PreferTurnPercent: 35},
		},
	}

	area := config.Length * config.Width
	for _, band := range bands {
		if area <= band.maxArea {
			return band.profile
		}
	}
	return bands[len(bands)-1].profile
}
