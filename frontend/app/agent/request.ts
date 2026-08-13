import { logTapooDiagnostic, setTapooLogContext } from "../logs"
import { CONFIG } from "../config"
import {
  AGENT_CONTEXT_TOOLS,
  buildAgentMessages,
  buildAgentToolHandlers,
  buildDuplicateToolCallMessage,
  buildTokenLimitExhaustionPrompt,
} from "./context"
import {
  endpointLabel,
  normalizeToolArguments,
  parseAgentPrediction,
  parseExtraHeaders,
  previewLoggedMessage,
  previewLoggedTool,
  serializeToolResult,
} from "./protocol"
import { PROVIDER_ADAPTERS } from "./providers"
import type { ProviderAdapter } from "./providers"
import { resolveBatchEfficiencyClass } from "./efficiency"
import type {
  AgentChatMessage,
  AgentApiConfig,
  AgentPredictionFailure,
  AgentPredictionRequest,
  AgentPredictionResult,
  AgentToolCall,
  AgentToolDefinition,
  AgentToolHandlers,
  MazeActionResult,
  State,
} from "../types"

// AgentChatResponse is the shape every provider adapter's readMessage normalizes its raw payload
// into, so the loop below stays provider-neutral past this one point.
type AgentChatResponse = {
  message?: AgentChatMessage
}

type RequestAgentPredictionInput = {
  state: State
  timeoutMs: number
  // Delay applied before each provider request after the first within one turn — a turn issuing
  // several rounds while servicing tool calls otherwise fires them back to back with no gap at
  // all, which a provider's own rate limiting can see as a burst even when turns themselves are
  // well paced. See agentApiTurnPollIntervalMs (config.ts) for the separate, larger delay between
  // turns — this is deliberately the smaller, request-level sibling of that value.
  requestIntervalMs: number
  agent: AgentApiConfig
  lastActionResult: MazeActionResult | null
}

// sleep resolves after delayMs — used only to pace consecutive provider requests within one turn.
function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs))
}

type AgentChatTurnResult =
  | { ok: true; response: AgentChatResponse }
  | AgentPredictionFailure

// ToolServicingResult distinguishes a hallucinated/unknown tool call — the model's own fault,
// reported as malformed-response — from a handler throwing, which is a bug in our own tool
// implementation and stays a network-error.
type ToolServicingResult =
  | { ok: true; messages: AgentChatMessage[] }
  | { ok: false; reason: "unknown-tool" | "handler-error" }


// AgentMode labels the current provider-request phase for diagnostics.
// "tools" offers remaining context tools, "predict" asks for moves after all tools were used,
// and "warned" follows an all-duplicate tool-call response.
type AgentMode = "predict" | "tools" | "warned"

// buildToolResultMessages executes requested tools and converts their values into chat messages.
async function buildToolResultMessages(
  toolCalls: AgentToolCall[],
  toolHandlers: AgentToolHandlers,
): Promise<ToolServicingResult> {
  const toolMessages: AgentChatMessage[] = []

  for (const toolCall of toolCalls) {
    // A missing or unrecognized tool name means the model asked for something that was never
    // offered — most likely a hallucinated call — so it is the model's own fault, not ours.
    const toolName = toolCall.function?.name
    const handler = toolName ? toolHandlers[toolName] : undefined
    if (!toolName || !handler) {
      return { ok: false, reason: "unknown-tool" }
    }

    try {
      // Tool handlers own Tapoo context extraction; this layer only adapts them to chat messages.
      const result = await handler(normalizeToolArguments(toolCall.function?.arguments))
      toolMessages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        tool_name: toolName,
        content: serializeToolResult(result),
      })
    } catch {
      return { ok: false, reason: "handler-error" }
    }
  }

  return { ok: true, messages: toolMessages }
}

