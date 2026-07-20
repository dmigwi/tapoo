package maze

import (
	"fmt"
	"math"
	"sync"
	"time"

	termbox "github.com/nsf/termbox-go"
)

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

// keyboardSession keeps the keyboard goroutine wiring together so the main loop
// can focus on gameplay rather than channel lifecycle management.
type keyboardSession struct {
	mazeData     *runtimeMaze
	statusCh     chan int
	errCh        chan error
	done         chan struct{}
	inputStopped chan struct{}
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

// newKeyboardSession starts the polling goroutine used by the gameplay loop.
func newKeyboardSession(ui UI, val *Dimensions, data [][]string) *keyboardSession {
	session := &keyboardSession{
		mazeData:     newRuntimeMaze(data),
		statusCh:     make(chan int),
		errCh:        make(chan error, 1),
		done:         make(chan struct{}),
		inputStopped: make(chan struct{}),
	}

	go func() {
		defer close(session.inputStopped)
		session.errCh <- val.handleKeyboardMapping(ui, session.mazeData, session.statusCh, session.done)
	}()

	return session
}

// Close stops the keyboard goroutine and waits for it to exit cleanly.
func (session *keyboardSession) Close(ui UI) {
	close(session.done)
	ui.Interrupt()
	<-session.inputStopped
}

// PlayerMovement updates the player coordinates using the supplied row and column deltas.
// The move only succeeds when the intermediate passage slot between maze cells is traversable.
func (config *Dimensions) PlayerMovement(data [][]string, rowDelta, columnDelta int) (int, bool) {
	startPos := config.StartPosition
	currentColumn, currentRow := startPos[1], startPos[0]
	nextRow := currentRow + rowDelta*moveStep
	nextColumn := currentColumn + columnDelta*moveStep
	probeRow := currentRow + rowDelta
	probeColumn := currentColumn + columnDelta

	if nextRow <= 0 || nextRow > config.Width*cellSpan {
		return 0, false
	}

	if nextColumn <= 0 || nextColumn > config.Length*cellSpan {
		return 0, false
	}

	if !isSpaceFound(data[probeRow][probeColumn]) {
		return 0, false
	}

	config.StartPosition[0] = nextRow
	config.StartPosition[1] = nextColumn
	return 0, false
}

// HandlePlayerMovement interprets keyboard input and updates the player position or returns a game status.
func (config *Dimensions) HandlePlayerMovement(event termbox.Key, data [][]string) (int, bool) {
	// Status-returning keys are separated from movement keys so callers can route game actions cleanly.
	if event == termbox.KeyCtrlC {
		return StatusQuit, true
	}

	if event == termbox.KeyEnter {
		return StatusProceed, true
	}

	if event == termbox.KeySpace || event == termbox.KeyEsc {
		return StatusPause, true
	}

	// Ctrl+B does not move the player; it asks the game loop to cycle the current wall style.
	if event == termbox.KeyCtrlB {
		return StatusCycleWallWeight, true
	}

	// Negative column delta moves the player one maze cell to the left.
	if event == termbox.KeyArrowLeft {
		return config.PlayerMovement(data, 0, -1)
	}

	// Positive column delta moves the player one maze cell to the right.
	if event == termbox.KeyArrowRight {
		return config.PlayerMovement(data, 0, 1)
	}

	// Negative row delta moves the player one maze cell upward.
	if event == termbox.KeyArrowUp {
		return config.PlayerMovement(data, -1, 0)
	}

	// Positive row delta moves the player one maze cell downward.
	if event == termbox.KeyArrowDown {
		return config.PlayerMovement(data, 1, 0)
	}

	// All other keys are ignored so they do not interrupt gameplay or trigger redraw side effects.
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

// Start bootstraps the production termbox UI using the provided Go runtime version.
func Start(version string) error {
	return StartWithUI(NewTermboxUI(storeFileName, version))
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
	keyboard := newKeyboardSession(ui, val, data)
	defer keyboard.Close(ui)

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

	// Render the current maze state immediately so restored sessions and trivial win states
	// do not wait for the first refresh tick before becoming visible.
	if err := renderPreparedGameStart(ui, &state, &clock, val, data, timeout); err != nil {
		return err
	}

	return runPreparedGameLoop(ui, &state, &clock, val, data, keyboard, ticker, timeout)
}

// renderPreparedGameStart draws the first visible frame for playable mazes before the
// regular refresh ticker begins advancing the level.
func renderPreparedGameStart(
	ui UI, state *gameState, clock *GameClock, val *Dimensions, data [][]string, timeout *time.Timer,
) error {
	if val.Length <= 0 || val.Width <= 0 {
		return nil
	}

	return state.handleTick(ui, time.Now(), clock, val, data, timeout)
}

// runPreparedGameLoop coordinates timer ticks, status signals, and keyboard errors until the game exits.
func runPreparedGameLoop(
	ui UI, state *gameState, clock *GameClock, val *Dimensions, data [][]string, keyboard *keyboardSession,
	ticker *time.Ticker, timeout *time.Timer,
) error {
	for {
		updatedData, exitGame, err := handlePreparedGameEvent(
			ui, state, clock, val, data, keyboard, ticker, timeout,
		)
		if err != nil {
			return err
		}

		data = updatedData
		keyboard.mazeData.SetData(data)

		if exitGame {
			return nil
		}
	}
}

// handlePreparedGameEvent processes one signal from the runtime loop and reports the next maze snapshot.
func handlePreparedGameEvent(
	ui UI, state *gameState, clock *GameClock, val *Dimensions, data [][]string, keyboard *keyboardSession,
	ticker *time.Ticker, timeout *time.Timer,
) ([][]string, bool, error) {
	select {
	case timeVal := <-ticker.C:
		// Rendering, score decay, and win detection all advance on the same heartbeat.
		err := state.handleTick(ui, timeVal, clock, val, data, timeout)
		return data, false, err
	case <-timeout.C:
		err := state.handleTimeout(ui, data)
		return data, false, err
	case returnedStatus := <-keyboard.statusCh:
		exitGame, updatedData, err := state.handleStatus(ui, returnedStatus, val, data, timeout, clock)
		if err != nil {
			return data, false, err
		}

		return updatedData, exitGame, nil
	case err := <-keyboard.errCh:
		if err != nil {
			return data, false, fmt.Errorf("read keyboard input: %w", err)
		}
		return data, false, nil
	}
}

// CalculateScore converts the elapsed level time into a smoothly decaying score.
func CalculateScore(totalCells int, elapsed time.Duration) int {
	maxScore := totalCells * scoreMultiplier
	elapsedPenalty := int(elapsed/time.Millisecond) * scoreMultiplier / int(time.Second/time.Millisecond)
	score := maxScore - elapsedPenalty
	if score < 0 {
		return 0
	}

	return score
}

// CalculateScorePercent converts the preserved level score into a whole-number percentage.
func CalculateScorePercent(totalCells, score int) int {
	maxScore := totalCells * scoreMultiplier
	if maxScore <= 0 {
		return 0
	}

	percent := (score*percentScale + maxScore/roundingDivisor) / maxScore
	if percent < 0 {
		return 0
	}

	if percent > percentScale {
		return percentScale
	}

	return percent
}

// CalculateScoreRetention converts the preserved level score into a normalized fixed-point retention value.
func CalculateScoreRetention(totalCells, score int) uint32 {
	maxScore := totalCells * scoreMultiplier
	if maxScore <= 0 {
		return 0
	}

	retention := (int64(score)*retentionScale + int64(maxScore/roundingDivisor)) / int64(maxScore)
	if retention < 0 {
		return 0
	}

	if retention > retentionScale {
		return retentionScale
	}

	return uint32(retention)
}

// BuildWinSummary formats the retention comparison against the stored previous attempt and best win,
// then converts those normalized deltas back into time using the current level duration.
func BuildWinSummary(current uint32, lastAttempt, best *uint32, levelDuration time.Duration) string {
	// Compare the current clear against the previous attempt and the best clear independently,
	// then let the template selector combine those states into one display string.
	previousCmp, previousDelta := compareWinSummaryPrevious(current, lastAttempt, levelDuration)
	bestCmp, bestDelta := compareWinSummaryBest(current, best, levelDuration)
	template := selectWinSummaryTemplate(previousCmp, bestCmp)

	switch previousCmp {
	case winSummaryPreviousNone:
		// First stored wins never mention a previous attempt, so only the best delta can be injected.
		if bestCmp == winSummaryBestBehind {
			return fmt.Sprintf(template, bestDelta)
		}
		return template
	case winSummaryPreviousFaster, winSummaryPreviousSlower:
		// Faster/slower templates always carry the previous-attempt delta and optionally the best delta too.
		if bestCmp == winSummaryBestBehind {
			return fmt.Sprintf(template, previousDelta, bestDelta)
		}
		return fmt.Sprintf(template, previousDelta)
	case winSummaryPreviousMatched:
		// Matched-previous templates do not need a previous delta, only best-clear context when relevant.
		if bestCmp == winSummaryBestBehind {
			return fmt.Sprintf(template, bestDelta)
		}
		return template
	}

	return template
}

func formatWinSummaryDuration(duration time.Duration) string {
	switch {
	case duration < time.Minute:
		return fmt.Sprintf("%.2fs", duration.Seconds())
	case duration < time.Hour:
		return fmt.Sprintf("%.2fm", duration.Minutes())
	default:
		return fmt.Sprintf("%.2fh", duration.Hours())
	}
}

func formatWinSummaryRetentionDelta(delta uint32, levelDuration time.Duration) string {
	levelDurationMs := float64(levelDuration) / float64(time.Millisecond)
	deltaDurationMs := math.Round((float64(delta) * levelDurationMs) / retentionScale)
	deltaDuration := time.Duration(deltaDurationMs) * time.Millisecond
	return formatWinSummaryDuration(deltaDuration)
}

func compareWinSummaryPrevious(
	current uint32, lastAttempt *uint32, levelDuration time.Duration,
) (winSummaryPreviousComparison, string) {
	if lastAttempt == nil {
		return winSummaryPreviousNone, ""
	}

	switch {
	case current > *lastAttempt:
		return winSummaryPreviousFaster, formatWinSummaryRetentionDelta(current-*lastAttempt, levelDuration)
	case current < *lastAttempt:
		return winSummaryPreviousSlower, formatWinSummaryRetentionDelta(*lastAttempt-current, levelDuration)
	default:
		return winSummaryPreviousMatched, ""
	}
}

func compareWinSummaryBest(
	current uint32, best *uint32, levelDuration time.Duration,
) (winSummaryBestComparison, string) {
	switch {
	case best == nil || current > *best:
		return winSummaryBestNewRecord, ""
	case current == *best:
		return winSummaryBestMatched, ""
	default:
		return winSummaryBestBehind, formatWinSummaryRetentionDelta(*best-current, levelDuration)
	}
}

func selectWinSummaryTemplate(
	previousCmp winSummaryPreviousComparison, bestCmp winSummaryBestComparison,
) string {
	switch previousCmp {
	case winSummaryPreviousNone:
		// First stored win: only the relationship to the best clear matters.
		switch bestCmp {
		case winSummaryBestNewRecord:
			return winNoPrevNewRecord
		case winSummaryBestMatched:
			return winNoPrevMatchedBest
		case winSummaryBestBehind:
			return winNoPrevBehindBest
		}
	case winSummaryPreviousFaster:
		// Faster reruns always include the improvement over the previous attempt.
		switch bestCmp {
		case winSummaryBestNewRecord:
			return winFasterPrevNewRecord
		case winSummaryBestMatched:
			return winFasterPrevMatchedBest
		case winSummaryBestBehind:
			return winFasterPrevBehindBest
		}
	case winSummaryPreviousSlower:
		// Slower reruns mirror the faster branch but report lost time instead.
		switch bestCmp {
		case winSummaryBestNewRecord:
			return winSlowerPrevNewRecord
		case winSummaryBestMatched:
			return winSlowerPrevMatchedBest
		case winSummaryBestBehind:
			return winSlowerPrevBehindBest
		}
	case winSummaryPreviousMatched:
		// Matching the previous attempt drops the delta and only reports best-clear context.
		switch bestCmp {
		case winSummaryBestNewRecord:
			return winMatchedPrevNewRecord
		case winSummaryBestMatched:
			return winMatchedPrevBest
		case winSummaryBestBehind:
			return winMatchedPrevBehindBest
		}
	}

	return winMatchedPrevBest
}

func retentionPointer(value uint32) *uint32 {
	return &value
}

func (state *gameState) handleTick(
	ui UI, timeVal time.Time, clock *GameClock, val *Dimensions, data [][]string, timeout *time.Timer,
) error {
	if state.paused {
		return nil
	}

	// Scores decay smoothly from the level budget so each refresh can show sub-second changes.
	elapsed := clock.elapsedAt(timeVal)
	state.scores = CalculateScore(state.totalCells, elapsed)
	targetReached, errUI := renderMazeUI(
		ui, val, state.persisted.Level, state.scores, data, nil, clock.blinkOnAt(timeVal),
	)
	if errUI != nil {
		return fmt.Errorf("refresh ui: %w", errUI)
	}

	if !targetReached {
		return nil
	}

	stopTimer(timeout)
	currentRetention := CalculateScoreRetention(state.totalCells, state.scores)
	levelDuration := time.Duration(state.totalCells) * time.Second
	state.overlay = &UIOverlay{
		Message:       gameOverSucceed,
		Color:         termbox.ColorCyan,
		ShowHighScore: true,
		ScorePercent:  CalculateScorePercent(state.totalCells, state.scores),
		WinSummary: BuildWinSummary(
			currentRetention,
			state.persisted.LastAttemptRetention,
			state.persisted.BestWinRetention,
			levelDuration,
		),
	}
	state.persisted.LastAttemptRetention = retentionPointer(currentRetention)
	if state.persisted.BestWinRetention == nil || currentRetention > *state.persisted.BestWinRetention {
		state.persisted.BestWinRetention = retentionPointer(currentRetention)
	}
	state.nextLevel = state.persisted.Level + 1
	state.persisted.State = GameProgressWon

	if _, err := RenderMazeUI(ui, nil, state.persisted.Level, state.scores, data, state.overlay); err != nil {
		return fmt.Errorf("show success screen: %w", err)
	}

	state.paused = true
	state.canResume = true
	state.persistProgress()
	return nil
}

func (state *gameState) handleTimeout(ui UI, data [][]string) error {
	state.persisted.LastAttemptRetention = retentionPointer(0)
	state.overlay = &UIOverlay{
		Message:       gameOverFailed,
		Color:         termbox.ColorRed,
		ShowHighScore: false,
	}
	state.nextLevel = state.persisted.Level
	state.persisted.State = GameProgressFail

	if _, err := RenderMazeUI(ui, nil, state.persisted.Level, state.scores, data, state.overlay); err != nil {
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

	// Enter serves two different flows:
	// 1. Resume a manually paused game when no overlay transition is pending.
	// 2. Load the next or current level after a win or fail overlay.
	if returnedStatus == StatusProceed {
		return state.handleProceed(ui, val, data, timeout, clock)
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

func (state *gameState) handleProceed(
	ui UI, val *Dimensions, data [][]string, timeout *time.Timer, clock *GameClock,
) (bool, [][]string, error) {
	// Ignore proceed unless the game is currently in a resumable or reloadable paused state.
	if !state.paused || !state.canResume {
		return false, data, nil
	}

	// Proceed after win/fail reloads a level, while proceed after a manual pause resumes
	// the active maze. That decision belongs to persisted game progress, not the UI overlay.
	if state.persisted.State != GameProgressInProgress {
		reloadedData, err := state.reloadLevel(ui, val, timeout, clock)
		if err != nil {
			return false, data, err
		}

		return false, reloadedData, nil
	}

	// Without an overlay transition, proceed simply resumes the current timed run from a manual pause.
	state.paused = false
	state.canResume = false
	state.overlay = nil
	clock.Resume()
	timeout.Reset(clock.Remaining())
	state.scores = CalculateScore(state.totalCells, clock.Elapsed())
	if _, err := renderMazeUI(
		ui, val, state.persisted.Level, state.scores, data, nil, clock.blinkOnAt(time.Now()),
	); err != nil {
		return false, data, fmt.Errorf("resume paused game: %w", err)
	}

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
