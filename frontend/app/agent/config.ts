import { CONFIG } from "../config"
import type { AgentApiConfig, AgentApiProvider, AgentReasoningEffort } from "../types"

const { agentConfig } = CONFIG

type AgentConfigValidationInput = {
  endpoint: string
  existingAgents: AgentApiConfig[]
  model: string
  playerName: string
  api: AgentApiProvider
  requestIntervalSeconds: string
  reasoningEffort: AgentReasoningEffort
  credential: string
  extraHeaders: string
}

type AgentRequestIntervalInput = {
  requestIntervalSeconds?: number
}

// EXTRA_HEADER_NAME_PATTERN matches a valid HTTP header field name per RFC 7230's token grammar:
// visible ASCII, no whitespace, none of the separator characters a real header name never
// contains. Catches a typo (a stray space, a colon typed into the key itself) at submit time
// rather than letting it reach fetch(), which throws a much less legible error mid-turn.
const EXTRA_HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

// extraHeaderKeysFrom reads only the keys out of the same raw "Key: Value" per line text
// parseExtraHeaders (agent/protocol.ts) parses at request time. Duplicated in miniature here
// rather than imported, so this leaf module doesn't pull in protocol.ts's heavier dependency
// chain (logs.ts, traversal.ts) just for form validation - storage.ts imports this file cheaply
// and has no reason to inherit that.
function extraHeaderKeysFrom(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => {
      const separatorIndex = line.indexOf(":")
      return separatorIndex === -1 ? "" : line.slice(0, separatorIndex).trim()
    })
    .filter((key) => key.length > 0)
}

// AGENT_API_PROVIDERS keeps provider iteration ordered and type-safe, the same role WALL_WEIGHTS
// plays for wall styles (config.ts) - derived from the same object the dropdown's option labels come
// from, so the two can never fall out of sync.
export const AGENT_API_PROVIDERS = Object.keys(agentConfig.providerLabels) as AgentApiProvider[]

// isAgentApiProvider validates a provider restored from storage or read from the form.
export function isAgentApiProvider(value: unknown): value is AgentApiProvider {
  return typeof value === "string" && AGENT_API_PROVIDERS.includes(value as AgentApiProvider)
}

// AGENT_REASONING_EFFORTS lists the full shared vocabulary across all three providers - see
// AGENT_API_PROVIDERS above for why this is derived rather than hand-listed.
export const AGENT_REASONING_EFFORTS = Object.keys(agentConfig.reasoningEffortLabels) as AgentReasoningEffort[]

// isAgentReasoningEffort validates a value restored from storage or read from the form against the
// full shared vocabulary - not yet against any one provider's narrower subset. Callers that need
// the provider-scoped check should also test membership in agentConfig.reasoningEffortOptions[api].
export function isAgentReasoningEffort(value: unknown): value is AgentReasoningEffort {
  return typeof value === "string" && AGENT_REASONING_EFFORTS.includes(value as AgentReasoningEffort)
}

export function defaultAgentApiRequestIntervalSeconds(): number {
  return CONFIG.timing.defaultAgentApiRequestIntervalSeconds
}

// hasValidAgentPlayerName enforces the compact player-name range shared by the config form and
// storage normalization, so a name rejected at submit time is the same one rejected on load.
export function hasValidAgentPlayerName(playerName: string): boolean {
  return (
    playerName.length >= agentConfig.playerNameMinLength &&
    playerName.length <= agentConfig.playerNameMaxLength
  )
}

export function parseAgentRequestIntervalSeconds(value: string): number | null {
  const trimmedValue = value.trim()
  if (!/^\d+$/.test(trimmedValue)) {
    return null
  }

  const seconds = Number(trimmedValue)
  return seconds >= agentConfig.requestIntervalMinSeconds &&
    seconds <= agentConfig.requestIntervalMaxSeconds
      ? seconds
      : null
}

export function agentRequestIntervalSeconds(input: AgentRequestIntervalInput): number {
  return input.requestIntervalSeconds ?? defaultAgentApiRequestIntervalSeconds()
}

export function agentRequestIntervalMs(input: AgentRequestIntervalInput): number {
  return agentRequestIntervalSeconds(input) * 1_000
}

