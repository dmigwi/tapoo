package maze

import (
	"fmt"
	"sync"
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
	nextLevel  int
	persisted  StoredGameState
	overlay    *UIOverlay
	store      *Store
}

// runtimeMaze keeps the active maze data synchronized between the event loop and the keyboard goroutine.
type runtimeMaze struct {
	mu   sync.RWMutex
	data [][]string
}

// newRuntimeMaze stores the initial maze data that player movement checks against.
func newRuntimeMaze(data [][]string) *runtimeMaze {
	return &runtimeMaze{data: data}
}

// Data returns the current maze snapshot used for traversability checks.
func (mazeData *runtimeMaze) Data() [][]string {
	mazeData.mu.RLock()
	defer mazeData.mu.RUnlock()

	return mazeData.data
}

// SetData swaps in a new maze snapshot after level reloads or wall-weight changes.
func (mazeData *runtimeMaze) SetData(data [][]string) {
	mazeData.mu.Lock()
	defer mazeData.mu.Unlock()

	mazeData.data = data
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

	// Ctrl+B does not move the player; it asks the game loop to cycle the current wall style.
	if event == termbox.KeyCtrlB {
		return StatusCycleWallWeight, true
	}

	// Arrow keys mutate the stored player position immediately when the destination cell is traversable.
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

	// Unhandled keys are ignored so they do not interrupt gameplay or trigger redraw side effects.
	return 0, false
}

// handleKeyboardMapping handles all the keyboard input as captured by termbox.
func (config *Dimensions) handleKeyboardMapping(ui UI, mazeData *runtimeMaze,
	statusCh chan<- int, done <-chan struct{}) error {
	for {
		ev := ui.PollEvent()
		if ev.Type == termbox.EventKey {
			// Arrow keys mutate player state directly; control keys are converted into higher-level statuses.
			if gameStatus, ok := config.HandlePlayerMovement(ev.Key, mazeData.Data()); ok {
				select {
				case statusCh <- gameStatus:
				case <-done:
					return nil
				}
			}
			continue
		}

		if ev.Type == termbox.EventInterrupt {
			select {
			case <-done:
				return nil
			default:
				continue
			}
		}

		if ev.Type == termbox.EventError {
			select {
			case <-done:
				return nil
			default:
				return ev.Err
			}
		}
	}
}

// Start defines where the tapoo game starts at.
func Start() error {
	return StartWithUI(NewTermboxUI(storeFileName))
}

// StartWithUI bootstraps a generated maze level on the provided UI implementation.
func StartWithUI(ui UI) error {
	if err := ui.Init(); err != nil {
		return fmt.Errorf("initialize termbox: %w", err)
	}

	defer ui.Close()
	ui.SetInputMode(termbox.InputEsc)

	return PlayWithUI(ui)
}

// PlayWithUI loads the first level and runs the maze event loop using the provided UI.
func PlayWithUI(ui UI) error {
	persistedState := StoredGameState{
		Level:      1,
		WallWeight: WallWeightRegular,
		State:      GameProgressInProgress,
	}
	gameStore, errStore := NewStore(ui.StorePath())
	if errStore == nil {
		if storedState, errLoad := gameStore.Load(); errLoad == nil {
			persistedState = *storedState
			persistedState.Level = storedState.ResumeLevel()
			persistedState.State = GameProgressInProgress
		}
	}

	val, data, errGame := loadLevel(ui, persistedState.Level, persistedState.WallWeight)
	if errGame != nil {
		persistedState = StoredGameState{
			Level:      1,
			WallWeight: WallWeightRegular,
			State:      GameProgressInProgress,
		}

		val, data, errGame = loadLevel(ui, persistedState.Level, persistedState.WallWeight)
		if errGame != nil {
			return errGame
		}
	}
	return PlayPreparedGameWithStore(ui, val, data, persistedState, gameStore)
}

