import { CONFIG } from "./config"
import {
  canProceedStatus,
  canShowWallsStatus,
  isAgentApiMode,
  isAwaitAgentStatus,
  isInteractiveMode,
  isLostStatus,
  isPausedStatus,
  isRunningStatus,
  isTooSmallStatus,
  isWonStatus,
} from "./status"
import type { Elements, ScreenLine, State } from "./types"

const { maze, messages, scoring, viewport } = CONFIG

// escapeHtml protects text rows before they are written as HTML.
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

// leftPad offsets maze rows so the browser view mirrors the terminal layout.
function leftPad(value: string, padding: number): string {
  return `${" ".repeat(Math.max(0, padding))}${value}`
}

// padLine keeps overlay-cleared maze rows aligned to a fixed width.
function padLine(value: string, width: number): string {
  if (value.length >= width) {
    return value
  }

  return `${value}${" ".repeat(width - value.length)}`
}

// replaceAt swaps a single visible marker into an already-built maze row.
function replaceAt(line: string, index: number, char: string): string {
  if (index < 0 || index >= line.length) {
    return line
  }

  return `${line.slice(0, index)}${char}${line.slice(index + 1)}`
}

// statusText selects the running-status footer copy for the current display size.
function statusText(elements: Elements, state: State): string {
  const template = isCompactDisplay(elements)
    ? messages.runningStatus.touch
    : messages.runningStatus.keyboard

  return template
    .replace("{level}", String(state.level))
    .replace("{score}", String(state.score))
}

// viewportMetrics gathers every meaningful browser measurement used for compact mode detection.
function viewportMetrics(elements: Elements): {
  heightCandidates: number[]
  widthCandidates: number[]
} {
  const rect = elements.body.getBoundingClientRect()
  const widthCandidates = [
    window.screen.width,
    window.screen.availWidth,
    rect.width,
    window.visualViewport?.width ?? 0,
    document.documentElement.clientWidth,
    window.innerWidth,
  ].filter((value) => value > 0)
  const heightCandidates = [
    window.screen.height,
    window.screen.availHeight,
    rect.height,
    window.visualViewport?.height ?? 0,
    document.documentElement.clientHeight,
    window.innerHeight,
  ].filter((value) => value > 0)

  return {
    widthCandidates,
    heightCandidates,
  }
}

// isCompactDisplay collapses copy when any viewport dimension crosses the compact threshold.
function isCompactDisplay(elements: Elements): boolean {
  const { availableWidth, availableHeight } = {
    availableWidth: window.matchMedia(
      `(max-width: ${viewport.compactWidth}px)`,
    ).matches,
    availableHeight: window.matchMedia(
      `(max-height: ${viewport.compactHeight}px)`,
    ).matches,
  }
  const { widthCandidates, heightCandidates } = viewportMetrics(elements)
  const compactWidth = widthCandidates.some(
    (width) => width <= viewport.compactWidth,
  )
  const compactHeight = heightCandidates.some(
    (height) => height <= viewport.compactHeight,
  )

  return availableWidth || availableHeight || compactWidth || compactHeight
}

// navigationText picks the control-mode and viewport-specific navigation hint.
function navigationText(elements: Elements, state: State): string {
  const compact = isCompactDisplay(elements)
  const navigation = isAgentApiMode(state.controlMode)
    ? messages.navigation.agentApi
    : messages.navigation.interactive

  return compact ? navigation.touch : navigation.keyboard
}

// proceedText picks the keyboard or touch proceed hint for the viewport.
function proceedText(elements: Elements): string {
  return isCompactDisplay(elements)
    ? messages.proceed.touch
    : messages.proceed.keyboard
}

// centeredTextRow creates one centered text line for the rendered screen model.
function centeredTextRow(text: string, className = "screen-text"): ScreenLine {
  return {
    kind: "text",
    text,
    className: `${className} centered`,
  }
}

// emptyTextRow creates a spacer line while preserving the renderer's line model.
function emptyTextRow(): ScreenLine {
  return {
    kind: "text",
    text: "",
    className: "screen-text",
  }
}

// rowsWithSpacer inserts blank lines before each supplied row for terminal-style spacing.
function rowsWithSpacer(...rows: ScreenLine[]): ScreenLine[] {
  return rows.flatMap((row) => [emptyTextRow(), row])
}

// tooSmallRows builds the viewport warning shown when the maze no longer fits.
function tooSmallRows(state: State): ScreenLine[] {
  return [
    centeredTextRow(
      messages.tooSmallMessage.replace("{level}", String(state.level)),
      "status",
    ),
    centeredTextRow(messages.tooSmallActionMessage),
  ]
}

