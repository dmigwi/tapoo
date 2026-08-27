import { createAgentMode } from "./app/control/agent"
import { createInteractiveMode } from "./app/control/interactive"
import { CONFIG } from "./app/config"
import { getGameElements } from "./app/dom"
import { prepareTerminalAppForBootstrap, showPlaceholderArt } from "./app/fallback-policy"
import { initTapooLogs, tapooDownloadLogs, tapooResetLogs } from "./app/logs"
import { bootstrapGame } from "./app/game"
import { requireStaleDataAcknowledgement } from "./app/consent-gates"
import { applyPageText, applyPageVersion, initTopMenus } from "./page-chrome"
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
  applyPageText()
  applyPageVersion()
  initTopMenus()
} catch (error) {
  showPlaceholderArt(pageModeName(), error)
}

try {
  const elements = getGameElements()

  if (elements) {
    const mode = pageControlMode(elements)
    // Only swaps which page view is visible. Until it runs the visible view is the "page is not
    // available" placeholder, and layering a consent prompt on that would read as a failure - so
    // the terminal shell is shown first and the gate sits over it. The game itself does not start
    // until startGame runs, which is what the gate actually holds back.
    prepareTerminalAppForBootstrap()

    // initTapooLogs seeds from sessionStorage, so it waits with the rest: nothing reads storage
    // until any acknowledgement resolves.
    //
    // startGame carries its own fallback because it can run from a click handler, and a throw
    // there escapes the try/catch around this block - the browser routes it to window.onerror
    // instead. Wrapping here rather than inside the gate keeps one definition of failure handling
    // for both the gated and ungated paths.
    const startGame = (): void => {
      try {
        initTapooLogs(mode.name)
        bootstrapGame(mode, elements)
      } catch (error) {
        showPlaceholderArt(pageModeName(), error)
      }
    }

    requireStaleDataAcknowledgement(elements, startGame)
  }
} catch (error) {
  showPlaceholderArt(pageModeName(), error)
}
