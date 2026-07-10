import {
  CONFIG,
  MIN_TERMINAL_COLUMNS,
  MIN_TERMINAL_ROWS,
  TERMINAL_SAMPLE_WIDTH,
} from "./config";
import type { BaseDimensions, Elements } from "./types";

function mustElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`missing required element: ${id}`);
  }

  return element as T;
}

export const elements: Elements = {
  app: mustElement<HTMLElement>("terminal-app"),
  body: mustElement<HTMLElement>("terminal-body"),
  screen: mustElement<HTMLElement>("terminal-screen"),
  measure: mustElement<HTMLElement>("terminal-measure"),
  controls: Array.from(document.querySelectorAll<HTMLButtonElement>("[data-action]")),
};

export function getTerminalSize(): BaseDimensions {
  const rect = elements.body.getBoundingClientRect();
  const sampleRect = elements.measure.getBoundingClientRect();
  const screenStyle = window.getComputedStyle(elements.screen);
  const charWidth = sampleRect.width / TERMINAL_SAMPLE_WIDTH || 9;
  const mazeRowHeight = Number.parseFloat(screenStyle.fontSize) || sampleRect.height || 16;
  const terminalColumns = Math.max(MIN_TERMINAL_COLUMNS, Math.floor(rect.width / charWidth));
  const terminalRows = Math.max(MIN_TERMINAL_ROWS, Math.floor(rect.height / mazeRowHeight));

  return {
    length: Math.floor((terminalColumns - CONFIG.terminalHeightInset) / CONFIG.terminalHeightScale),
    width: Math.floor((terminalRows - CONFIG.terminalWidthInset) / CONFIG.terminalWidthScale),
  };
}
