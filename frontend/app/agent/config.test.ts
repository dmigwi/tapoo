import { describe, expect, it } from "vitest"

import {
  agentConfigValidationError,
  isValidAgentEndpoint,
  normalizeAgentEndpoint,
} from "./config"
import { CONFIG } from "../config"
import type { AgentApiConfig } from "../types"

function agent(playerName: string): AgentApiConfig {
  return {
    id: 1,
    playerName,
    model: "llama3.2",
    endpoint: new URL("https://agents.example/move"),
    enabled: true,
  }
}

// Agent-config tests keep form validation separate from the larger agent control mode.
describe("agent config", () => {
  it("accepts HTTP, HTTPS, and host-port shorthand endpoints", () => {
    expect(isValidAgentEndpoint("https://agents.example/move")).toBe(true)
    expect(isValidAgentEndpoint("http://localhost:8787/move")).toBe(true)
    expect(isValidAgentEndpoint("localhost:5000")).toBe(true)
    expect(isValidAgentEndpoint("123.34.56.89:5000")).toBe(true)
    expect(isValidAgentEndpoint("/agents/move")).toBe(false)
    expect(isValidAgentEndpoint("ftp://agents.example/move")).toBe(false)
    expect(isValidAgentEndpoint("not a url")).toBe(false)
  })

  it("normalizes host-port shorthand into fetch-safe absolute endpoints", () => {
    expect(normalizeAgentEndpoint("localhost:5000")?.href).toBe("http://localhost:5000/")
    expect(normalizeAgentEndpoint("123.34.56.89:5000")?.href).toBe(
      "http://123.34.56.89:5000/",
    )
    expect(normalizeAgentEndpoint("https://agents.example/move")?.href).toBe(
      "https://agents.example/move",
    )
    expect(normalizeAgentEndpoint("ftp://agents.example/move")).toBeNull()
  })

  it("returns the first form validation error in user-friendly order", () => {
    expect(
      agentConfigValidationError({
        endpoint: "",
        existingAgents: [],
        model: "llama3.2",
        playerName: "Blue",
      }),
    ).toBe(CONFIG.agentConfig.invalidMessage)

    expect(
      agentConfigValidationError({
        endpoint: "https://agents.example/move",
        existingAgents: [],
        model: "llama3.2",
        playerName: "TooLongName",
      }),
    ).toBe(CONFIG.agentConfig.playerNameLengthMessage)

    expect(
      agentConfigValidationError({
        endpoint: "https://agents.example/move",
        existingAgents: [agent("Scout")],
        model: "llama3.2",
        playerName: " scout ",
      }),
    ).toBe(CONFIG.agentConfig.duplicatePlayerNameMessage)

    expect(
      agentConfigValidationError({
        endpoint: "/agents/scout/move",
        existingAgents: [],
        model: "llama3.2",
        playerName: "Scout",
      }),
    ).toBe(CONFIG.agentConfig.invalidEndpointMessage)
  })

})
