package maze_test

import (
	"strings"
	"sync"

	termbox "github.com/nsf/termbox-go"
)

type renderedCell struct {
	char       rune
	foreground termbox.Attribute
	background termbox.Attribute
}

type fakeUI struct {
	mu         sync.Mutex
	height     int
	width      int
	initErr    error
	clearErr   error
	flushErr   error
	inputMode  termbox.InputMode
	initCalls  int
	closeCalls int
	flushCalls int
	cells      map[[2]int]renderedCell
	events     chan termbox.Event
	closed     chan struct{}
	closeOnce  sync.Once
}

func newFakeUI(height, width int) *fakeUI {
	return &fakeUI{
		height: height,
		width:  width,
		cells:  make(map[[2]int]renderedCell),
		events: make(chan termbox.Event, 32),
		closed: make(chan struct{}),
	}
}

func (ui *fakeUI) Init() error {
	ui.mu.Lock()
	defer ui.mu.Unlock()

	ui.initCalls++

	return ui.initErr
}

func (ui *fakeUI) Close() {
	ui.mu.Lock()
	ui.closeCalls++
	ui.mu.Unlock()

	ui.closeOnce.Do(func() {
		close(ui.closed)
	})
}

func (ui *fakeUI) SetInputMode(mode termbox.InputMode) {
	ui.mu.Lock()
	defer ui.mu.Unlock()

	ui.inputMode = mode
}

func (ui *fakeUI) PollEvent() termbox.Event {
	select {
	case ev := <-ui.events:
		return ev
	case <-ui.closed:
		return termbox.Event{Type: termbox.EventError}
	}
}

func (ui *fakeUI) Size() (int, int) {
	return ui.height, ui.width
}

func (ui *fakeUI) Clear(_, _ termbox.Attribute) error {
	ui.mu.Lock()
	defer ui.mu.Unlock()

	if ui.clearErr != nil {
		return ui.clearErr
	}

	ui.cells = make(map[[2]int]renderedCell)

	return nil
}

func (ui *fakeUI) SetCell(x, y int, char rune, foreground, background termbox.Attribute) {
	ui.mu.Lock()
	defer ui.mu.Unlock()

	ui.cells[[2]int{x, y}] = renderedCell{
		char:       char,
		foreground: foreground,
		background: background,
	}
}

func (ui *fakeUI) Flush() error {
	ui.mu.Lock()
	defer ui.mu.Unlock()

	if ui.flushErr != nil {
		return ui.flushErr
	}

	ui.flushCalls++

	return nil
}

func (ui *fakeUI) enqueueEvents(events ...termbox.Event) {
	for _, event := range events {
		ui.events <- event
	}
}

func (ui *fakeUI) hasRune(want rune) bool {
	ui.mu.Lock()
	defer ui.mu.Unlock()

	for _, cell := range ui.cells {
		if cell.char == want {
			return true
		}
	}

	return false
}

func (ui *fakeUI) containsText(want string) bool {
	ui.mu.Lock()
	defer ui.mu.Unlock()

	rows := make(map[int]map[int]rune)
	rowBounds := make(map[int][2]int)

	for pos, cell := range ui.cells {
		xPos, yPos := pos[0], pos[1]

		if _, ok := rows[yPos]; !ok {
			rows[yPos] = make(map[int]rune)
			rowBounds[yPos] = [2]int{xPos, xPos}
		}

		rows[yPos][xPos] = cell.char

		bounds := rowBounds[yPos]
		if xPos < bounds[0] {
			bounds[0] = xPos
		}

		if xPos > bounds[1] {
			bounds[1] = xPos
		}

		rowBounds[yPos] = bounds
	}

	for yPos, row := range rows {
		bounds := rowBounds[yPos]
		line := make([]rune, bounds[1]-bounds[0]+1)

		for index := range line {
			line[index] = ' '
		}

		for xPos, char := range row {
			line[xPos-bounds[0]] = char
		}

		if strings.Contains(string(line), want) {
			return true
		}
	}

	return false
}

func sampleMazeGrid() [][]string {
	return [][]string{
		{"|", "---", "|", "---", "|", "---", "|"},
		{"|", " A ", " ", "   ", "|", "   ", "|"},
		{"|", "   ", "|", "   ", "|", "---", "|"},
		{"|", "   ", " ", " B ", " ", "   ", "|"},
		{"|", "---", "|", "   ", "|", "---", "|"},
		{"|", "   ", "|", "   ", "|", "   ", "|"},
		{"|", "---", "|", "---", "|", "---", "|"},
	}
}