// requestChatTurn sends one provider-compatible chat request while keeping wire details local —
// the actual body/headers/response shape is entirely the chosen provider adapter's concern.
async function requestChatTurn(
  agent: AgentApiConfig,
  messages: AgentChatMessage[],
  tools: AgentToolDefinition[],
  signal: AbortSignal,
  wantsPredictionFormat: boolean,
  requestCount: number,
  isFirstRequestOfLevel: boolean,
  agentMode: AgentMode,
): Promise<AgentChatTurnResult> {
  const endpointDisplay = endpointLabel(agent.endpoint)

  // Defensive: agent.api is typed as AgentApiProvider, but that only binds at compile time.
  // agentConfigValidationError already rejects an unrecognized provider at form submission, and
  // storage.ts coerces one out of any persisted record — but a provider added to the type without
  // being wired into this table, or a record that reached here by some other path, must still fail
  // the turn cleanly instead of throwing out of a plain object lookup.
  const adapter = (PROVIDER_ADAPTERS as Partial<Record<string, ProviderAdapter>>)[agent.api]
  if (!adapter) {
    return {
      ok: false,
      reason: "network-error",
      diagnostic: {
        message: "Unsupported agent API provider.",
        details: { endpoint: endpointDisplay, api: agent.api },
      },
    }
  }

  const agentApiModeName = CONFIG.runtime.controlModes.agentApi
  const keepFull = isFirstRequestOfLevel && requestCount <= 1

  // Defensive fallback, same rationale as the adapter lookup above: normalizeAgentApiConfig
  // (storage.ts) always coerces a persisted record's reasoningEffort to a provider-valid value, but
  // a record that reached here by some other path should still get that provider's own default
  // rather than an undefined value reaching a provider adapter.
  const reasoningEffort = agent.reasoningEffort ?? CONFIG.agentConfig.reasoningEffortDefaults[agent.api]

  logTapooDiagnostic(agentApiModeName, "info", "Agent request.", {
    endpoint: endpointDisplay,
    api: agent.api,
    requestCount,
    agentMode,
    reasoning: reasoningEffort,
    // The full accumulated conversation is sent on every provider request. Static prompts are
    // previewed after the first request, while assistant/tool context stays available in full.
    messages: messages.map((msg) => previewLoggedMessage(msg, keepFull)),
    tools: tools.map((tool) => previewLoggedTool(tool, keepFull)),
  })

  const msgBody = adapter.buildBody({ model: agent.model, messages, tools, wantsPredictionFormat, reasoningEffort })
  
  // credential and extraHeaders reach only buildHeaders — never the log above, never the assembled
  // body, and never anything else that could flow into logTapooDiagnostic (see request storage in
  // logs.ts; log entries land in sessionStorage and are user-downloadable).
  const response = await fetch(agent.endpoint, {
    body: JSON.stringify(msgBody),
    headers: adapter.buildHeaders(agent.credential, parseExtraHeaders(agent.extraHeaders)),
    method: "POST",
    signal,
  })

  if (!response.ok) {
    // The provider's own error body usually names the exact rejected field (e.g. an unrecognized
    // request parameter) — status/statusText alone rarely do. Read it as text rather than
    // response.json(): a strict-validation rejection isn't guaranteed to be valid JSON, and a
    // failed parse here must not shadow the real failure this diagnostic exists to capture.
    const responseBodyText = await response.text().catch(() => undefined)
    return {
      ok: false,
      reason: "network-error",
      diagnostic: {
        message: "Provider HTTP response failed.",
        details: {
          endpoint: endpointDisplay,
          status: response.status,
          statusText: response.statusText,
          responseBody: responseBodyText,
        },
      },
    }
  }

  const rawResponseBody: unknown = await response.json()
  logTapooDiagnostic(agentApiModeName, "info", "Agent response.", {
    endpoint: endpointDisplay,
    payload: rawResponseBody,
  })
  return { ok: true, response: { message: adapter.readMessage(rawResponseBody) } }
}

