import { describe, expect, it } from "vitest"

import {
  agentConfigValidationError,
  contextWindowForArea,
  endpointLabel,
  isValidAgentEndpoint,
  normalizeAgentEndpoint,
  normalizeToolArguments,
  parseAgentPrediction,
  previewLoggedMessage,
  previewLoggedTool,
  serializeToolResult,
} from "./config"
import { CONFIG } from "../config"
import type { AgentApiConfig, AgentChatMessage, AgentToolDefinition } from "../types"

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

  it("formats endpoint labels without query strings", () => {
    expect(endpointLabel(new URL("https://agents.example/move?token=secret"))).toBe(
      "https://agents.example/move",
    )
  })

  it("scales context window size from maze area without dropping below the configured floor", () => {
    const { contextWindowFloor, contextWindowAreaMultiplier } = CONFIG.runtime.modelConfig
    expect(contextWindowForArea(0)).toBe(contextWindowFloor)
    expect(contextWindowForArea(contextWindowFloor)).toBe(
      contextWindowFloor * contextWindowAreaMultiplier,
    )
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

  it.each([
    ["bare json", "{\"moves\":[\"MoveRight\"]}", ["MoveRight"]],
    ["json fence", "```json\n{\"moves\":[\"MoveDown\"]}\n```", ["MoveDown"]],
    ["plain fence", "```\n{\"moves\":[\"MoveLeft\",\"MoveUp\"]}\n```", ["MoveLeft", "MoveUp"]],
    [
      "prose prefix with embedded json fence",
      [
        "Based on the current state:",
        "```json",
        "{\"moves\":[\"MoveLeft\",\"MoveDown\"]}",
        "```",
      ].join("\n"),
      ["MoveLeft", "MoveDown"],
    ],
    [
      "prose prefix with inline json",
      [
        "I should generally move toward the destination.",
        "{\"moves\":[\"MoveLeft\",\"MoveLeft\",\"MoveDown\"]}",
      ].join("\n"),
      ["MoveLeft", "MoveLeft", "MoveDown"],
    ],
  ])("parses valid predictions wrapped as %s", (_caseName, content, moves) => {
    expect(parseAgentPrediction(content)).toEqual(moves)
  })

  it.each([
    ["empty content", undefined],
    ["invalid json", "not-json"],
    ["missing moves", "{}"],
    ["empty moves", "{\"moves\":[]}"],
    ["unsupported move", "{\"moves\":[\"MoveSideways\"]}"],
  ])("rejects malformed predictions (%s)", (_caseName, content) => {
    expect(parseAgentPrediction(content)).toBeNull()
  })

  it("normalizes provider tool arguments and serializes tool results", () => {
    expect(normalizeToolArguments("{\"row\":1}")).toEqual({ row: 1 })
    expect(normalizeToolArguments("not-json")).toBe("not-json")
    expect(normalizeToolArguments(undefined)).toEqual({})
    expect(serializeToolResult({ ok: true })).toBe("{\"ok\":true}")
    expect(serializeToolResult("already serialized")).toBe("already serialized")
  })

  it("previews static request diagnostics while keeping request-specific messages intact", () => {
    const staticMessage: AgentChatMessage = {
      role: "system",
      content: "This prompt is intentionally long enough to preview.",
    }
    const assistantMessage: AgentChatMessage = {
      role: "assistant",
      content: "This content stays complete.",
    }

    expect(previewLoggedMessage(staticMessage, false)).toEqual({
      ...staticMessage,
      content: `${staticMessage.content?.slice(0, 25)}...`,
    })
    expect(previewLoggedMessage(staticMessage, true)).toEqual(staticMessage)
    expect(previewLoggedMessage(assistantMessage, false)).toEqual(assistantMessage)
  })

  it("previews tool descriptions while preserving tool names", () => {
    const tool: AgentToolDefinition = {
      type: "function",
      function: {
        name: "get_status",
        description: "This description is intentionally long enough to preview.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    }

    expect(previewLoggedTool(tool, false)).toEqual({
      name: "get_status",
      description: `${tool.function.description.slice(0, 25)}...`,
    })
    expect(previewLoggedTool(tool, true)).toEqual({
      name: "get_status",
      description: tool.function.description,
    })
  })
})
