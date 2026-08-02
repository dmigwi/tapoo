import { CONFIG } from "./config"
import {
  calculateScoreRetentionUnits,
  retentionUnitsToDisplayPercent,
} from "./scoring"
import {
  canProceedStatus,
  canShowRestart,
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
import { gridPointFromCellCoordinate } from "./traversal"
import type { DisplayMsg, Elements, ScreenLine, State } from "./types"
import { isCompactViewport } from "./viewport"

const { maze, messages } = CONFIG

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
function statusText(state: State): string {
  const template = displayText(messages.runningStatus)

  return template
    .replace("{level}", String(state.level))
    .replace("{score}", String(state.score))
}

// displayText picks the wide or compact copy variant for the currently available display room.
function displayText(message: DisplayMsg): string {
  return isCompactViewport() ? message.compact : message.wide
}

// navigationText picks the control-mode and viewport-specific navigation hint.
function navigationText(state: State): string {
  const navigation = isAgentApiMode(state.controlMode)
    ? messages.navigation.agentApi
    : messages.navigation.interactive

  return displayText(navigation)
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

// shouldDrawDestination decides whether the blinking destination is visible this frame.
function shouldDrawDestination(state: State): boolean {
  if (!isRunningStatus(state.status) || !state.clock) {
    return true
  }

  return state.clock.blink()
}

// buildMazeLines merges the maze grid with the visited trail, current player, and target markers.
function buildMazeLines(state: State): string[] {
  if (!state.maze) {
    return []
  }

  const lines = state.maze.map((row) => row.join(""))

  // The trail is drawn first so the player and destination markers always take precedence
  // over it at their own cell, matching the draw order below.
  for (const visitedCell of state.traversalHistory) {
    const point = gridPointFromCellCoordinate(visitedCell)
    if (state.playerPosition && point.x === state.playerPosition.x && point.y === state.playerPosition.y) {
      continue
    }

    lines[point.y] = replaceAt(lines[point.y], point.x * maze.renderCellStep, maze.visitedCellMarker)
  }

  if (state.finalPosition && shouldDrawDestination(state)) {
    lines[state.finalPosition.y] = replaceAt(
      lines[state.finalPosition.y],
      state.finalPosition.x * maze.renderCellStep,
      maze.destinationMarker,
    )
  }

  if (state.playerPosition) {
    lines[state.playerPosition.y] = replaceAt(
      lines[state.playerPosition.y],
      state.playerPosition.x * maze.renderCellStep,
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
    } else if (char === maze.visitedCellMarker) {
      html += `<span class="maze-cell visited">${value}</span>`
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

// scorePercent converts stored or fallback score retention units into the displayed percentage.
function scorePercent(state: State): number {
  if (state.lastAttemptRetentionUnits !== null) {
    return retentionUnitsToDisplayPercent(state.lastAttemptRetentionUnits)
  }

  if (!state.mazeDimensions) {
    return 0
  }

  const fallbackRetentionUnits = calculateScoreRetentionUnits(state.mazeDimensions.area, state.lastRoundScore)
  return retentionUnitsToDisplayPercent(fallbackRetentionUnits)
}

// overlayRows builds the centered pause, win, loss, or too-small overlay lines.
function overlayRows(elements: Elements, state: State): ScreenLine[] {
  if (isAwaitAgentStatus(state.status) && isAgentApiMode(state.controlMode)) {
    return [
      centeredTextRow(messages.agentAwaitMessage, "status"),
      centeredTextRow(displayText(messages.agentAwaitAction)),
    ]
  }

  if (isPausedStatus(state.status)) {
    return [
      centeredTextRow(messages.pauseMessage, "status"),
      centeredTextRow(displayText(messages.proceed)),
    ]
  }

  if (isWonStatus(state.status)) {
    const scoresMsg = messages.highScoreTemplate
      .replace("{level}", String(state.level))
      .replace("{score}", String(state.lastRoundScore))
      .replace("{percent}", String(scorePercent(state)))
    const rows = [
      centeredTextRow(displayText(messages.success), "status"),
      centeredTextRow(scoresMsg, "accent"),
    ]

    if (state.winSummary) {
      rows.push(centeredTextRow(state.winSummary, "accent"))
    }

    rows.push(centeredTextRow(displayText(messages.proceed)))
    return rows
  }

  if (isLostStatus(state.status)) {
    return [
      centeredTextRow(displayText(messages.failed), "status"),
      centeredTextRow(displayText(messages.proceed)),
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
  const overlayEndRow = overlayStartRow + (overlay.length - 1) * overlayRowStride
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
    centeredTextRow(navigationText(state)),
    emptyTextRow(),
  ]

  if (mazeLines.length === 0) {
    lines.push(...rowsWithSpacer(...overlayRows(elements, state)))

    return lines
  }

  lines.push(...applyOverlayToMaze(elements, state, mazeLines, mazeWidth))

  if (isRunningStatus(state.status)) {
    lines.push(emptyTextRow(), centeredTextRow(statusText(state)))
  }

  return lines
}

// updateTouchControls shows only the touch controls that make sense for the current state.
function updateTouchControls(elements: Elements, state: State): void {
  const showMoveControls = isInteractiveMode(state.controlMode) && isRunningStatus(state.status)
  // Keyed by data-action so adding a control is one entry here rather than another branch. The
  // lookup deliberately fails closed: an action with no entry stays hidden, so a button wired into
  // the markup but not into this map disappears instead of sitting clickable in every state.
  const actionIsVisible: Record<string, boolean> = {
    pause: isRunningStatus(state.status),
    walls: canShowWallsStatus(state.status),
    proceed: canProceedStatus(state.status),
    restart: canShowRestart(state.status),
  }
  let visibleButtons = 0

  elements.touchButtons.forEach((button) => {
    const { action, move } = button.dataset
    button.hidden = move
      ? !showMoveControls
      : !(actionIsVisible[action ?? ""] ?? false)

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
