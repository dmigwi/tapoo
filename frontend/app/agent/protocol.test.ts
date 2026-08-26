import { describe, expect, it } from "vitest"

import {
  endpointLabel,
  normalizeToolArguments,
  parseAgentPrediction,
  parseExtraHeaders,
  previewLoggedMessage,
  previewLoggedTool,
  serializeToolResult,
} from "./protocol"
import { checksumLoggedDescription } from "../logs"
import type { AgentChatMessage, AgentToolDefinition } from "../types"

// Agent-config tests keep form validation separate from the larger agent control mode.
describe("agent protocol", () => {
  it("formats endpoint labels without query strings", () => {
    expect(endpointLabel(new URL("https://agents.example/move?token=secret"))).toBe(
      "https://agents.example/move",
    )
  })

  it("parses multi-line \"Key: Value\" text into a headers object", () => {
    expect(parseExtraHeaders("anthropic-version: 2023-06-01\nX-Wait-For-Model: true")).toEqual({
      "anthropic-version": "2023-06-01",
      "X-Wait-For-Model": "true",
    })
  })

  it("treats undefined or empty input as no headers", () => {
    expect(parseExtraHeaders(undefined)).toEqual({})
    expect(parseExtraHeaders("")).toEqual({})
  })

  it("skips blank lines and lines without a colon, rather than throwing", () => {
    expect(parseExtraHeaders("X-A: 1\n\nnot-a-header\nX-B: 2")).toEqual({
      "X-A": "1",
      "X-B": "2",
    })
  })

  it("splits only on the first colon, so a value containing one survives intact", () => {
    expect(parseExtraHeaders("X-Endpoint: https://example.com/path")).toEqual({
      "X-Endpoint": "https://example.com/path",
    })
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

    const expectedChecksum = checksumLoggedDescription(staticMessage.content)

    expect(previewLoggedMessage(staticMessage, false)).toEqual({
      ...staticMessage,
      content_checksum: expectedChecksum,
      content: `${staticMessage.content?.slice(0, 25)}...`,
    })
    expect(previewLoggedMessage(staticMessage, true)).toEqual({
      ...staticMessage,
      content_checksum: expectedChecksum,
    })
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

    const expectedChecksum = checksumLoggedDescription(tool.function.description)

    expect(previewLoggedTool(tool, false)).toEqual({
      name: "get_status",
      description_checksum: expectedChecksum,
      description: `${tool.function.description.slice(0, 25)}...`,
    })
    expect(previewLoggedTool(tool, true)).toEqual({
      name: "get_status",
      description_checksum: expectedChecksum,
      description: tool.function.description,
    })
  })
})
