import { CONFIG } from "./config"
import type { BaseDimensions, Elements } from "./types"

const { viewport } = CONFIG
const missingRequiredElementTemplate = "missing required element: {id}"

// mustElement fetches a required terminal node and fails fast when it is missing.
function mustElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLElement)) {
    throw new Error(missingRequiredElementTemplate.replace("{id}", id))
  }

  return element as T
}

// hasTerminalElements checks whether the current page actually hosts the terminal UI.
function hasTerminalElements(): boolean {
  return (
    document.getElementById("terminal-app") instanceof HTMLElement &&
    document.getElementById("terminal-body") instanceof HTMLElement &&
    document.getElementById("terminal-screen") instanceof HTMLElement &&
    document.getElementById("terminal-measure") instanceof HTMLElement &&
    document.getElementById("touch-controls") instanceof HTMLElement &&
    document.getElementById("terminal-zoom-placeholder") instanceof HTMLElement
  )
}

// getGameElements gathers the DOM handles used by the runtime and renderer.
export function getGameElements(): Elements | null {
  if (!hasTerminalElements()) {
    return null
  }

  return {
    app: mustElement<HTMLElement>("terminal-app"),
    body: mustElement<HTMLElement>("terminal-body"),
    screen: mustElement<HTMLElement>("terminal-screen"),
    measure: mustElement<HTMLElement>("terminal-measure"),
    controls: Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        "button[data-action]:not([data-touch-control])",
      ),
    ),
    touchControls: mustElement<HTMLElement>("touch-controls"),
    zoomPlaceholder: mustElement<HTMLElement>("terminal-zoom-placeholder"),
    touchButtons: Array.from(
      document.querySelectorAll<HTMLButtonElement>("[data-touch-control]"),
    ),
    infoGate: mustElement<HTMLElement>("info-gate"),
    infoGateTitle: mustElement<HTMLElement>("info-gate-title"),
    infoGateMessage: mustElement<HTMLElement>("info-gate-message"),
    infoGateDetail: mustElement<HTMLElement>("info-gate-detail"),
    infoGateLink: mustElement<HTMLAnchorElement>("info-gate-link"),
    infoGateProceed: mustElement<HTMLButtonElement>("info-gate-proceed"),
    systemPalette: mustElement<HTMLElement>("system-palette"),
    systemSettings: mustElement<HTMLButtonElement>("system-settings"),
    systemSettingsDialog: mustElement<HTMLElement>("system-settings-dialog"),
    systemSettingsTitle: mustElement<HTMLElement>("system-settings-title"),
    systemSettingsRestartLevel: mustElement<HTMLInputElement>("system-settings-restart-level"),
    systemSettingsStatus: mustElement<HTMLElement>("system-settings-status"),
    systemSettingsApply: mustElement<HTMLButtonElement>("system-settings-apply"),
    systemSettingsClose: mustElement<HTMLButtonElement>("system-settings-close"),
    tapooLogsReset: mustElement<HTMLButtonElement>("tapoo-logs-reset"),
    tapooLogsDownload: mustElement<HTMLButtonElement>("tapoo-logs-download"),
    agentSeatRoster: mustElement<HTMLElement>("agent-seat-roster"),
    agentConfigForm: mustElement<HTMLFormElement>("agent-config-form"),
    agentConfigTitle: mustElement<HTMLElement>("agent-config-title"),
    agentConfigPlayerName: mustElement<HTMLInputElement>("agent-config-player-name"),
    agentConfigModel: mustElement<HTMLInputElement>("agent-config-model"),
    agentConfigApi: mustElement<HTMLSelectElement>("agent-config-api"),
    agentConfigRequestInterval: mustElement<HTMLInputElement>("agent-config-request-interval"),
    agentConfigEndpoint: mustElement<HTMLInputElement>("agent-config-endpoint"),
    agentConfigCredential: mustElement<HTMLInputElement>("agent-config-credential"),
    agentConfigCredentialLabel: mustElement<HTMLElement>("agent-config-credential-label"),
    agentConfigCredentialRequired: mustElement<HTMLElement>("agent-config-credential-required"),
    agentConfigExtraHeadersRows: mustElement<HTMLElement>("agent-config-extra-headers-rows"),
    agentConfigExtraHeadersAdd: mustElement<HTMLButtonElement>("agent-config-extra-headers-add"),
    agentConfigReasoningEffort: mustElement<HTMLSelectElement>("agent-config-reasoning-effort"),
    agentConfigEchoBackReasoning: mustElement<HTMLInputElement>("agent-config-echo-back-reasoning"),
    agentConfigEchoBackReasoningLabel: mustElement<HTMLElement>("agent-config-echo-back-reasoning-label"),
    agentConfigEnabled: mustElement<HTMLInputElement>("agent-config-enabled"),
    agentConfigEnabledLabel: mustElement<HTMLElement>( "agent-config-enabled-label"),
    agentConfigClose: mustElement<HTMLButtonElement>("agent-config-close"),
    agentConfigStatus: mustElement<HTMLElement>("agent-config-status"),
    agentManageDialog: mustElement<HTMLElement>("agent-manage-dialog"),
    agentManageTitle: mustElement<HTMLElement>("agent-manage-title"),
    agentDeleteTarget: mustElement<HTMLElement>("agent-delete-target"),
    agentManageEnabled: mustElement<HTMLInputElement>("agent-manage-enabled"),
    agentManageEnabledLabel: mustElement<HTMLElement>("agent-manage-enabled-label"),
    agentManageReasoningEffort: mustElement<HTMLSelectElement>("agent-manage-reasoning-effort"),
    agentManageApi: mustElement<HTMLSelectElement>("agent-manage-api"),
    agentManageRequestInterval: mustElement<HTMLInputElement>("agent-manage-request-interval"),
    agentManageEchoBackReasoning: mustElement<HTMLInputElement>("agent-manage-echo-back-reasoning"),
    agentManageEchoBackReasoningLabel: mustElement<HTMLElement>("agent-manage-echo-back-reasoning-label"),
    agentManageApply: mustElement<HTMLButtonElement>("agent-manage-apply"),
    agentDeleteConfirm: mustElement<HTMLInputElement>("agent-delete-confirm"),
    agentManageStatus: mustElement<HTMLElement>("agent-manage-status"),
    agentManageClose: mustElement<HTMLButtonElement>("agent-manage-close"),
  }
}

