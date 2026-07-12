package maze

import (
	"fmt"
	"math"
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
	goalBlinkInterval     = time.Second
	goalBlinkOnDuration   = goalBlinkInterval / 2
	refreshInterval       = 250 * time.Millisecond
	quitNavigationStatus  = 0
	mazeEdgeNeighborCount = 4
)

// RefreshInterval is the shared UI redraw cadence used by the runtime loop and timing-sensitive tests.
const RefreshInterval = refreshInterval

const (
	// Layout constants keep the termbox overlay aligned with the maze grid.

	mazeLeftPadding    = 3
	mazeTopPadding     = 7
	screenTitleDivisor = 3
	overlayLeftDivisor = 4
	scoreRowOffset     = 6
	statusRowOffset    = 8
	messageRowIntro    = 1
	messageRowWebsite  = 3
	messageRowControls = 5
	overlayRowMessage  = 4
	overlayRowSpacing  = 2
)

type winSummaryPreviousComparison int

const (
	winSummaryPreviousNone winSummaryPreviousComparison = iota
	winSummaryPreviousFaster
	winSummaryPreviousSlower
	winSummaryPreviousMatched
)

type winSummaryBestComparison int

const (
	winSummaryBestNewRecord winSummaryBestComparison = iota
	winSummaryBestMatched
	winSummaryBestBehind
)

const (
	// UI strings are centralized so the display code can focus on placement rather than content.
	introFormat      = "   You are playing the Maze runner, hide and seek game (Tapoo %s).      "
	website          = " Visit https://www.linkedin.com/in/migwi-ndungu/ to contact the developer.  "
	playerNavigation = " Use Arrow Keys to guide Blue (Player) to Red. Ctrl+B changes walls. "
	statusMsg        = "   Press Space to Pause.   Press Ctrl+B to Change Walls.   Level: %d   Scores: %d   "

	space              = "                                                                         "
	pauseMsg           = "                             Game Paused !!!                             "
	gameOverSucceed    = "   Game Over! Congratulations, You won by locating the target on time.   "
	gameOverFailed     = "      Game Over! Ooops!!!, You failed to locate the target on time.      "
	gameOverNavigation = "        Press ESC or Ctrl+C to quit.     Press Ctrl+P to Proceed         "
	tooSmallMazeFormat = "   level %d needs more screen room; enlarge the window to keep playing   "

	highScores               = "               Final Level %d Scores:  %d (%d%% retention)               "
	winNoPrevNewRecord       = "               New scores retention record                               "
	winNoPrevMatchedBest     = "               Matched best scores retention                             "
	winNoPrevBehindBest      = "               %s behind best scores retention                           "
	winFasterPrevNewRecord   = "               %s faster than previous (new record)                      "
	winFasterPrevMatchedBest = "               %s faster than previous (matched best)                    "
	winFasterPrevBehindBest  = "               %s faster than previous (%s behind best)                  "
	winSlowerPrevNewRecord   = "               %s slower than previous (new record)                      "
	winSlowerPrevMatchedBest = "               %s slower than previous (matched best)                    "
	winSlowerPrevBehindBest  = "               %s slower than previous (%s behind best)                  "
	winMatchedPrevNewRecord  = "               Matched previous (new record)                             "
	winMatchedPrevBest       = "               Matched previous (matched best)                           "
	winMatchedPrevBehindBest = "               Matched previous (%s behind best)                         "

	// playerMarker is the glyph used to show the current player position inside the maze.
	playerMarker = '▓'

	// goalMarker is the glyph used to mark the target cell the player is trying to reach.
	goalMarker = '█'
)

const (
	// storeFileName is the production runtime state file written beside the launched command.
	storeFileName = ".tapoo.store"

	// storeEncodingPrefix marks payloads that were encoded with the shared password-based store format.
	storeEncodingPrefix = "tapoo:v2:"

	// storeBlendKey keeps the persisted payload format aligned with the companion runtime
	// while still depending on the exact multi-line token shape.
	storeBlendKey = `tapoo:maze/vault
		key|go.persist`
)

// seed defines the size of the maze to be used in the training level (level 0).
// It can also be referred to as the size of the training field.
const seed = 60

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

const (
	// Navigation difficulty starts from the welcoming profile through this area, then ramps
	// smoothly until the hardest profile is reached at the max tuned area.
	navigationFriendlyMaxArea = 130
	navigationHardestArea     = 1600

	// These fallback values keep very large mazes on the tightest corridor profile.
	navigationFallbackSoftCorridorLimit = 2
	navigationFallbackHardCorridorLimit = 3
	navigationFallbackPreferTurnPercent = 55

	navigationFriendlySoftCorridorLimit = 8
	navigationFriendlyHardCorridorLimit = 10
	navigationFriendlyPreferTurnPercent = 90
)

// NavigationProfile tunes how maze generation manages corridor length as the maze grows.
// Early levels stay more welcoming by allowing longer straight corridors, while later levels
// tighten those limits so navigation becomes denser and harder to read at a glance.
type NavigationProfile struct {
	// SoftCorridorLimit is the straight-run length after which turns should become preferred.
	SoftCorridorLimit int

	// HardCorridorLimit is the straight-run length that should rarely be exceeded when a turn exists.
	HardCorridorLimit int

	// PreferTurnPercent controls how often a turn should win over continuing straight when both are valid.
	PreferTurnPercent int
}

// GetNavigationProfile returns the corridor-management profile derived from the
// provided maze dimensions. The first few levels intentionally allow longer
// straights so the maze feels approachable, then the profile gradually clamps
// corridor length until the largest mazes use the hardest supported settings.
func GetNavigationProfile(config Dimensions) NavigationProfile {
	area := config.Length * config.Width

	// Area growth compounds navigation density quickly, so the square-root curve tightens
	// corridors faster than a plain linear interpolation while still staying smooth.
	difficultyFactor := navigationDifficultyFactor(area)
	return NavigationProfile{
		SoftCorridorLimit: interpolateNavigationValue(
			navigationFriendlySoftCorridorLimit,
			navigationFallbackSoftCorridorLimit,
			difficultyFactor,
		),
		HardCorridorLimit: interpolateNavigationValue(
			navigationFriendlyHardCorridorLimit,
			navigationFallbackHardCorridorLimit,
			difficultyFactor,
		),
		PreferTurnPercent: interpolateNavigationValue(
			navigationFriendlyPreferTurnPercent,
			navigationFallbackPreferTurnPercent,
			difficultyFactor,
		),
	}
}

// navigationDifficultyFactor maps maze area into a normalized difficulty value
// between 0 and 1. Areas up to the welcoming threshold stay at 0, areas at or
// beyond the hardest threshold clamp to 1, and the square-root curve in between
// tightens difficulty smoothly while ramping it up faster than a plain linear scale.
func navigationDifficultyFactor(area int) float64 {
	if area <= navigationFriendlyMaxArea {
		return 0
	}

	if area >= navigationHardestArea {
		return 1
	}

	normalizedArea := float64(area-navigationFriendlyMaxArea) /
		float64(navigationHardestArea-navigationFriendlyMaxArea)

	return math.Sqrt(normalizedArea)
}

// interpolateNavigationValue linearly blends one profile setting from the
// welcoming value to the hardest value using the normalized difficulty factor.
// A difficulty of 0 returns the friendly value, 1 returns the hardest value,
// and values in between are rounded to the nearest supported integer.
func interpolateNavigationValue(friendly, hardest int, difficultyFactor float64) int {
	return int(math.Round(float64(friendly) + float64(hardest-friendly)*difficultyFactor))
}