// successText picks the win message sized for the current viewport.
function successText(elements: Elements): string {
  return isCompactDisplay(elements)
    ? messages.successCompactMessage
    : messages.successMessage
}

// failedText picks the loss message sized for the current viewport.
function failedText(elements: Elements): string {
  return isCompactDisplay(elements)
    ? messages.failedCompactMessage
    : messages.failedMessage
}

// shouldDrawDestination decides whether the blinking destination is visible this frame.
function shouldDrawDestination(state: State): boolean {
  if (!isRunningStatus(state.status) || !state.clock) {
    return true
  }

  return state.clock.blink()
}

// buildMazeLines merges the maze grid with the current player and target markers.
function buildMazeLines(state: State): string[] {
  if (!state.maze) {
    return []
  }

  const lines = state.maze.map((row) => row.join(""))

  if (state.finalPosition && shouldDrawDestination(state)) {
    lines[state.finalPosition.y] = replaceAt(
      lines[state.finalPosition.y],
      state.finalPosition.x * maze.cellSpan,
      maze.destinationMarker,
    )
  }

  if (state.playerPosition) {
    lines[state.playerPosition.y] = replaceAt(
      lines[state.playerPosition.y],
      state.playerPosition.x * maze.cellSpan,
      maze.playerMarker,
    )
  }

  return lines.map((line) => leftPad(line, maze.leftPadding))
}

// renderMarkedLine wraps one maze row in span markup for colorized rendering.
function renderMarkedLine(rawLine: string): string {
  let html = ""

  for (const char of rawLine) {
    const value = char === " " ? "&nbsp;" : escapeHtml(char)

    if (char === maze.playerMarker) {
      html += `<span class="maze-cell player">${value}</span>`
    } else if (char === maze.destinationMarker) {
      html += `<span class="maze-cell target">${value}</span>`
    } else {
      html += `<span class="maze-cell walls">${value}</span>`
    }
  }

  return `<span class="maze-row">${html}</span>`
}

// renderTextLine converts a text row into HTML while preserving spacing.
function renderTextLine(value: string, className = "screen-text"): string {
  const html =
    value === "" ? "&nbsp;" : escapeHtml(value).replaceAll(" ", "&nbsp;")
  return `<span class="${className}">${html}</span>`
}

// scorePercent converts the last-round score into a compact retention percentage.
function scorePercent(state: State): number {
  if (!state.mazeDimensions) {
    return 0
  }

  const maxScore =
    state.mazeDimensions.length *
    state.mazeDimensions.width *
    scoring.budgetMultiplier
  if (maxScore <= 0) {
    return 0
  }

  return Math.max(
    0,
    Math.min(
      scoring.percentScale,
      Math.round((state.lastRoundScore * scoring.percentScale) / maxScore),
    ),
  )
}

// overlayRows builds the centered pause, win, loss, or too-small overlay lines.
function overlayRows(elements: Elements, state: State): ScreenLine[] {
  if (isAwaitAgentStatus(state.status) && isAgentApiMode(state.controlMode)) {
    return [
      centeredTextRow(messages.agentAwaitMessage, "status"),
      centeredTextRow(
        `${messages.agentAwaitActionMessage} ${proceedText(elements)}`,
      ),
    ]
  }

  if (isPausedStatus(state.status)) {
    return [
      centeredTextRow(messages.pauseMessage, "status"),
      centeredTextRow(proceedText(elements)),
    ]
  }

  if (isWonStatus(state.status)) {
    const scoresMsg = messages.highScoreTemplate
      .replace("{level}", String(state.level))
      .replace("{score}", String(state.lastRoundScore))
      .replace("{percent}", String(scorePercent(state)))
    const rows = [
      centeredTextRow(successText(elements), "status"),
      centeredTextRow(scoresMsg, "accent"),
    ]

    if (state.winSummary) {
      rows.push(centeredTextRow(state.winSummary, "accent"))
    }

    rows.push(centeredTextRow(proceedText(elements)))
    return rows
  }

  if (isLostStatus(state.status)) {
    return [
      centeredTextRow(failedText(elements), "status"),
      centeredTextRow(proceedText(elements)),
    ]
  }

  if (isTooSmallStatus(state.status)) {
    return tooSmallRows(state)
  }

  return []
}

