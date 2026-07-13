import { createAgentMode } from "./app/control/agent"
import { createInteractiveMode } from "./app/control/interactive"
import { getGameElements } from "./app/dom"
import { bootstrapGame } from "./app/game"
import type { Elements, MazeControlMode } from "./app/types"

// pageControlMode selects the control implementation declared by the page shell.
function pageControlMode(elements: Elements): MazeControlMode {
  const configuredMode = document.body.dataset.tapooControlMode
  return configuredMode === "agent-api"
    ? createAgentMode(elements)
    : createInteractiveMode(elements)
}

const elements = getGameElements()

if (elements) {
  const mode = pageControlMode(elements)
  bootstrapGame(mode, elements)
}
