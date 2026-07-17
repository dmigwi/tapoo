import { createAgentMode } from "./app/control/agent"
import { createInteractiveMode } from "./app/control/interactive"
import { CONFIG } from "./app/config"
import { getGameElements } from "./app/dom"
import { showPlaceholderArt, showTerminalApp } from "./app/fallback-policy"
import { bootstrapGame } from "./app/game"
import type { Elements, MazeActionControl } from "./app/types"

// pageControlMode chooses the MazeActionControl implementation declared by the page shell.
function pageControlMode(elements: Elements): MazeActionControl {
  const configuredMode = document.body.dataset.tapooControlMode
  return configuredMode === CONFIG.runtime.controlModes.agentApi
    ? createAgentMode(elements)
    : createInteractiveMode(elements)
}

window.addEventListener("error", (event) => {
  showPlaceholderArt(event.error)
})

window.addEventListener("unhandledrejection", (event) => {
  showPlaceholderArt(event.reason)
})

try {
  const elements = getGameElements()

  if (elements) {
    const mode = pageControlMode(elements)
    bootstrapGame(mode, elements)
  }
} catch (error) {
  showTerminalApp()
  showPlaceholderArt(error)
}
