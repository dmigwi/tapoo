// Protocol helpers for the agent-api wire format: request sizing, response parsing, tool-call
// argument/result marshalling, and the log previews applied to outbound payloads. Kept apart from
// config.ts, which validates the agent records a human configures rather than anything on the wire.
import { checksumLoggedDescription, trimLoggedDescription } from "../logs"
import { isMoveAction } from "../traversal"
import type {
  AgentChatMessage,
  AgentToolDefinition,
  MazeAction,
  MoveAction,
} from "../types"

type AgentPredictionPayload = { moves?: unknown }

// endpointLabel keeps diagnostics readable while avoiding noisy query strings.
export function endpointLabel(endpoint: URL): string {
  return `${endpoint.origin}${endpoint.pathname}`
}

// parseExtraHeaders turns an agent's raw "Key: Value" textarea input into a headers object. Each
// line is one header; a line with no ":" or an empty key is skipped rather than throwing, since
// this runs on every request and a stray blank line or typo shouldn't fail the whole turn. Only
// the first ":" splits key from value, so a value that itself contains one (e.g. a URL) survives.
export function parseExtraHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) {
    return {}
  }

  const headers: Record<string, string> = {}
  for (const line of raw.split("\n")) {
    const separatorIndex = line.indexOf(":")
    if (separatorIndex === -1) {
      continue
    }

    const key = line.slice(0, separatorIndex).trim()
    const value = line.slice(separatorIndex + 1).trim()
    if (key) {
      headers[key] = value
    }
  }

  return headers
}

// stripMarkdownFence removes optional ```json or ``` wrappers that models add despite instructions.
function stripMarkdownFence(content: string): string {
  return content.replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/s, "$1").trim()
}

// extractFencedJson finds a fenced JSON block even when prose surrounds it.
function extractFencedJson(content: string): string | null {
  const match = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/s)
  return match ? match[1].trim() : null
}

// extractEmbeddedJson uses the final object-looking segment when a model prefixes reasoning.
function extractEmbeddedJson(content: string): string | null {
  const start = content.lastIndexOf("{")
  return start === -1 ? null : content.slice(start).trim()
}

// parseAgentPrediction extracts the single supported prediction payload from final model content.
export function parseAgentPrediction(content: string | undefined): MoveAction[] | null {
  if (!content) {
    return null
  }

  const isPredictedMove = (move: unknown): move is MoveAction => {
    return typeof move === "string" && isMoveAction({ type: move } as MazeAction)
  }

  const candidates = [stripMarkdownFence(content), extractFencedJson(content), extractEmbeddedJson(content)]
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      const { moves } = JSON.parse(candidate) as AgentPredictionPayload
      if (Array.isArray(moves) && moves.length > 0 && moves.every(isPredictedMove)) {
        return [...moves]
      }
    } catch {
      // Try the next extraction strategy.
    }
  }

  return null
}

// normalizeToolArguments accepts object arguments and provider variants that encode them as JSON.
export function normalizeToolArguments(args: unknown): unknown {
  if (typeof args !== "string") {
    return args ?? {}
  }

  try {
    return JSON.parse(args) as unknown
  } catch {
    return args
  }
}

// serializeToolResult keeps all tool responses in the string form expected by chat APIs.
export function serializeToolResult(result: unknown): string {
  return typeof result === "string" ? result : JSON.stringify(result)
}

// previewLoggedMessage trims only static prompt messages; request-specific context stays intact. The
// checksum is computed from the original, untrimmed content, so it stays stable across both the
// keepFull and preview cases and lets a downloaded log prove the content didn't drift mid-experiment
// or between games.
export function previewLoggedMessage(
  message: AgentChatMessage,
  keepFull: boolean,
): AgentChatMessage & { content_checksum?: string } {
  if (message.role !== "system" && message.role !== "user") {
    return message
  }

  return {
    ...message,
    content_checksum: checksumLoggedDescription(message.content),
    content: trimLoggedDescription(message.content, keepFull),
  }
}

// previewLoggedTool trims repeated tool descriptions while preserving short tool names. Same checksum
// rationale as previewLoggedMessage above.
export function previewLoggedTool(
  tool: object,
  keepFull: boolean,
): { name: string; description_checksum?: string; description: string | undefined } {
  const { function: fn } = tool as AgentToolDefinition
  return {
    name: fn.name,
    description_checksum: checksumLoggedDescription(fn.description),
    description: trimLoggedDescription(fn.description, keepFull),
  }
}
