import { createAgentMode } from "./app/control/agent"
import { createInteractiveMode } from "./app/control/interactive"
import { CONFIG } from "./app/config"
import { getGameElements } from "./app/dom"
import { prepareTerminalAppForBootstrap, showPlaceholderArt } from "./app/fallback-policy"
import { initTapooLogs, tapooDownloadLogs, tapooResetLogs } from "./app/logs"
import { bootstrapGame } from "./app/game"
import type { Elements, MazeActionControl, MazeControlModeName } from "./app/types"

// pageControlMode chooses the MazeActionControl implementation declared by the page shell.
function pageControlMode(elements: Elements): MazeActionControl {
  return pageModeName() === CONFIG.runtime.controlModes.agentApi
    ? createAgentMode(elements)
    : createInteractiveMode(elements)
}

// pageModeName reads the control mode from the page dataset, defaulting to interactive.
function pageModeName(): MazeControlModeName {
  const agentApiMode = CONFIG.runtime.controlModes.agentApi
  return document.body.dataset.tapooControlMode === agentApiMode ? agentApiMode : CONFIG.runtime.controlModes.interactive
}

// tapooDownloadLogs and tapooResetLogs are attached without the __ prefix so the build's
// --mangle-props=^__ rule does not rename them; they remain callable from DevTools console.
;(window as unknown as Record<string, unknown>)["tapooDownloadLogs"] = () => tapooDownloadLogs(pageModeName())
;(window as unknown as Record<string, unknown>)["tapooResetLogs"] = () => tapooResetLogs(pageModeName())

window.addEventListener("error", (event) => {
  showPlaceholderArt(pageModeName(), event.error)
})

window.addEventListener("unhandledrejection", (event) => {
  showPlaceholderArt(pageModeName(), event.reason)
})

try {
  const elements = getGameElements()

  if (elements) {
    const mode = pageControlMode(elements)
    initTapooLogs(mode.name)
    prepareTerminalAppForBootstrap()
    bootstrapGame(mode, elements)
  }
} catch (error) {
  showPlaceholderArt(pageModeName(), error)
}
