import { describe, expect, it } from "vitest"

import {
  agentConfigValidationError,
  describeProviderHttpFailure,
  isValidAgentEndpoint,
  normalizeAgentEndpoint,
} from "./config"
import { CONFIG } from "../config"
import type { AgentApiConfig } from "../types"

// baseValidationInput supplies the ollama-default, credential-less shape most cases exercise,
// so each test only spells out the fields it's actually varying.
const baseValidationInput = {
  api: "ollama" as const,
  requestIntervalSeconds: String(CONFIG.timing.defaultAgentApiRequestIntervalSeconds),
  reasoningEffort: "max" as const,
  credential: "",
  extraHeaders: "",
}

function agent(playerName: string): AgentApiConfig {
  return {
    seatId: 1,
    sessionId: 1_700_000_000_000,
    playerName,
    model: "llama3.2",
    endpoint: new URL("https://agents.example/move"),
    api: "ollama",
    requestIntervalSeconds: CONFIG.timing.defaultAgentApiRequestIntervalSeconds,
  }
}

// Agent-config tests keep form validation separate from the larger agent control mode.
describe("agent config", () => {
  it("accepts HTTP, HTTPS, and host-port shorthand endpoints that carry a real request path", () => {
    expect(isValidAgentEndpoint("https://agents.example/move")).toBe(true)
    expect(isValidAgentEndpoint("http://localhost:8787/move")).toBe(true)
    expect(isValidAgentEndpoint("localhost:5000/move")).toBe(true)
    expect(isValidAgentEndpoint("123.34.56.89:5000/move")).toBe(true)
    expect(isValidAgentEndpoint("/agents/move")).toBe(false)
    expect(isValidAgentEndpoint("ftp://agents.example/move")).toBe(false)
    expect(isValidAgentEndpoint("not a url")).toBe(false)
  })

  it("rejects a bare host or host:port with no request path, rather than silently guessing one", () => {
    expect(isValidAgentEndpoint("https://agents.example")).toBe(false)
    expect(isValidAgentEndpoint("https://agents.example/")).toBe(false)
    expect(isValidAgentEndpoint("localhost:5000")).toBe(false)
    expect(isValidAgentEndpoint("123.34.56.89:5000")).toBe(false)
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
        ...baseValidationInput,
        endpoint: "",
        existingAgents: [],
        model: "llama3.2",
        playerName: "Blue",
      }),
    ).toBe(CONFIG.agentConfig.invalidMessage)

    expect(
      agentConfigValidationError({
        ...baseValidationInput,
        endpoint: "https://agents.example/move",
        existingAgents: [],
        model: "llama3.2",
        playerName: "TooLongName",
      }),
    ).toBe(CONFIG.agentConfig.playerNameLengthMessage)

    expect(
      agentConfigValidationError({
        ...baseValidationInput,
        endpoint: "https://agents.example/move",
        existingAgents: [agent("Scout")],
        model: "llama3.2",
        playerName: " scout ",
      }),
    ).toBe(CONFIG.agentConfig.duplicatePlayerNameMessage)

    expect(
      agentConfigValidationError({
        ...baseValidationInput,
        endpoint: "/agents/scout/move",
        existingAgents: [],
        model: "llama3.2",
        playerName: "Scout",
      }),
    ).toBe(CONFIG.agentConfig.invalidEndpointMessage)
  })

  it("rejects request intervals outside the configured whole-second range", () => {
    const invalidRequestIntervalMessage = CONFIG.agentConfig.invalidRequestIntervalTemplate
      .replace("{min}", String(CONFIG.agentConfig.requestIntervalMinSeconds))
      .replace("{max}", String(CONFIG.agentConfig.requestIntervalMaxSeconds))

    for (const requestIntervalSeconds of ["0", "301", "1.5", "soon"]) {
      expect(
        agentConfigValidationError({
          ...baseValidationInput,
          endpoint: "https://agents.example/move",
          existingAgents: [],
          model: "llama3.2",
          playerName: "Scout",
          requestIntervalSeconds,
        }),
      ).toBe(invalidRequestIntervalMessage)
    }

    expect(
      agentConfigValidationError({
        ...baseValidationInput,
        endpoint: "https://agents.example/move",
        existingAgents: [],
        model: "llama3.2",
        playerName: "Scout",
        requestIntervalSeconds: String(CONFIG.agentConfig.requestIntervalMinSeconds),
      }),
    ).toBeNull()

    expect(
      agentConfigValidationError({
        ...baseValidationInput,
        endpoint: "https://agents.example/move",
        existingAgents: [],
        model: "llama3.2",
        playerName: "Scout",
        requestIntervalSeconds: String(CONFIG.agentConfig.requestIntervalMaxSeconds),
      }),
    ).toBeNull()
  })

  it("requires a credential for Anthropic, but not for Ollama or OpenAI", () => {
    expect(
      agentConfigValidationError({
        ...baseValidationInput,
        api: "anthropic",
        endpoint: "https://agents.example/messages",
        existingAgents: [],
        model: "claude-3.5-sonnet",
        playerName: "Scout",
      }),
    ).toBe(CONFIG.agentConfig.invalidAnthropicCredentialsMessage)

    expect(
      agentConfigValidationError({
        ...baseValidationInput,
        api: "anthropic",
        credential: "sk-secret",
        endpoint: "https://agents.example/messages",
        existingAgents: [],
        model: "claude-3.5-sonnet",
        playerName: "Scout",
      }),
    ).toBeNull()

    expect(
      agentConfigValidationError({
        ...baseValidationInput,
        api: "openai",
        endpoint: "https://agents.example/v1/chat/completions",
        existingAgents: [],
        model: "gpt-4o",
        playerName: "Scout",
      }),
    ).toBeNull()
  })

  it("accepts well-formed extra header keys, including RFC 7230 token characters", () => {
    expect(
      agentConfigValidationError({
        ...baseValidationInput,
        endpoint: "https://agents.example/move",
        existingAgents: [],
        model: "llama3.2",
        playerName: "Scout",
        extraHeaders: "X-Custom-Header: value\nX-Wait-For-Model: true",
      }),
    ).toBeNull()

    expect(
      agentConfigValidationError({
        ...baseValidationInput,
        endpoint: "https://agents.example/move",
        existingAgents: [],
        model: "llama3.2",
        playerName: "Scout",
        // '!#$%&'*+-.^_`|~ are all valid token characters per RFC 7230, unusual as a header name
        // as they are.
        extraHeaders: "X-A.B_C~D: value",
      }),
    ).toBeNull()
  })

  it("rejects an extra header key that isn't a valid HTTP header name", () => {
    expect(
      agentConfigValidationError({
        ...baseValidationInput,
        endpoint: "https://agents.example/move",
        existingAgents: [],
        model: "llama3.2",
        playerName: "Scout",
        // A space inside the key — likely a typo, e.g. "X Custom Header: value" instead of
        // "X-Custom-Header: value" — is not a valid HTTP header token.
        extraHeaders: "X Custom Header: value",
      }),
    ).toBe(CONFIG.agentConfig.invalidExtraHeadersMessage)

    expect(
      agentConfigValidationError({
        ...baseValidationInput,
        endpoint: "https://agents.example/move",
        existingAgents: [],
        model: "llama3.2",
        playerName: "Scout",
        // One well-formed row followed by one malformed row — every row must pass, not just one.
        extraHeaders: "X-Custom-Header: value\nX@Bad: value",
      }),
    ).toBe(CONFIG.agentConfig.invalidExtraHeadersMessage)
  })

  it("ignores blank lines when checking extra header keys, matching parseExtraHeaders", () => {
    expect(
      agentConfigValidationError({
        ...baseValidationInput,
        endpoint: "https://agents.example/move",
        existingAgents: [],
        model: "llama3.2",
        playerName: "Scout",
        extraHeaders: "X-Custom-Header: value\n\n",
      }),
    ).toBeNull()
  })

  it("rejects an api value the dropdown/adapters don't recognize instead of assuming it's fine", () => {
    // api is typed as AgentApiProvider, but that only binds at compile time — this exercises the
    // runtime guard that catches a value the type system can no longer stop, e.g. a provider added
    // to the type without being wired into the form and PROVIDER_ADAPTERS yet.
    expect(
      agentConfigValidationError({
        ...baseValidationInput,
        api: "unsupported-provider" as never,
        endpoint: "https://agents.example/move",
        existingAgents: [],
        model: "llama3.2",
        playerName: "Scout",
      }),
    ).toBe(CONFIG.agentConfig.invalidApiMessage)
  })

  it("rejects a reasoning-effort value the selected provider doesn't offer", () => {
    // "none" is a real, valid value overall (Ollama/OpenAI both offer it) — just not one Anthropic
    // supports, so this exercises the provider-scoped check rather than isAgentReasoningEffort alone.
    expect(
      agentConfigValidationError({
        ...baseValidationInput,
        api: "anthropic",
        credential: "sk-secret",
        reasoningEffort: "none",
        endpoint: "https://agents.example/messages",
        existingAgents: [],
        model: "claude-3.5-sonnet",
        playerName: "Scout",
      }),
    ).toBe(CONFIG.agentConfig.invalidApiMessage)
  })
})

describe("describeProviderHttpFailure", () => {
  it("explains every status this function recognizes", () => {
    const recognizedStatuses = [400, 401, 403, 404, 429, 500, 502, 503, 504]

    for (const status of recognizedStatuses) {
      const explanation = describeProviderHttpFailure(status)
      expect(explanation, `status ${status}`).toBeTruthy()
      expect(typeof explanation).toBe("string")
    }
  })

  it("returns undefined for a status it has no specific explanation for", () => {
    expect(describeProviderHttpFailure(418)).toBeUndefined()
  })

  it("gives 401 and 403 distinct explanations, since one is a bad credential and the other a valid one lacking permission", () => {
    expect(describeProviderHttpFailure(401)).not.toBe(describeProviderHttpFailure(403))
  })

  it("keeps the 504 explanation broad, with long generations only as a contributing factor", () => {
    expect(describeProviderHttpFailure(504)).toBe(
      "Provider gateway timed out waiting on the backend. Long-running requests can contribute.",
    )
  })
})
