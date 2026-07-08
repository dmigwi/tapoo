package maze

import (
	"fmt"
	"time"

	termbox "github.com/nsf/termbox-go"
)

// GameClock tracks elapsed and remaining time while accounting for pauses.
type GameClock struct {
	startedAt      time.Time
	pausedAt       time.Time
	pausedDuration time.Duration
	levelDuration  time.Duration
}

// gameState tracks the mutable runtime state that used to be kept in package globals.
type gameState struct {
	scores     int
	paused     bool
	canResume  bool
	totalCells int
}

// NewGameClock creates a new per-level clock using the provided duration budget.
func NewGameClock(levelDuration time.Duration) GameClock {
	return GameClock{
		startedAt:     time.Now(),
		levelDuration: levelDuration,
	}
}

// Elapsed subtracts paused time so scoring and timeout logic continue from the same point after resume.
func (clock *GameClock) Elapsed() time.Duration {
	return time.Since(clock.startedAt) - clock.pausedDuration
}

// Remaining clamps at zero because timers should never be reset with a negative duration.
func (clock *GameClock) Remaining() time.Duration {
	remaining := clock.levelDuration - clock.Elapsed()
	if remaining < 0 {
		return 0
	}

	return remaining
}

// Pause records when the clock stopped advancing.
func (clock *GameClock) Pause() {
	clock.pausedAt = time.Now()
}

// Resume accumulates the paused duration and resumes elapsed-time accounting.
func (clock *GameClock) Resume() {
	if clock.pausedAt.IsZero() {
		return
	}

	// Resume accumulates the paused span instead of shifting startedAt so elapsed math stays simple.
	clock.pausedDuration += time.Since(clock.pausedAt)
	clock.pausedAt = time.Time{}
}

// PlayerMovement calculates the actual player position
// depending on the navigation keys pressed.
func (config *Dimensions) PlayerMovement(data [][]string, direction string) {
	startPos := config.StartPosition
	xVal, zVal := startPos[1], startPos[0]

	switch {
	case direction == "LEFT" && (xVal-moveStep) > 0 && isSpaceFound(data[zVal][xVal-1]):
		config.StartPosition[1] = xVal - moveStep
	case direction == "RIGHT" && (xVal+moveStep) <= config.Length*cellSpan && isSpaceFound(data[zVal][xVal+1]):
		config.StartPosition[1] = xVal + moveStep
	case direction == "UP" && (zVal-moveStep) > 0 && isSpaceFound(data[zVal-1][xVal]):
		config.StartPosition[0] = zVal - moveStep
	case direction == "DOWN" && (zVal+moveStep) <= config.Width*cellSpan && isSpaceFound(data[zVal+1][xVal]):
		config.StartPosition[0] = zVal + moveStep
	}
}

// HandlePlayerMovement interprets keyboard input and updates the player position or returns a game status.
func (config *Dimensions) HandlePlayerMovement(event termbox.Key, data [][]string) (int, bool) {
	// Status-returning keys are separated from movement keys so callers can route game actions cleanly.
	if event == termbox.KeyEsc || event == termbox.KeyCtrlC {
		return StatusQuit, true
	}

	if event == termbox.KeyCtrlP {
		return StatusProceed, true
	}

	if event == termbox.KeySpace {
		return StatusPause, true
	}

	if event == termbox.KeyArrowLeft {
		config.PlayerMovement(data, "LEFT")
		return 0, false
	}

	if event == termbox.KeyArrowRight {
		config.PlayerMovement(data, "RIGHT")
		return 0, false
	}

	if event == termbox.KeyArrowUp {
		config.PlayerMovement(data, "UP")
		return 0, false
	}

	if event == termbox.KeyArrowDown {
		config.PlayerMovement(data, "DOWN")
		return 0, false
	}

	return 0, false
}

// handleKeyboardMapping handles all the keyboard input as captured by termbox.
func (config *Dimensions) handleKeyboardMapping(ui UI, data [][]string, statusCh chan<- int) error {
	for {
		ev := ui.PollEvent()
		if ev.Type == termbox.EventKey {
			// Arrow keys mutate player state directly; control keys are converted into higher-level statuses.
			if gameStatus, ok := config.HandlePlayerMovement(ev.Key, data); ok {
				statusCh <- gameStatus
			}
			continue
		}

		if ev.Type == termbox.EventError {
			return ev.Err
		}
	}
}

// Start defines where the tapoo game starts at.
func Start() error {
	return StartWithUI(TermboxUI{})
}

