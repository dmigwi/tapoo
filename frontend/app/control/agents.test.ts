import { describe, expect, it, vi } from "vitest"

import { createAgentsMode } from "./agents"

// These tests lock down the lightweight agent-mode contract before transport wiring exists.
describe("agents control mode", () => {
  it("implements the shared control mode contract", () => {
    const elements = {
      app: document.createElement("div"),
      body: document.createElement("div"),
      controls: [],
      measure: document.createElement("div"),
      screen: document.createElement("div"),
      touchButtons: [],
      touchControls: document.createElement("div"),
    }
    const dispatch = vi.fn()
    const mode = createAgentsMode(elements)

    expect(mode.name).toBe("agents")
    expect(mode.expectsCommandFeedback()).toBe(true)
    expect(mode.getLastCommandFeedback()).toBeNull()

    expect(() => mode.attach(dispatch)).not.toThrow()
    mode.receiveCommandFeedback({
      command: "pause",
      level: 4,
      message: "Paused the current round.",
      ok: true,
      score: 700,
      status: "paused",
      wallWeight: 2,
    })
    expect(mode.getLastCommandFeedback()).toEqual({
      command: "pause",
      level: 4,
      message: "Paused the current round.",
      ok: true,
      score: 700,
      status: "paused",
      wallWeight: 2,
    })
    expect(() => mode.detach()).not.toThrow()
  })
})