// PlayPreparedGameWithStore runs the prepared game loop using the provided persisted game state.
// Tests can call this directly with a prepared maze and storage snapshot without going through
// the level loader.
func PlayPreparedGameWithStore(
	ui UI, val *Dimensions, data [][]string, persistedState StoredGameState, gameStore *Store,
) error {
	mazeData := newRuntimeMaze(data)
	statusCh := make(chan int)
	errCh := make(chan error, 1)
	done := make(chan struct{})
	inputStopped := make(chan struct{})
	defer func() {
		close(done)
		ui.Interrupt()
		<-inputStopped
	}()

	go func() {
		defer close(inputStopped)
		errCh <- val.handleKeyboardMapping(ui, mazeData, statusCh, done)
	}()

	state := gameState{
		totalCells: val.Length * val.Width,
		scores:     val.Length * val.Width * scoreMultiplier,
		persisted:  persistedState,
		store:      gameStore,
	}

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
			exitGame, updatedData, err := state.handleStatus(ui, returnedStatus, val, data, timeout, &clock)
			if err != nil {
				return err
			}

			data = updatedData
			mazeData.SetData(data)

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

func (state *gameState) handleTick(
	ui UI, timeVal time.Time, clock *GameClock, val *Dimensions, data [][]string, timeout *time.Timer,
) error {
	if state.paused {
		return nil
	}

	// Scores decay by elapsed whole seconds, matching the timeout duration used for the level.
	state.scores = CalculateScore(state.totalCells, timeVal.Sub(clock.startedAt)-clock.pausedDuration)
	targetReached, errUI := RenderMazeUI(ui, val, state.persisted.Level, state.scores, data, nil)
	if errUI != nil {
		return fmt.Errorf("refresh ui: %w", errUI)
	}

	if !targetReached {
		return nil
	}

	stopTimer(timeout)
	state.overlay = &UIOverlay{
		Message:       gameOverSucceed,
		Color:         termbox.ColorCyan,
		ShowHighScore: true,
	}
	state.nextLevel = state.persisted.Level + 1
	state.persisted.State = GameProgressWon

	if _, err := RenderMazeUI(ui, nil, 0, state.scores, data, state.overlay); err != nil {
		return fmt.Errorf("show success screen: %w", err)
	}

	state.paused = true
	state.canResume = true
	state.persistProgress()
	return nil
}

func (state *gameState) handleTimeout(ui UI, data [][]string) error {
	state.overlay = &UIOverlay{
		Message:       gameOverFailed,
		Color:         termbox.ColorRed,
		ShowHighScore: true,
	}
	state.nextLevel = state.persisted.Level
	state.persisted.State = GameProgressFail

	if _, err := RenderMazeUI(ui, nil, 0, state.scores, data, state.overlay); err != nil {
		return fmt.Errorf("show failure screen: %w", err)
	}

	state.paused = true
	state.canResume = true
	state.persistProgress()
	return nil
}

// handleStatus processes non-movement game actions such as quit, pause, wall-style changes,
// and proceed requests after a pause or completed run. It returns whether the game loop should
// exit, plus the maze data that should remain active after the action.
func (state *gameState) handleStatus(
	ui UI, returnedStatus int, val *Dimensions, data [][]string, timeout *time.Timer, clock *GameClock,
) (bool, [][]string, error) {
	// Quit exits immediately and preserves whichever progress state was last established for this level.
	if returnedStatus == StatusQuit {
		state.persistProgress()
		return true, data, nil
	}

	// Ctrl+B only changes the wall glyph set; it leaves level progress, timers, and player state intact.
	if returnedStatus == StatusCycleWallWeight {
		updatedData, err := state.handleWallWeightCycle(data)
		if err != nil {
			return false, data, err
		}

		return false, updatedData, nil
	}

	// Ctrl+P serves two different flows:
	// 1. Resume a manually paused game when no overlay transition is pending.
	// 2. Load the next or current level after a win or fail overlay.
	if returnedStatus == StatusProceed {
		// Ignore proceed unless the game is currently in a resumable or reloadable paused state.
		if !state.paused || !state.canResume {
			return false, data, nil
		}

		// A non-nil overlay means the user is on a win/fail/pause screen rather than the live board.
		// Win and fail screens set nextLevel, so reloadLevel can decide whether to advance or retry.
		if state.overlay != nil {
			reloadedData, err := state.reloadLevel(ui, val, timeout, clock)
			if err != nil {
				return false, data, err
			}

			return false, reloadedData, nil
		}

		// Without an overlay, proceed simply resumes the current timed run from a manual pause.
		state.paused = false
		state.canResume = false
		state.overlay = nil
		clock.Resume()
		timeout.Reset(clock.Remaining())

		return false, data, nil
	}

	// Ignore duplicate pause requests and any unknown status values.
	if returnedStatus != StatusPause || state.paused {
		return false, data, nil
	}

	// A fresh pause freezes the timer, clears any pending level transition, and shows the pause overlay.
	state.paused = true
	state.canResume = true
	state.nextLevel = 0
	state.persisted.State = GameProgressInProgress
	state.overlay = &UIOverlay{
		Message:       pauseMsg,
		Color:         termbox.ColorYellow,
		ShowHighScore: false,
	}
	clock.Pause()
	stopTimer(timeout)

	if _, err := RenderMazeUI(ui, nil, 0, quitNavigationStatus, data, state.overlay); err != nil {
		return false, data, fmt.Errorf("show pause screen: %w", err)
	}

	state.persistProgress()
	return false, data, nil
}

// reloadLevel rebuilds the current or next level after a game-over proceed request.
func (state *gameState) reloadLevel(
	ui UI, val *Dimensions, timeout *time.Timer, clock *GameClock,
) ([][]string, error) {
	level := state.nextLevel
	nextConfig, nextData, errLevel := loadLevel(ui, level, state.persisted.WallWeight)
	if errLevel != nil {
		return nil, fmt.Errorf("reload level %d: %w", level, errLevel)
	}

	*val = *nextConfig
	state.persisted.Level = level
	state.nextLevel = 0
	state.paused = false
	state.canResume = false
	state.overlay = nil
	state.persisted.State = GameProgressInProgress
	state.totalCells = val.Length * val.Width
	state.scores = state.totalCells * scoreMultiplier
	*clock = NewGameClock(time.Duration(state.totalCells) * time.Second)
	stopTimer(timeout)
	timeout.Reset(clock.levelDuration)

	if _, err := RenderMazeUI(ui, val, state.persisted.Level, state.scores, nextData, nil); err != nil {
		return nil, fmt.Errorf("render reloaded level: %w", err)
	}

	state.persistProgress()
	return nextData, nil
}

// loadLevel creates a fresh maze for the requested level using the current wall-weight setting.
func loadLevel(ui UI, level int, weight WallWeight) (*Dimensions, [][]string, error) {
	val, err := GetMazeDimensions(level, GetTerminalSize(ui.Size()))
	if err != nil {
		return nil, nil, fmt.Errorf("get maze dimensions: %w", err)
	}

	data, err := val.GenerateMaze(weight)
	if err != nil {
		return nil, nil, fmt.Errorf("generate maze: %w", err)
	}

	return val, data, nil
}

// handleWallWeightCycle advances to the next wall weight and updates the maze data in place.
// The next scheduled refresh is responsible for rendering the updated wall glyphs.
func (state *gameState) handleWallWeightCycle(data [][]string) ([][]string, error) {
	updatedData, err := reweightMaze(data, state.persisted.WallWeight)
	if err != nil {
		return data, fmt.Errorf("update wall weight: %w", err)
	}

	state.persisted.WallWeight = state.persisted.WallWeight.Next()
	state.persistProgress()
	return updatedData, nil
}

// persistProgress stores the current level, wall weight, and progress state on a best-effort basis.
func (state *gameState) persistProgress() {
	if state.store == nil {
		return
	}
	_ = state.store.Save(state.persisted)
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
