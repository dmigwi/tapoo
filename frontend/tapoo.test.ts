import { beforeEach, describe, expect, it, vi } from "vitest"

// These tests verify that the entrypoint boots only on pages that expose a game host.
describe("tapoo entrypoint", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("boots the game on import", async () => {
    const bootstrapGame = vi.fn()
    const getGameElements = vi.fn(() => ({ app: {} }))
    const interactiveMode = {
      bindActionDispatch: vi.fn(),
      name: "interactive",
      readLastActionState: vi.fn(),
      recordActionState: vi.fn(),
    }

    document.body.dataset.tapooControlMode = "interactive"

    vi.doMock("./app/dom", () => ({ getGameElements }))
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
  })

  it("uses the agent-api page mode when configured in html", async () => {
    const bootstrapGame = vi.fn()
    const elements = { app: {} }
    const agentMode = {
      bindActionDispatch: vi.fn(),
      name: "agent-api",
      readLastActionState: vi.fn(),
      recordActionState: vi.fn(),
    }

    document.body.dataset.tapooControlMode = "agent-api"

    vi.doMock("./app/dom", () => ({ getGameElements: vi.fn(() => elements) }))
    vi.doMock("./app/control/interactive", () => ({
      createInteractiveMode: vi.fn(),
    }))
    vi.doMock("./app/control/agent", () => ({
      createAgentMode: vi.fn(() => agentMode),
    }))
    vi.doMock("./app/game", () => ({ bootstrapGame }))

    await import("./tapoo")

    expect(bootstrapGame).toHaveBeenCalledWith(agentMode, elements)
  })

  it("does not boot the game bundle on pages without a terminal host", async () => {
    const bootstrapGame = vi.fn()

    vi.doMock("./app/dom", () => ({ getGameElements: vi.fn(() => null) }))
    vi.doMock("./app/game", () => ({ bootstrapGame }))

    await import("./tapoo")

    expect(bootstrapGame).not.toHaveBeenCalled()
  })
})
