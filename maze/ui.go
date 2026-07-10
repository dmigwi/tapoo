package maze

import termbox "github.com/nsf/termbox-go"

// UI defines the terminal surface the maze runtime renders to and reads input from.
// It keeps the game loop portable across the real termbox implementation and test doubles.
type UI interface {
	Init() error
	Close()
	Interrupt()
	StorePath() string
	SetInputMode(mode termbox.InputMode)
	PollEvent() termbox.Event
	Size() (int, int)
	Clear(foreground, background termbox.Attribute) error
	SetCell(x, y int, char rune, foreground, background termbox.Attribute)
	Flush() error
}

// TermboxUI adapts the termbox package to the UI interface used by the maze runtime.
type TermboxUI struct {
	storePath string
}

// NewTermboxUI builds the production UI with the store path that should be used for persistence.
func NewTermboxUI(path string) UI {
	return TermboxUI{storePath: path}
}

// Init prepares the termbox screen for rendering.
func (TermboxUI) Init() error {
	return termbox.Init()
}

// Close releases the termbox screen resources.
func (TermboxUI) Close() {
	termbox.Close()
}

// Interrupt wakes a blocked PollEvent call so the runtime can shut down cleanly.
func (TermboxUI) Interrupt() {
	termbox.Interrupt()
}

// StorePath reports where the runtime store file should be persisted for this UI session.
func (ui TermboxUI) StorePath() string {
	return ui.storePath
}

// SetInputMode configures how termbox should interpret keyboard input.
func (TermboxUI) SetInputMode(mode termbox.InputMode) {
	termbox.SetInputMode(mode)
}

// PollEvent blocks until termbox emits the next terminal event.
func (TermboxUI) PollEvent() termbox.Event {
	return termbox.PollEvent()
}

// Size reports the current termbox terminal dimensions.
func (TermboxUI) Size() (int, int) {
	return termbox.Size()
}

// Clear clears the current termbox frame buffer.
func (TermboxUI) Clear(foreground, background termbox.Attribute) error {
	return termbox.Clear(foreground, background)
}

// SetCell writes a single rune to the current termbox frame buffer.
func (TermboxUI) SetCell(x, y int, char rune, foreground, background termbox.Attribute) {
	termbox.SetCell(x, y, char, foreground, background)
}

// Flush commits the current termbox frame buffer to the screen.
func (TermboxUI) Flush() error {
	return termbox.Flush()
}
