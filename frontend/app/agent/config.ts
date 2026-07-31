import { CONFIG } from "../config"
import type { AgentApiConfig } from "../types"

const { agentConfig } = CONFIG

type AgentConfigValidationInput = {
  endpoint: string
  existingAgents: AgentApiConfig[]
  model: string
  playerName: string
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
