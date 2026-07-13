import { createAgentsMode } from "./app/control/agents"
import { createKeyboardMode } from "./app/control/keyboard"
import { getGameElements } from "./app/dom"
import { bootstrapGame } from "./app/game"
import type { Elements, MazeControlMode } from "./app/types"

// pageControlMode selects the control implementation declared by the page shell.
function pageControlMode(elements: Elements): MazeControlMode {
  const configuredMode = document.body.dataset.tapooControlMode
  return configuredMode === "agents" ? createAgentsMode(elements) : createKeyboardMode(elements)
}

const elements = getGameElements()

if (elements) {
  const mode = pageControlMode(elements)
  bootstrapGame(mode, elements)
}