// applyOverlayToMaze clears the maze center area and drops the overlay into it.
function applyOverlayToMaze(
  elements: Elements,
  state: State,
  mazeLines: string[],
  mazeWidth: number,
): ScreenLine[] {
  const screenMaze: ScreenLine[] = mazeLines.map((line) => ({
    kind: "maze",
    text: padLine(line, mazeWidth),
    className: "screen-text",
  }))

  const overlay = overlayRows(elements, state)
  if (overlay.length === 0) {
    return screenMaze
  }

  const overlayStartRow = Math.floor(mazeLines.length / 2)
  const overlayRowStride = overlay.length > 1 ? 2 : 1
  const overlayEndRow =
    overlayStartRow + (overlay.length - 1) * overlayRowStride
  const clearStartRow = Math.max(0, overlayStartRow - 1)
  const clearEndRow = overlayEndRow + 1

  while (screenMaze.length <= clearEndRow) {
    screenMaze.push(emptyTextRow())
  }

  for (let rowIndex = clearStartRow; rowIndex <= clearEndRow; rowIndex += 1) {
    screenMaze[rowIndex] = emptyTextRow()
  }

  overlay.forEach((line, index) => {
    screenMaze[overlayStartRow + index * overlayRowStride] = line
  })

  return screenMaze
}

// buildScreenLines assembles the final screen model for the current state.
function buildScreenLines(elements: Elements, state: State): ScreenLine[] {
  const mazeLines = buildMazeLines(state)
  const mazeWidth = mazeLines.reduce(
    (width, line) => Math.max(width, line.length),
    0,
  )
  const lines: ScreenLine[] = [
    centeredTextRow(navigationText(elements, state)),
    emptyTextRow(),
  ]

  if (mazeLines.length === 0) {
    lines.push(...rowsWithSpacer(...overlayRows(elements, state)))

    return lines
  }

  lines.push(...applyOverlayToMaze(elements, state, mazeLines, mazeWidth))

  if (isRunningStatus(state.status)) {
    lines.push(emptyTextRow(), centeredTextRow(statusText(elements, state)))
  }

  return lines
}

// updateTouchControls shows only the touch controls that make sense for the current state.
function updateTouchControls(elements: Elements, state: State): void {
  const canProceed = state.canResume
    ? canProceedStatus(state.status)
    : isAwaitAgentStatus(state.status) || isWonStatus(state.status) || isLostStatus(state.status)
  const showMoveControls =
    isInteractiveMode(state.controlMode) && isRunningStatus(state.status)
  const showPause = isRunningStatus(state.status)
  const showWalls = canShowWallsStatus(state.status)
  const showRestart =
    isAwaitAgentStatus(state.status) ||
    isPausedStatus(state.status) ||
    isWonStatus(state.status) ||
    isLostStatus(state.status) ||
    isTooSmallStatus(state.status)
  let visibleButtons = 0

  elements.touchButtons.forEach((button) => {
    const action = button.dataset.action
    const move = button.dataset.move
    const hidden = move
      ? !showMoveControls
      : action === "pause"
        ? !showPause
        : action === "walls"
          ? !showWalls
          : action === "proceed"
            ? !canProceed
            : action === "restart"
              ? !showRestart
              : false

    button.hidden = hidden
    button.disabled = false

    if (!button.hidden) {
      visibleButtons += 1
    }
  })

  elements.touchControls.hidden = visibleButtons === 0

  const actionOnly = !showMoveControls && visibleButtons > 0
  elements.touchControls.classList.toggle(
    "touch-controls--action-row",
    actionOnly,
  )
  elements.touchControls.classList.toggle(
    "touch-controls--single-action",
    !showMoveControls && visibleButtons === 1,
  )
}

// updateTopMenuControls disables page-level actions that are unavailable in the current game state.
function updateTopMenuControls(elements: Elements, state: State): void {
  const disableAgentConfig = isAgentApiMode(state.controlMode) && isRunningStatus(state.status)

  elements.controls.forEach((button) => {
    if (button.dataset.agentConfigToggle === "true") {
      button.disabled = disableAgentConfig
    }
  })
}

// updateAgentConfigForm keeps the agent setup overlay available only outside active agent play.
function updateAgentConfigForm(elements: Elements, state: State): void {
  if (!elements.agentConfigForm && !elements.agentDeleteDialog) {
    return
  }

  if (isAgentApiMode(state.controlMode) && !isRunningStatus(state.status)) {
    return
  }

  if (elements.agentConfigForm) {
    elements.agentConfigForm.hidden = true
  }
  if (elements.agentDeleteDialog) {
    elements.agentDeleteDialog.hidden = true
  }
  elements.body.classList.remove("terminal-body--agent-form-active")
}

// render turns the current state into HTML and syncs the floating controls.
export function render(elements: Elements, state: State): void {
  const screenLines = buildScreenLines(elements, state)
  elements.screen.innerHTML = screenLines
    .map((line) => {
      const content =
        line.kind === "maze"
          ? renderMarkedLine(line.text)
          : renderTextLine(line.text, line.className)
      return `<span class="line line--${line.kind}">${content}</span>`
    })
    .join("")

  updateTouchControls(elements, state)
  updateTopMenuControls(elements, state)
  updateAgentConfigForm(elements, state)
}
