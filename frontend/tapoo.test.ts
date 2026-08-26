import { beforeEach, describe, expect, it, vi } from "vitest"

import type * as FallbackPolicy from "./app/fallback-policy"

const pageChrome = {
  applyPageText: vi.fn(),
  applyPageVersion: vi.fn(),
  initTopMenus: vi.fn(),
}

// createMemoryStorage mirrors storage.test.ts's stub: this jsdom config exposes no real
// localStorage, and the entrypoint now reads storage to decide whether the info gate is needed.
function createMemoryStorage(): Storage {
  const values = new Map<string, string>()

  return {
    get length() {
      return values.size
    },
    clear() {
      values.clear()
    },
    getItem(key) {
      return values.get(key) ?? null
    },
    key(index) {
      return Array.from(values.keys())[index] ?? null
    },
    removeItem(key) {
      values.delete(key)
    },
    setItem(key, value) {
      values.set(key, value)
    },
  }
}

// These tests verify that the entrypoint boots only on pages that expose a game host.
describe("tapoo entrypoint", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.doMock("./page-chrome", () => pageChrome)
    delete document.body.dataset.tapooControlMode
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createMemoryStorage(),
    })
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: createMemoryStorage(),
    })
  })

  it("boots the game on import", async () => {
    const bootstrapGame = vi.fn()
    const getGameElements = vi.fn(() => ({ app: {} }))
    const showPlaceholderArt = vi.fn()
    const prepareTerminalAppForBootstrap = vi.fn()
    const interactiveMode = {
      bindActionDispatch: vi.fn(),
      clearActionState: vi.fn(),
      name: "interactive",
      readLastActionState: vi.fn(),
      recordActionState: vi.fn(),
    }

    document.body.dataset.tapooControlMode = "interactive"

    vi.doMock("./app/dom", () => ({ getGameElements }))
    vi.doMock("./app/fallback-policy", async () => {
      const actual = await vi.importActual<typeof FallbackPolicy>("./app/fallback-policy")
      return { ...actual, prepareTerminalAppForBootstrap, showPlaceholderArt }
    })
    vi.doMock("./app/control/interactive", () => ({
      createInteractiveMode: vi.fn(() => interactiveMode),
    }))
    vi.doMock("./app/control/agent", () => ({
      createAgentMode: vi.fn(),
    }))
    vi.doMock("./app/game", () => ({ bootstrapGame }))

    await import("./tapoo")

    expect(bootstrapGame).toHaveBeenCalledTimes(1)
    expect(bootstrapGame).toHaveBeenCalledWith(interactiveMode, { app: {} })
    expect(pageChrome.applyPageText).toHaveBeenCalledTimes(1)
    expect(pageChrome.applyPageVersion).toHaveBeenCalledTimes(1)
    expect(pageChrome.initTopMenus).toHaveBeenCalledTimes(1)
    expect(pageChrome.initTopMenus.mock.invocationCallOrder[0]).toBeLessThan(
      bootstrapGame.mock.invocationCallOrder[0],
    )
    expect(prepareTerminalAppForBootstrap.mock.invocationCallOrder[0]).toBeLessThan(
      bootstrapGame.mock.invocationCallOrder[0],
    )
    expect(showPlaceholderArt).not.toHaveBeenCalled()
  })

  // mountGateScenario seeds stale keys, boots the entrypoint against real storage, and hands back
  // the nodes plus the mocks the assertions need. Shared so the singular and plural copy cases do
  // not duplicate ten lines of module mocking each.
  async function mountGateScenario(staleKeys: string[]): Promise<{
    infoGate: HTMLElement
    infoGateDetail: HTMLElement
    infoGateProceed: HTMLButtonElement
    bootstrapGame: ReturnType<typeof vi.fn>
    initTapooLogs: ReturnType<typeof vi.fn>
    prepareTerminalAppForBootstrap: ReturnType<typeof vi.fn>
  }> {
    for (const key of staleKeys) {
      window.localStorage.setItem(key, "old")
    }

    const infoGate = document.createElement("div")
    infoGate.hidden = true
    const infoGateDetail = document.createElement("p")
    const infoGateProceed = document.createElement("button")
    const elements = {
      app: {},
      infoGate,
      infoGateTitle: document.createElement("strong"),
      infoGateMessage: document.createElement("p"),
      infoGateDetail,
      infoGateProceed,
    }

    const bootstrapGame = vi.fn()
    const initTapooLogs = vi.fn()
    const prepareTerminalAppForBootstrap = vi.fn()
    const interactiveMode = {
      bindActionDispatch: vi.fn(),
      clearActionState: vi.fn(),
      name: "interactive",
      readLastActionState: vi.fn(),
      recordActionState: vi.fn(),
    }

    document.body.dataset.tapooControlMode = "interactive"

    vi.doMock("./app/dom", () => ({ getGameElements: vi.fn(() => elements) }))
    vi.doMock("./app/fallback-policy", async () => {
      const actual = await vi.importActual<typeof FallbackPolicy>("./app/fallback-policy")
      return { ...actual, prepareTerminalAppForBootstrap, showPlaceholderArt: vi.fn() }
    })
    vi.doMock("./app/control/interactive", () => ({
      createInteractiveMode: vi.fn(() => interactiveMode),
    }))
    vi.doMock("./app/control/agent", () => ({ createAgentMode: vi.fn() }))
    vi.doMock("./app/game", () => ({ bootstrapGame }))
    vi.doMock("./app/logs", () => ({
      initTapooLogs,
      tapooDownloadLogs: vi.fn(),
      tapooResetLogs: vi.fn(),
    }))

    await import("./tapoo")

    return {
      infoGate,
      infoGateDetail,
      infoGateProceed,
      bootstrapGame,
      initTapooLogs,
      prepareTerminalAppForBootstrap,
    }
  }

  // The point of the whole change: an upgrade must not start the game, or delete anything, until
  // the user has acknowledged that leftover data is about to go.
  it("holds the game behind the info gate while stale storage exists", async () => {
    const staleKey = "tapoo.v0.1.interactive.gameSetup"
    const scenario = await mountGateScenario([staleKey])

    // The terminal shell is revealed so the gate has something to sit over, but the game itself
    // has not started and the stale entry is untouched.
    expect(scenario.prepareTerminalAppForBootstrap).toHaveBeenCalledTimes(1)
    expect(scenario.infoGate.hidden).toBe(false)
    expect(scenario.bootstrapGame).not.toHaveBeenCalled()
    expect(scenario.initTapooLogs).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(staleKey)).toBe("old")

    scenario.infoGateProceed.click()

    expect(window.localStorage.getItem(staleKey)).toBeNull()
    expect(scenario.bootstrapGame).toHaveBeenCalledTimes(1)
    expect(scenario.initTapooLogs).toHaveBeenCalledTimes(1)
    expect(scenario.infoGate.hidden).toBe(true)
  })

  it("uses the agent-api page mode when configured in html", async () => {
    const bootstrapGame = vi.fn()
    const elements = { app: {} }
    const showPlaceholderArt = vi.fn()
    const agentMode = {
      bindActionDispatch: vi.fn(),
      clearActionState: vi.fn(),
      name: "agent-api",
      readLastActionState: vi.fn(),
      recordActionState: vi.fn(),
    }

    document.body.dataset.tapooControlMode = "agent-api"

    vi.doMock("./app/dom", () => ({
      getGameElements: vi.fn(() => elements),
    }))
    vi.doMock("./app/fallback-policy", async () => {
      const actual = await vi.importActual<typeof FallbackPolicy>("./app/fallback-policy")
      return { ...actual, showPlaceholderArt }
    })
    vi.doMock("./app/control/interactive", () => ({
      createInteractiveMode: vi.fn(),
    }))
    vi.doMock("./app/control/agent", () => ({
      createAgentMode: vi.fn(() => agentMode),
    }))
    vi.doMock("./app/game", () => ({ bootstrapGame }))

    await import("./tapoo")

    expect(bootstrapGame).toHaveBeenCalledWith(agentMode, elements)
    expect(showPlaceholderArt).not.toHaveBeenCalled()
  })

  it("does not boot the game runtime on pages without a terminal host", async () => {
    const bootstrapGame = vi.fn()
    const showPlaceholderArt = vi.fn()

    vi.doMock("./app/dom", () => ({
      getGameElements: vi.fn(() => null),
    }))
    vi.doMock("./app/fallback-policy", async () => {
      const actual = await vi.importActual<typeof FallbackPolicy>("./app/fallback-policy")
      return { ...actual, showPlaceholderArt }
    })
    vi.doMock("./app/game", () => ({ bootstrapGame }))

    await import("./tapoo")

    expect(bootstrapGame).not.toHaveBeenCalled()
    expect(showPlaceholderArt).not.toHaveBeenCalled()
  })

  it("shows placeholder art when bootstrap throws an unknown Error", async () => {
    const failure = new Error("unexpected bootstrap failure")
    const showPlaceholderArt = vi.fn()

    vi.doMock("./app/dom", () => ({
      getGameElements: vi.fn(() => ({ app: {} })),
    }))
    vi.doMock("./app/fallback-policy", async () => {
      const actual = await vi.importActual<typeof FallbackPolicy>("./app/fallback-policy")
      return { ...actual, showPlaceholderArt }
    })
    vi.doMock("./app/control/interactive", () => ({
      createInteractiveMode: vi.fn(() => ({
        name: "interactive",
      })),
    }))
    vi.doMock("./app/control/agent", () => ({
      createAgentMode: vi.fn(),
    }))
    vi.doMock("./app/game", () => ({
      bootstrapGame: vi.fn(() => {
        throw failure
      }),
    }))

    await import("./tapoo")

    expect(showPlaceholderArt).toHaveBeenCalledWith("interactive", failure)
  })

  it("shows placeholder art when bootstrap throws a known fallback Error", async () => {
    const failure = new Error("missing required element: terminal-body")
    const showPlaceholderArt = vi.fn()

    vi.doMock("./app/dom", () => ({
      getGameElements: vi.fn(() => ({ app: {} })),
    }))
    vi.doMock("./app/fallback-policy", async () => {
      const actual = await vi.importActual<typeof FallbackPolicy>("./app/fallback-policy")
      return { ...actual, showPlaceholderArt }
    })
    vi.doMock("./app/control/interactive", () => ({
      createInteractiveMode: vi.fn(() => ({
        name: "interactive",
      })),
    }))
    vi.doMock("./app/control/agent", () => ({
      createAgentMode: vi.fn(),
    }))
    vi.doMock("./app/game", () => ({
      bootstrapGame: vi.fn(() => {
        throw failure
      }),
    }))

    await import("./tapoo")

    expect(showPlaceholderArt).toHaveBeenCalledWith("interactive", failure)
  })

  it("reports a later invariant failure through the placeholder art", async () => {
    const failure = new Error("agent move dispatch must return feedback")
    const showPlaceholderArt = vi.fn()

    vi.doMock("./app/dom", () => ({
      getGameElements: vi.fn(() => ({ app: {} })),
    }))
    vi.doMock("./app/fallback-policy", async () => {
      const actual = await vi.importActual<typeof FallbackPolicy>("./app/fallback-policy")
      return { ...actual, showPlaceholderArt }
    })
    vi.doMock("./app/control/interactive", () => ({
      createInteractiveMode: vi.fn(),
    }))
    vi.doMock("./app/control/agent", () => ({
      createAgentMode: vi.fn(() => ({
        name: "agent-api",
      })),
    }))
    vi.doMock("./app/game", () => ({
      bootstrapGame: vi.fn(),
    }))

    document.body.dataset.tapooControlMode = "agent-api"

    await import("./tapoo")
    window.dispatchEvent(new ErrorEvent("error", { error: failure }))

    expect(showPlaceholderArt).toHaveBeenCalledWith("agent-api", failure)
  })
})
