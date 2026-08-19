import { beforeEach, describe, expect, it, vi } from "vitest"

import type * as FallbackPolicy from "./app/fallback-policy"

const pageChrome = {
  applyPageText: vi.fn(),
  applyPageVersion: vi.fn(),
  initTopMenus: vi.fn(),
}

// These tests verify that the entrypoint boots only on pages that expose a game host.
describe("tapoo entrypoint", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.doMock("./page-chrome", () => pageChrome)
    delete document.body.dataset.tapooControlMode
  })

  it("boots the game on import", async () => {
    const runtime = {
      dispatch: vi.fn(),
      mode: "interactive",
      persistSnapshot: vi.fn(),
    }
    const bootstrapGame = vi.fn(() => runtime)
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

  it("uses the agent-api page mode when configured in html", async () => {
    const bootstrapGame = vi.fn(() => ({
      dispatch: vi.fn(),
      mode: "agent-api",
      persistSnapshot: vi.fn(),
    }))
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

  it("does not persist the active runtime after a later invariant failure", async () => {
    const failure = new Error("agent move dispatch must return feedback")
    const runtime = {
      dispatch: vi.fn(),
      mode: "agent-api",
      persistSnapshot: vi.fn(),
    }
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
      bootstrapGame: vi.fn(() => runtime),
    }))

    document.body.dataset.tapooControlMode = "agent-api"

    await import("./tapoo")
    window.dispatchEvent(new ErrorEvent("error", { error: failure }))

    expect(runtime.persistSnapshot).not.toHaveBeenCalled()
    expect(showPlaceholderArt).toHaveBeenCalledWith("agent-api", failure)
  })
})
