import { CONFIG } from "../config"
import type { AgentApiConfig, AgentApiProvider } from "../types"

const { agentConfig } = CONFIG

type AgentConfigValidationInput = {
  endpoint: string
  existingAgents: AgentApiConfig[]
  model: string
  playerName: string
  api: AgentApiProvider
  credential: string
  apiVersion: string
}

// AGENT_API_PROVIDERS keeps provider iteration ordered and type-safe, the same role WALL_WEIGHTS
// plays for wall styles (config.ts) — derived from the same object the dropdown's option labels come
// from, so the two can never fall out of sync.
export const AGENT_API_PROVIDERS = Object.keys(agentConfig.providerLabels) as AgentApiProvider[]

// isAgentApiProvider validates a provider restored from storage or read from the form.
export function isAgentApiProvider(value: unknown): value is AgentApiProvider {
  return typeof value === "string" && AGENT_API_PROVIDERS.includes(value as AgentApiProvider)
}

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

// isValidAgentEndpoint accepts HTTP(S) URLs plus host:port shorthand such as localhost:5000/move —
// but only once a real request path is included. A bare host or host:port normalizes to a URL
// whose pathname is just "/", which is never a real provider route, so it is rejected here rather
// than silently guessed at submit time: the user must type the actual path themselves.
export function isValidAgentEndpoint(endpoint: string): boolean {
  const normalized = normalizeAgentEndpoint(endpoint)
  return normalized !== null && normalized.pathname !== "/"
}

// agentConfigValidationError returns the first user-facing validation error for the add-agent form.
export function agentConfigValidationError({
  endpoint,
  existingAgents,
  model,
  playerName,
  api,
  credential,
  apiVersion,
}: AgentConfigValidationInput): string | null {
  if (!playerName || !model || !endpoint) {
    return agentConfig.invalidMessage
  }

  // Defensive, not merely decorative: api is typed as AgentApiProvider (types.ts), but that only
  // binds at compile time. isAgentApiProvider's actual source of truth at runtime is
  // agentConfig.providerLabels (config.ts) — the two are supposed to list the same providers, but
  // nothing enforces that beyond convention. If a provider is ever added to one without the other,
  // this is what catches the mismatch, rather than letting it flow into a persisted agent record
  // nothing downstream recognizes.
  if (!isAgentApiProvider(api)) {
    return agentConfig.invalidApiMessage
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

  // Unlike Ollama/OpenAI, where an empty credential just means "send no auth header" against a
  // trusted local server, Anthropic's hosted API rejects every request without one — so the
  // asterisk shown next to those two fields for Anthropic must actually be enforced here.
  if (api === "anthropic" && (!credential || !apiVersion)) {
    return agentConfig.invalidAnthropicCredentialsMessage
  }

  return null
}