// terminalCharacterColumns reports the raw number of monospace characters that fit across the
// terminal's current rendered width - real per-character metrics, not the maze-cell-adjusted
// numCols getTerminalSize below derives from this same measurement.
export function terminalCharacterColumns(elements: Elements): number {
  const rect = elements.body.getBoundingClientRect()
  const sampleRect = elements.measure.getBoundingClientRect()
  const charWidth = sampleRect.width / viewport.terminalSampleWidth || 9
  return Math.floor(rect.width / charWidth)
}

// isBelowMinimumViewport is the single test the app answers "is this viewport too small to show
// anything useful" with. It takes the measurement itself rather than accepting width and height from
// a caller: two callers could otherwise measure different things - the body, the screen, the visual
// viewport - and disagree about the same window. One reading, one answer.
//
// It lives here rather than beside the other status predicates because it reads the DOM, which is
// what this module is for; status.ts stays free of it and can be reasoned about without a document.
//
// Either dimension failing is enough. A window can be wide and only a few lines tall - a desktop
// browser dragged short, or a phone in landscape with the keyboard up - and a maze needs both.
export function isBelowMinimumViewport(elements: Elements): boolean {
  const { width, height } = elements.body.getBoundingClientRect()
  // An unmeasured element reports zeros - before first layout, or while detached - and that is not
  // the same as a small one. Reporting "too small" there would blank the screen and refuse input on
  // the strength of a measurement that has not happened yet, so an absent reading is treated as no
  // evidence rather than as evidence against.
  if (width === 0 || height === 0) {
    return false
  }

  return width < viewport.minSupportedWidth || height < viewport.minSupportedHeight
}

// getTerminalSize converts DOM measurements into logical maze dimensions.
export function getTerminalSize(elements: Elements): BaseDimensions {
  const rect = elements.body.getBoundingClientRect()
  const screenStyle = window.getComputedStyle(elements.screen)
  const measuredRowHeight = elements.measure.getBoundingClientRect().height
  const computedLineHeight = Number.parseFloat(screenStyle.lineHeight)
  const computedFontSize = Number.parseFloat(screenStyle.fontSize)
  const terminalRowHeight = measuredRowHeight || computedLineHeight || computedFontSize || 16
  const terminalColumns = terminalCharacterColumns(elements)
  const terminalRows = Math.floor(rect.height / terminalRowHeight)

  return {
    numCols: Math.max(
      0,
      Math.floor(
        (terminalColumns - viewport.terminalHeightInset) /
          viewport.terminalHeightScale,
      ),
    ),
    numRows: Math.max(
      0,
      Math.floor(
        (terminalRows - viewport.terminalWidthInset) / viewport.terminalWidthScale,
      ),
    ),
  }
}
