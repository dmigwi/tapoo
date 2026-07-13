import { describe, expect, it, vi } from "vitest"

import { createAgentMode } from "./agent"

// These tests lock down the lightweight agent-mode contract before transport wiring exists.
describe("agent control mode", () => {
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
    const mode = createAgentMode(elements)

    expect(mode.name).toBe("agent-api")
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
