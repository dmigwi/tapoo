import { createAgentMode } from "./app/control/agent"
import { createInteractiveMode } from "./app/control/interactive"
import { getGameElements } from "./app/dom"
import { bootstrapGame } from "./app/game"
import type { Elements, MazeActionControl } from "./app/types"

// pageControlMode chooses the MazeActionControl implementation declared by the page shell.
function pageControlMode(elements: Elements): MazeActionControl {
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
