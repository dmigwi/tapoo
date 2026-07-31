import { CONFIG } from "../config"
import { trimLoggedDescription } from "../logs"
import { isMoveAction } from "../traversal"
import type {
  AgentApiConfig,
  AgentChatMessage,
  AgentToolDefinition,
  MazeAction,
  MoveAction,
} from "../types"

const { agentConfig } = CONFIG

type AgentConfigValidationInput = {
  endpoint: string
  existingAgents: AgentApiConfig[]
  model: string
  playerName: string
}

type AgentPredictionPayload = { moves?: unknown }

// normalizeAgentEndpoint makes host:port shorthand usable by browser fetch while keeping HTTP(S) explicit.
export function normalizeAgentEndpoint(endpoint: string): URL | null {
  const trimmedEndpoint = endpoint.trim()
  const hostPortEndpoint =/^(localhost|(?:\d{1,3}\.){3}\d{1,3})(?::\d+)(?:\/.*)?$/i.test(trimmedEndpoint)
  const hasProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmedEndpoint)
  if (!hostPortEndpoint && !hasProtocol) {
    return null
  }

  const endpointWithProtocol = hostPortEndpoint ? `http://${trimmedEndpoint}` : trimmedEndpoint

  try {
    const url = new URL(endpointWithProtocol)
    return url.protocol === "http:" || url.protocol === "https:" ? url : null
  } catch {
    return null
  }
}

// isValidAgentEndpoint accepts HTTP(S) URLs plus host:port shorthand such as localhost:5000.
export function isValidAgentEndpoint(endpoint: string): boolean {
  return normalizeAgentEndpoint(endpoint) !== null
}

// agentConfigValidationError returns the first user-facing validation error for the add-agent form.
export function agentConfigValidationError({
  endpoint,
  existingAgents,
  model,
  playerName,
}: AgentConfigValidationInput): string | null {
  if (!playerName || !model || !endpoint) {
    return agentConfig.invalidMessage
  }

  if (
    playerName.length < agentConfig.playerNameMinLength ||
    playerName.length > agentConfig.playerNameMaxLength
  ) {
    return agentConfig.playerNameLengthMessage
  }

  const existingPlayerName = existingAgents.some(
    (agent) => agent.playerName.trim().toLowerCase() === playerName.trim().toLowerCase(),
  )
  if (existingPlayerName) {
    return agentConfig.duplicatePlayerNameMessage
  }

  if (!isValidAgentEndpoint(endpoint)) {
    return agentConfig.invalidEndpointMessage
  }

  return null
}

// endpointLabel keeps diagnostics readable while avoiding noisy query strings.
export function endpointLabel(endpoint: URL): string {
  return `${endpoint.origin}${endpoint.pathname}`
}

// contextWindowForArea scales context room as mazes and traversal histories grow.
export function contextWindowForArea(area: number): number {
  const { contextWindowFloor, contextWindowAreaMultiplier } = CONFIG.runtime.modelConfig
  return Math.max(contextWindowFloor, area * contextWindowAreaMultiplier)
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

// previewLoggedMessage trims only static prompt messages; request-specific context stays intact.
export function previewLoggedMessage(message: AgentChatMessage, keepFull: boolean): AgentChatMessage {
  if (message.role !== "system" && message.role !== "user") {
    return message
  }

  return { ...message, content: trimLoggedDescription(message.content, keepFull) }
}

// previewLoggedTool trims repeated tool descriptions while preserving short tool names.
export function previewLoggedTool(
  tool: object,
  keepFull: boolean,
): { name: string; description: string | undefined } {
  const { function: fn } = tool as AgentToolDefinition
  return { name: fn.name, description: trimLoggedDescription(fn.description, keepFull) }
}