// requestPredictionWithAbort hides request construction, timeout control, and tool-call servicing.
export function requestPredictionWithAbort({
  lastActionResult,
  state,
  agent,
  timeoutMs,
  requestIntervalMs,
}: RequestAgentPredictionInput): AgentPredictionRequest {
  // Expected aborts are lifecycle cleanup; timeout aborts remain provider/network failures.
  let activeController: AbortController | null = null
  let wasExpectedAbort = false

  // A level's first agent-api turn is the only one that needs the full system/user prompt
  // and tool descriptions logged; later turns repeat that same static content.
  const isFirstRequestOfLevel = state.turnCount === 0

  // Stamp every entry this turn produces with the same turn number and level. turnCount only
  // advances in commitAgentTurn once the turn resolves, so it stays fixed across the several
  // provider requests made below, and a trailing win/loss entry still carries the turn/level that
  // produced it.
  setTapooLogContext(state)

  // Each provider request gets its own timeout; one agent turn may make several requests while
  // servicing tool calls before the final move prediction arrives.
  const requestChatTurnWithTimeout = async (
    messages: AgentChatMessage[],
    tools: AgentToolDefinition[],
    wantsPredictionFormat: boolean,
    requestCount: number,
    agentMode: AgentMode,
  ): Promise<AgentChatTurnResult> => {
    const controller = new AbortController()
    activeController = controller
    const requestTimeout = window.setTimeout(() => {
      controller.abort()
    }, timeoutMs)

    try {
      return await requestChatTurn(
        agent, messages, tools, controller.signal,
        wantsPredictionFormat, requestCount, isFirstRequestOfLevel, agentMode,
      )
    } finally {
      window.clearTimeout(requestTimeout)
      if (activeController === controller) {
        activeController = null
      }
    }
  }

  const promise = (async (): Promise<AgentPredictionResult> => {
    try {
      const endpointDisplay = endpointLabel(agent.endpoint)

      // Tool handlers expose a stable snapshot for this whole prediction turn.
      const toolHandlers = buildAgentToolHandlers(state, lastActionResult, agent)
      // The classification is computed once up front so it appears unconditionally in the system
      // prompt, not only when the model chooses to call get_prediction_rules.
      const batchEfficiencyClass = resolveBatchEfficiencyClass(state.traversalHistory, agent)
      let messages = buildAgentMessages(agent.playerName, batchEfficiencyClass)
      let requestCount = 0

      // Track which tools have already been called this turn so duplicate tool calls can be
      // filtered out of what gets serviced, rather than either serving stale results again or
      // discarding the whole response when only some of its calls are duplicates.
      const calledToolNames = new Set<string>()

      // Only one corrective warning can be active at a time. Genuine tool progress clears it;
      // otherwise a second warning-worthy response ends the turn instead of stacking warnings.
      let hasWarningBeenIssued = false

      while (true) {
        // Honor aborts that land between provider requests, when no active controller exists yet.
        if (wasExpectedAbort) {
          // Exit 1: caller aborted between provider requests.
          return { ok: false, reason: "caller-abort" }
        }

        requestCount += 1

        // Only the first request of a turn is paced by agentApiTurnPollIntervalMs (the caller
        // schedules that before this function is even invoked) — every request after it within
        // the same turn otherwise fires immediately back to back, which a provider's rate limiting
        // can see as a burst even when turns themselves are well spaced.
        if (requestCount > 1) {
          await sleep(requestIntervalMs)
          if (wasExpectedAbort) {
            // Exit 1: caller aborted while this request was waiting to go out.
            return { ok: false, reason: "caller-abort" }
          }
        }

        // Offer only uncalled tools. Once every tool has been serviced, switch to prediction mode.
        const toolsToSend = AGENT_CONTEXT_TOOLS.filter(
          (tool) => !calledToolNames.has(tool.function.name),
        )
        const wantsPredictionFormat = toolsToSend.length === 0
        const agentMode = hasWarningBeenIssued ? "warned" : (wantsPredictionFormat ? "predict" : "tools")

        const chatTurn = await requestChatTurnWithTimeout(
          messages, toolsToSend, wantsPredictionFormat, requestCount, agentMode,
        )
        if (chatTurn.ok === false) {
          // Exit 2: HTTP failure or timeout; the request helper already shaped the failure.
          return chatTurn
        }

        const { response } = chatTurn
        if (!response.message) {
          // Exit 3: 200 OK without a chat message is still unusable for prediction.
          return {
            ok: false,
            reason: "network-error",
            diagnostic: {
              message: "Provider response did not include a message.",
              details: { endpoint: endpointDisplay, requestCount },
            },
          }
        }

        const tokensUsed = response.message.tokens_used
        const toolCalls = response.message.tool_calls ?? []
        if (toolCalls.length === 0) {
          // Without tool calls, the assistant content must be the final move prediction payload.
          const moves = parseAgentPrediction(response.message.content)
          if (!moves) {
            // A parse failure is broader than an empty prediction: nonempty invalid JSON must stay
            // malformed-response even when its token usage reaches the configured threshold.
            const isEmptyPrediction = (response.message.content ?? "").trim().length === 0
            const reachedTokenCap = tokensUsed !== undefined && tokensUsed >= CONFIG.runtime.modelConfig.numPredict

            // Token-limit exhaustion requires both signals. Empty content alone may be an ordinary
            // malformed response, while high token usage alone may still accompany usable output.
            if (isEmptyPrediction && reachedTokenCap) {
              // The shared warning guard permits only one corrective warning at a time. If this
              // response already followed a warning, surface the distinct final failure instead.
              if (hasWarningBeenIssued) {
                // Exit 4: the model exhausted the token cap without returning a prediction.
                return {
                  ok: false,
                  reason: "token-limit-exhaustion",
                  diagnostic: {
                    message: "Agent exhausted the token cap without returning a prediction.",
                    details: { endpoint: endpointDisplay, requestCount, tokensUsed },
                  },
                }
              }

              // Resend the same accumulated conversation that produced the empty response, adding
              // only the corrective warning; the empty assistant response itself is not echoed back.
              messages = [
                ...messages,
                buildTokenLimitExhaustionPrompt(tokensUsed),
              ]

              hasWarningBeenIssued = true
              continue
            }

            // Every remaining parse failure either contained nonempty invalid output or did not
            // reach the token threshold, so it follows the ordinary malformed-response path.
            // Exit 5: final assistant content is not a valid moves payload. The full response is
            // already in the preceding "Agent response." info log.
            return {
              ok: false,
              reason: "malformed-response",
              diagnostic: {
                message: "Malformed agent prediction response.",
                details: { endpoint: endpointDisplay, requestCount, tokensUsed },
              },
            }
          }
          // Exit 6: valid moves prediction.
          return { ok: true, moves }
        }

        // Split this response into tool calls that need servicing and duplicate calls that
        // already have results, so only genuinely new work gets a payload — duplicates get a
        // reminder naming them instead, without blocking whatever new calls came with them.
        // Calls with an unrecognized or missing name are treated as "new" (not a known
        // duplicate) so buildToolResultMessages still surfaces them as a servicing failure
        // rather than letting them vanish from both buckets.
        const isKnownDuplicate = (tc: AgentToolCall) =>
          tc.function?.name !== undefined && calledToolNames.has(tc.function.name)

        const duplicateToolCalls = toolCalls.filter(isKnownDuplicate)
        const newToolCalls = toolCalls.filter((tc) => !isKnownDuplicate(tc))

        if (newToolCalls.length === 0) {
          // Every requested tool was already called; warn once, then fail on repeat.
          if (hasWarningBeenIssued) {
            // Exit 7: second duplicate-only tool response after a reminder.
            return {
              ok: false,
              reason: "malformed-response",
              diagnostic: {
                message: "Agent kept re-requesting already-called tools after being told so.",
                details: { endpoint: endpointDisplay, requestCount },
              },
            }
          }

          messages = [
            ...messages,
            {
              role: "assistant",
              content: response.message.content ?? "",
              // Only echoed back when the agent's own echoBackReasoning flag is on — model
              // guidance conflicts here (Kimi K3 requires it echoed back, Gemma requires it
              // withheld), so this defaults off. See AgentApiConfig.echoBackReasoning.
              ...(agent.echoBackReasoning ? { reasoning: response.message.reasoning } : {}),
              tool_calls: toolCalls,
            },
            buildDuplicateToolCallMessage(duplicateToolCalls),
          ]
          hasWarningBeenIssued = true
          continue
        }

        // Record only newly serviced tools, so later duplicate checks are based on real progress.
        // Calls with missing names still reach buildToolResultMessages and fail explicitly there.
        newToolCalls.forEach((tc) => {
          if (tc.function?.name) calledToolNames.add(tc.function.name)
        })

        const toolResult = await buildToolResultMessages(newToolCalls, toolHandlers)
        if (toolResult.ok === false) {
          const toolNames = newToolCalls
            .map((tc) => tc.function?.name)
            .filter((name): name is string => name !== undefined)

          if (toolResult.reason === "unknown-tool") {
            // Exit 8: unknown tools are malformed model output, not infrastructure failure.
            return {
              ok: false,
              reason: "malformed-response",
              diagnostic: {
                message: "Agent requested an unknown or hallucinated tool.",
                details: { endpoint: endpointDisplay, requestCount, toolNames },
              },
            }
          }

          // Exit 9: a recognized tool handler failed inside Tapoo's context provider.
          return {
            ok: false,
            reason: "network-error",
            diagnostic: {
              message: "Tool request could not be serviced.",
              details: { endpoint: endpointDisplay, requestCount, toolNames },
            },
          }
        }

        // Rebind instead of mutating so diagnostic snapshots keep the request history they logged.
        // The conversation still accumulates because each provider request needs prior context.
        messages = [
          ...messages,
          {
            role: "assistant",
            content: response.message.content ?? "",
            // Only echoed back when the agent's own echoBackReasoning flag is on — model guidance
            // conflicts here (Kimi K3 requires it echoed back, Gemma requires it withheld), so
            // this defaults off. See AgentApiConfig.echoBackReasoning.
            ...(agent.echoBackReasoning ? { reasoning: response.message.reasoning } : {}),
            tool_calls: toolCalls,
          },
          ...toolResult.messages,
          ...(duplicateToolCalls.length > 0 ? [buildDuplicateToolCallMessage(duplicateToolCalls)] : []),
        ]
        hasWarningBeenIssued = false
      }
    } catch (error) {
      // Caller aborts are expected lifecycle cleanup, so this catch does not log them as failures
      // or run failure callbacks. Timeout aborts do not set that flag, so they fall through below.
      if (wasExpectedAbort) {
        return { ok: false, reason: "caller-abort" }
      }

      // The connection itself failed here (a reset, a dropped socket, a DNS hiccup, a timeout
      // abort) before any HTTP response arrived. See AgentPredictionFailureReason's comment for
      // how this differs from the other reasons.
      return {
        ok: false,
        reason: "connection-error",
        diagnostic: {
          message: "Request failed before a valid response.",
          // String(error) rather than the raw caught value: Error/DOMException instances (fetch's
          // TypeError, an aborted signal's AbortError) serialize to "{}" via JSON.stringify — their
          // name/message are non-enumerable own properties — so logging the value as-is would
          // silently discard exactly the detail this diagnostic exists to capture. String() covers
          // any thrown shape uniformly via its own toString(), without special-casing by type.
          details: { endpoint: endpointLabel(agent.endpoint), error: String(error) },
        },
      }
    }
  })()

  return {
    abort() {
      // Caller aborts are silent; they should not disable agents or spend score.
      wasExpectedAbort = true
      activeController?.abort()
      activeController = null
    },
    isAborted() {
      return wasExpectedAbort
    },
    promise,
  }
}
