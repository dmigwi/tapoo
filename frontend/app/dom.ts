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
    document.getElementById("touch-controls") instanceof HTMLElement
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
    touchButtons: Array.from(
      document.querySelectorAll<HTMLButtonElement>("[data-touch-control]"),
    ),
    agentSeatsBody: mustElement<HTMLElement>("agent-seats-body"),
    tapooLogsReset: mustElement<HTMLButtonElement>("tapoo-logs-reset"),
    tapooLogsDownload: mustElement<HTMLButtonElement>("tapoo-logs-download"),
    agentSeatRoster: mustElement<HTMLElement>("agent-seat-roster"),
    agentConfigForm: mustElement<HTMLFormElement>("agent-config-form"),
    agentConfigTitle: mustElement<HTMLElement>("agent-config-title"),
    agentConfigPlayerName: mustElement<HTMLInputElement>("agent-config-player-name"),
    agentConfigModel: mustElement<HTMLInputElement>("agent-config-model"),
    agentConfigApi: mustElement<HTMLSelectElement>("agent-config-api"),
    agentConfigEndpoint: mustElement<HTMLInputElement>("agent-config-endpoint"),
    agentConfigCredential: mustElement<HTMLInputElement>("agent-config-credential"),
    agentConfigCredentialLabel: mustElement<HTMLElement>("agent-config-credential-label"),
    agentConfigCredentialRequired: mustElement<HTMLElement>("agent-config-credential-required"),
    agentConfigExtraHeadersRows: mustElement<HTMLElement>("agent-config-extra-headers-rows"),
    agentConfigExtraHeadersAdd: mustElement<HTMLButtonElement>("agent-config-extra-headers-add"),
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
    agentManageEchoBackReasoning: mustElement<HTMLInputElement>("agent-manage-echo-back-reasoning"),
    agentManageEchoBackReasoningLabel: mustElement<HTMLElement>("agent-manage-echo-back-reasoning-label"),
    agentManageApply: mustElement<HTMLButtonElement>("agent-manage-apply"),
    agentDeleteConfirm: mustElement<HTMLInputElement>("agent-delete-confirm"),
    agentManageClose: mustElement<HTMLButtonElement>("agent-manage-close"),
  }
}

// getTerminalSize converts DOM measurements into logical maze dimensions.
export function getTerminalSize(elements: Elements): BaseDimensions {
  const rect = elements.body.getBoundingClientRect()
  const sampleRect = elements.measure.getBoundingClientRect()
  const screenStyle = window.getComputedStyle(elements.screen)
  const charWidth = sampleRect.width / viewport.terminalSampleWidth || 9
  const measuredRowHeight = sampleRect.height
  const computedLineHeight = Number.parseFloat(screenStyle.lineHeight)
  const computedFontSize = Number.parseFloat(screenStyle.fontSize)
  const terminalRowHeight = measuredRowHeight || computedLineHeight || computedFontSize || 16
  const terminalColumns = Math.floor(rect.width / charWidth)
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
