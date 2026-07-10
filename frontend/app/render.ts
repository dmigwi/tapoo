import { CONFIG } from "./config";
import type { Elements, ScreenLine, State } from "./types";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function leftPad(value: string, padding: number): string {
  return `${" ".repeat(Math.max(0, padding))}${value}`;
}

function padLine(value: string, width: number): string {
  if (value.length >= width) {
    return value;
  }

  return `${value}${" ".repeat(width - value.length)}`;
}

function replaceAt(line: string, index: number, char: string): string {
  if (index < 0 || index >= line.length) {
    return line;
  }

  return `${line.slice(0, index)}${char}${line.slice(index + 1)}`;
}

function statusText(state: State): string {
  const template = state.inputMode === "touch" ? CONFIG.touchStatusTemplate : CONFIG.statusTemplate;

  return template
    .replace("{level}", String(state.level))
    .replace("{score}", String(state.score));
}

function navigationText(state: State): string {
  return state.inputMode === "touch" ? CONFIG.touchNavigation : CONFIG.navigation;
}

function proceedText(state: State): string {
  return state.inputMode === "touch" ? CONFIG.touchProceedMessage : CONFIG.proceedMessage;
}

function quitText(state: State): string {
  return state.inputMode === "touch" ? CONFIG.touchQuitMessage : CONFIG.quitMessage;
}

function tooSmallText(): string {
  return window.matchMedia("(max-width: 720px)").matches
    ? CONFIG.tooSmallCompactMessage
    : CONFIG.tooSmallMessage;
}

function successText(): string {
  return window.matchMedia("(max-width: 720px)").matches
    ? CONFIG.successCompactMessage
    : CONFIG.successMessage;
}

function failedText(): string {
  return window.matchMedia("(max-width: 720px)").matches
    ? CONFIG.failedCompactMessage
    : CONFIG.failedMessage;
}

function buildMazeLines(state: State): string[] {
  if (!state.maze) {
    return [];
  }

  const lines = state.maze.map((row) => row.join(""));

  if (state.finalPosition) {
    lines[state.finalPosition[0]] = replaceAt(
      lines[state.finalPosition[0]],
      state.finalPosition[1] * CONFIG.cellSpan,
      CONFIG.destinationMarker,
    );
  }

  if (state.playerPosition) {
    lines[state.playerPosition[0]] = replaceAt(
      lines[state.playerPosition[0]],
      state.playerPosition[1] * CONFIG.cellSpan,
      CONFIG.playerMarker,
    );
  }

  return lines.map((line) => leftPad(line, CONFIG.mazeLeftPadding));
}

function renderMarkedLine(rawLine: string): string {
  let html = "";

  for (const char of rawLine) {
    const value = char === " " ? "&nbsp;" : escapeHtml(char);

    if (char === CONFIG.playerMarker) {
      html += `<span class="maze-cell player">${value}</span>`;
    } else if (char === CONFIG.destinationMarker) {
      html += `<span class="maze-cell target">${value}</span>`;
    } else {
      html += `<span class="maze-cell copy">${value}</span>`;
    }
  }

  return `<span class="maze-row">${html}</span>`;
}

function renderTextLine(value: string, className = "copy"): string {
  const html = value === "" ? "&nbsp;" : escapeHtml(value).replaceAll(" ", "&nbsp;");
  return `<span class="${className}">${html}</span>`;
}

function overlayRows(state: State): ScreenLine[] {
  const lines: ScreenLine[] = [];

  if (state.status === "paused") {
    lines.push({ kind: "text", text: CONFIG.pauseMessage, className: "status centered" });
    lines.push({ kind: "text", text: proceedText(state), className: "copy centered" });
    return lines;
  }

  if (state.status === "won") {
    lines.push({ kind: "text", text: successText(), className: "status centered" });
    const scoresMsg = CONFIG.highScoreTemplate.replace("{score}", String(state.lastRoundScore));
    lines.push({ kind: "text", text: scoresMsg, className: "accent centered" });
    lines.push({ kind: "text", text: proceedText(state), className: "copy centered" });
    return lines;
  }

  if (state.status === "lost") {
    lines.push({ kind: "text", text: failedText(), className: "status centered" });
    lines.push({ kind: "text", text: proceedText(state), className: "copy centered" });
    return lines;
  }

  if (state.status === "quit") {
    lines.push({ kind: "text", text: quitText(state), className: "status centered" });
    return lines;
  }

  if (state.status === "too-small") {
    lines.push({ kind: "text", text: tooSmallText(), className: "status centered" });
    return lines;
  }

  return lines;
}