// describeProviderHttpFailure augments a raw HTTP status with the small amount of agent-provider
// interpretation that repeated logs have proven useful. It stays here so request code does not
// need to know provider-specific failure patterns or operational quirks. Classified on status
// alone: response bodies for these failures vary too much by provider to match reliably (e.g. the
// 429 body Tapoo has actually seen for a capacity-exhaustion case was the same generic
// "Rate limit exceeded" text as an ordinary rate limit).
export function describeProviderHttpFailure(status: number): string | undefined {
  switch (status) {
    case 400:
      return "Provider may have misunderstood the request payload. Try another provider if the explanation made no sense."
    case 401:
      return "Credential rejected or missing. Check the agent's Bearer Token/API Key."
    case 403:
      return "Credential accepted but not authorized for this model or endpoint."
    case 404:
      return "Endpoint or model not found. Check the request path and model name for typos."
    case 429:
      return "429 may mean rate limiting or temporary provider capacity exhaustion."
    case 500:
      return "Provider-side error unrelated to the request payload; usually transient."
    case 502:
      return "Provider's gateway couldn't reach the model backend; usually transient."
    case 503:
      return "Provider temporarily unavailable or overloaded; usually transient."
    case 504:
      // Hugging Face-compatible routes previously hit this timeout class until the user added the
      // provider-supported X-Wait-For-Model header for that agent - Tapoo never sends it on its
      // own; it's only sent when typed into that agent's own extraHeaders field on the agent config
      // form (see AgentApiConfig.extraHeaders, types.ts), the same generic "Key: Value" field any
      // other provider-specific header goes through.
      return "Provider gateway timed out waiting on the backend. Long-running requests can contribute."
    default:
      return undefined
  }
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

// isValidAgentEndpoint accepts HTTP(S) URLs plus host:port shorthand such as localhost:5000/move -
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
  requestIntervalSeconds,
  reasoningEffort,
  credential,
  extraHeaders,
}: AgentConfigValidationInput): string | null {
  if (!playerName || !model || !endpoint || !requestIntervalSeconds) {
    return agentConfig.invalidMessage
  }

  // Defensive, not merely decorative: api is typed as AgentApiProvider (types.ts), but that only
  // binds at compile time. isAgentApiProvider's actual source of truth at runtime is
  // agentConfig.providerLabels (config.ts) - the two are supposed to list the same providers, but
  // nothing enforces that beyond convention. If a provider is ever added to one without the other,
  // this is what catches the mismatch, rather than letting it flow into a persisted agent record
  // nothing downstream recognizes.
  if (!isAgentApiProvider(api)) {
    return agentConfig.invalidApiMessage
  }

  // Same defensive rationale as the isAgentApiProvider check above: the reasoning-effort dropdown's
  // <option>s are filtered per provider client-side, but nothing else enforces that a submitted
  // value is actually one this provider supports.
  if (!isAgentReasoningEffort(reasoningEffort) || !agentConfig.reasoningEffortOptions[api].includes(reasoningEffort)) {
    return agentConfig.invalidApiMessage
  }

  if (!hasValidAgentPlayerName(playerName)) {
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

  if (parseAgentRequestIntervalSeconds(requestIntervalSeconds) === null) {
    return agentConfig.invalidRequestIntervalTemplate
      .replace("{min}", String(agentConfig.requestIntervalMinSeconds))
      .replace("{max}", String(agentConfig.requestIntervalMaxSeconds))
  }

  // Unlike Ollama/OpenAI, where an empty credential just means "send no auth header" against a
  // trusted local server, Anthropic's hosted API rejects every request without one - so the
  // asterisk shown next to that field for Anthropic must actually be enforced here.
  if (api === "anthropic" && !credential) {
    return agentConfig.invalidAnthropicCredentialsMessage
  }

  const malformedHeaderKey = extraHeaderKeysFrom(extraHeaders).some(
    (key) => !EXTRA_HEADER_NAME_PATTERN.test(key),
  )
  if (malformedHeaderKey) {
    return agentConfig.invalidExtraHeadersMessage
  }

  return null
}
