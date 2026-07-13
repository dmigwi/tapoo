import { beforeEach, describe, expect, it, vi } from "vitest"

// These tests verify that the entrypoint boots only on pages that expose a game host.
describe("tapoo entrypoint", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("boots the game on import", async () => {
    const bootstrapGame = vi.fn()
    const getGameElements = vi.fn(() => ({ app: {} }))
    const keyboardMode = { attach: vi.fn(), detach: vi.fn(), name: "keyboard" }

    document.body.dataset.tapooControlMode = "keyboard"

    vi.doMock("./app/dom", () => ({ getGameElements }))
    vi.doMock("./app/control/keyboard", () => ({
      createKeyboardMode: vi.fn(() => keyboardMode),
    }))
    vi.doMock("./app/control/agents", () => ({
      createAgentsMode: vi.fn(),
    }))
    vi.doMock("./app/game", () => ({ bootstrapGame }))

    await import("./tapoo")

    expect(bootstrapGame).toHaveBeenCalledTimes(1)
    expect(bootstrapGame).toHaveBeenCalledWith(keyboardMode, { app: {} })
  })

  it("uses the agents page mode when configured in html", async () => {
    const bootstrapGame = vi.fn()
    const elements = { app: {} }
    const agentsMode = { attach: vi.fn(), detach: vi.fn(), name: "agents" }

    document.body.dataset.tapooControlMode = "agents"

    vi.doMock("./app/dom", () => ({ getGameElements: vi.fn(() => elements) }))
    vi.doMock("./app/control/keyboard", () => ({
      createKeyboardMode: vi.fn(),
    }))
    vi.doMock("./app/control/agents", () => ({
      createAgentsMode: vi.fn(() => agentsMode),
    }))
    vi.doMock("./app/game", () => ({ bootstrapGame }))

    await import("./tapoo")

    expect(bootstrapGame).toHaveBeenCalledWith(agentsMode, elements)
  })

  it("does not boot the game bundle on pages without a terminal host", async () => {
    const bootstrapGame = vi.fn()

    vi.doMock("./app/dom", () => ({ getGameElements: vi.fn(() => null) }))
    vi.doMock("./app/game", () => ({ bootstrapGame }))

    await import("./tapoo")

    expect(bootstrapGame).not.toHaveBeenCalled()
  })
})