function applyOverlayToMaze(state: State, mazeLines: string[], mazeWidth: number): ScreenLine[] {
  const screenMaze: ScreenLine[] = mazeLines.map((line) => ({
    kind: "maze",
    text: padLine(line, mazeWidth),
    className: "copy",
  }));

  const overlay = overlayRows(state);
  if (overlay.length === 0) {
    return screenMaze;
  }

  const overlayStartRow = Math.floor(mazeLines.length / 2);
  const overlayRowStride = overlay.length > 1 ? 2 : 1;
  const overlayEndRow = overlayStartRow + (overlay.length - 1) * overlayRowStride;
  const clearStartRow = Math.max(0, overlayStartRow - 1);
  const clearEndRow = overlayEndRow + 1;

  while (screenMaze.length <= clearEndRow) {
    screenMaze.push({ kind: "text", text: "", className: "copy" });
  }

  for (let rowIndex = clearStartRow; rowIndex <= clearEndRow; rowIndex += 1) {
    screenMaze[rowIndex] = { kind: "text", text: "", className: "copy" };
  }

  overlay.forEach((line, index) => {
    screenMaze[overlayStartRow + index * overlayRowStride] = line;
  });

  return screenMaze;
}

function buildScreenLines(state: State): ScreenLine[] {
  const mazeLines = buildMazeLines(state);
  const mazeWidth = mazeLines.reduce((width, line) => Math.max(width, line.length), 0);
  const lines: ScreenLine[] = [
    { kind: "text", text: navigationText(state), className: "copy centered" },
    { kind: "text", text: "", className: "copy" },
  ];

  if (mazeLines.length === 0) {
    overlayRows(state).forEach((line) => {
      lines.push({ kind: "text", text: "", className: "copy" });
      lines.push(line);
    });

    return lines;
  }

  lines.push(...applyOverlayToMaze(state, mazeLines, mazeWidth));

  if (state.status === "running") {
    lines.push({ kind: "text", text: "", className: "copy" });
    lines.push({ kind: "text", text: statusText(state), className: "copy centered" });
  }

  return lines;
}

function updateTouchControls(elements: Elements, state: State): void {
  const canProceed =
    (state.status === "paused" && state.canResume) ||
    state.status === "won" ||
    state.status === "lost" ||
    state.status === "quit" ||
    state.status === "too-small";
  const showMoveControls = state.status === "running";
  const showPause = state.status === "running";
  const showWalls = state.status === "running";
  const showQuit = state.status !== "quit";
  let visibleButtons = 0;

  elements.touchButtons.forEach((button) => {
    const action = button.dataset.action;
    const move = button.dataset.move;
    let hidden = false;

    if (move) {
      hidden = !showMoveControls;
      button.hidden = hidden;
      button.disabled = false;
    } else if (action === "pause") {
      hidden = !showPause;
      button.hidden = hidden;
      button.disabled = false;
    } else if (action === "walls") {
      hidden = !showWalls;
      button.hidden = hidden;
      button.disabled = false;
    } else if (action === "proceed") {
      hidden = !canProceed;
      button.hidden = hidden;
      button.disabled = false;
    } else if (action === "quit") {
      hidden = !showQuit;
      button.hidden = hidden;
      button.disabled = false;
    } else {
      button.hidden = false;
      button.disabled = false;
    }

    if (!button.hidden) {
      visibleButtons += 1;
    }
  });

  const actionOnly = !showMoveControls && visibleButtons > 0;
  elements.touchControls.classList.toggle("touch-controls--actions-only", actionOnly && visibleButtons > 1);
  elements.touchControls.classList.toggle("touch-controls--single-action", actionOnly && visibleButtons === 1);
}

export function render(elements: Elements, state: State): void {
  const screenLines = buildScreenLines(state);
  elements.screen.innerHTML = screenLines
    .map((line) => {
      const content =
        line.kind === "maze" ? renderMarkedLine(line.text) : renderTextLine(line.text, line.className);
      return `<span class="line line--${line.kind}">${content}</span>`;
    })
    .join("");

  updateTouchControls(elements, state);
}