// StartWithUI bootstraps a generated maze level on the provided UI implementation.
func StartWithUI(ui UI) error {
	if err := ui.Init(); err != nil {
		return fmt.Errorf("initialize termbox: %w", err)
	}

	defer ui.Close()
	ui.SetInputMode(termbox.InputEsc)

	val, data, errGame := setupGame(ui)
	if errGame != nil {
		return errGame
	}

	return PlayWithUI(ui, val, data)
}

// PlayWithUI runs the maze event loop using a prepared maze and the provided UI.
func PlayWithUI(ui UI, val *Dimensions, data [][]string) error {
	statusCh := make(chan int)
	errCh := make(chan error, 1)
	go func() {
		errCh <- val.handleKeyboardMapping(ui, data, statusCh)
	}()

	state := gameState{totalCells: val.Length * val.Width}
	clock := NewGameClock(time.Duration(state.totalCells) * time.Second)
	ticker := time.NewTicker(refreshInterval)
	defer ticker.Stop()

	timeout := time.NewTimer(clock.levelDuration)
	defer timeout.Stop()

	for {
		select {
		case timeVal := <-ticker.C:
			// Rendering, score decay, and win detection all advance on the same heartbeat.
			if err := state.handleTick(ui, timeVal, &clock, val, data, timeout); err != nil {
				return err
			}
		case <-timeout.C:
			if err := state.handleTimeout(ui, data); err != nil {
				return err
			}
		case returnedStatus := <-statusCh:
			exitGame, err := state.handleStatus(ui, returnedStatus, data, timeout, &clock)
			if err != nil {
				return err
			}

			if exitGame {
				return nil
			}
		case err := <-errCh:
			if err != nil {
				return fmt.Errorf("read keyboard input: %w", err)
			}
		}
	}
}

// CalculateScore converts the remaining whole seconds into the current level score.
func CalculateScore(totalCells int, elapsed time.Duration) int {
	return (totalCells - int(elapsed.Seconds())) * scoreMultiplier
}

// setupGame keeps terminal bootstrap separate from the main event loop so Start reads top-down.
func setupGame(ui UI) (*Dimensions, [][]string, error) {
	val, err := GetMazeDimensions(1, GetTerminalSize(ui.Size()))
	if err != nil {
		return nil, nil, fmt.Errorf("get maze dimensions: %w", err)
	}

	data, err := val.GenerateMaze(1)
	if err != nil {
		return nil, nil, fmt.Errorf("generate maze: %w", err)
	}

	return val, data, nil
}

func (state *gameState) handleTick(
	ui UI, timeVal time.Time, clock *GameClock, val *Dimensions, data [][]string, timeout *time.Timer,
) error {
	if state.paused {
		return nil
	}

	// Scores decay by elapsed whole seconds, matching the timeout duration used for the level.
	state.scores = CalculateScore(state.totalCells, timeVal.Sub(clock.startedAt)-clock.pausedDuration)
	targetReached, errUI := RefreshUI(ui, val, state.scores, data)
	if errUI != nil {
		return fmt.Errorf("refresh ui: %w", errUI)
	}

	if !targetReached {
		return nil
	}

	stopTimer(timeout)
	if err := InterruptUI(ui, gameOverSucceed, data, termbox.ColorCyan, true, state.scores); err != nil {
		return fmt.Errorf("show success screen: %w", err)
	}

	state.paused = true
	state.canResume = false

	return nil
}

func (state *gameState) handleTimeout(ui UI, data [][]string) error {
	if err := InterruptUI(ui, gameOverFailed, data, termbox.ColorRed, true, state.scores); err != nil {
		return fmt.Errorf("show failure screen: %w", err)
	}

	state.paused = true
	state.canResume = false

	return nil
}

func (state *gameState) handleStatus(
	ui UI, returnedStatus int, data [][]string, timeout *time.Timer, clock *GameClock,
) (bool, error) {
	// Proceed is only meaningful after a manual pause; win/lose screens intentionally cannot resume.
	if returnedStatus == StatusQuit {
		return true, nil
	}

	if returnedStatus == StatusProceed {
		if !state.paused || !state.canResume {
			return false, nil
		}

		state.paused = false
		state.canResume = false
		clock.Resume()
		timeout.Reset(clock.Remaining())

		return false, nil
	}

	if returnedStatus != StatusPause || state.paused {
		return false, nil
	}

	state.paused = true
	state.canResume = true
	clock.Pause()
	stopTimer(timeout)

	if err := InterruptUI(ui, pauseMsg, data, termbox.ColorYellow, false, quitNavigationStatus); err != nil {
		return false, fmt.Errorf("show pause screen: %w", err)
	}

	return false, nil
}

func stopTimer(timer *time.Timer) {
	if !timer.Stop() {
		// Drain the channel when Stop reports false so future Reset calls do not race a stale tick.
		select {
		case <-timer.C:
		default:
		}
	}
}
