import { logTapooDiagnostic, setTapooLogTurn } from "../logs"
import { CONFIG } from "../config"
import {
  AGENT_CONTEXT_TOOLS,
  buildAgentMessages,
  buildAgentToolHandlers,
  buildDuplicateToolCallMessage,
} from "./context"
import {
  endpointLabel,
  normalizeToolArguments,
  parseAgentPrediction,
  previewLoggedMessage,
  previewLoggedTool,
  serializeToolResult,
} from "./protocol"
import { PROVIDER_ADAPTERS } from "./providers"
import type { ProviderAdapter } from "./providers"
import { resolveBatchEfficiencyRank } from "./efficiency"
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
  agent: AgentApiConfig
  lastActionResult: MazeActionResult | null
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
  mazeArea: number | undefined,
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

  logTapooDiagnostic(agentApiModeName, "info", "Agent request.", {
    endpoint: endpointDisplay,
    api: agent.api,
    requestCount,
    agentMode,
    tools: tools.map((tool) => previewLoggedTool(tool, keepFull)),
    // The full accumulated conversation is sent on every provider request. Static prompts are
    // previewed after the first request, while assistant/tool context stays available in full.
    messages: messages.map((msg) => previewLoggedMessage(msg, keepFull)),
  })

  const msgBody = adapter.buildBody({ model: agent.model, messages, tools, mazeArea, wantsPredictionFormat })
  
  // credential and apiVersion reach only buildHeaders — never the log above, never the assembled
  // body, and never anything else that could flow into logTapooDiagnostic (see request storage in
  // logs.ts; log entries land in sessionStorage and are user-downloadable).
  const response = await fetch(agent.endpoint, {
    body: JSON.stringify(msgBody),
    headers: adapter.buildHeaders(agent.credential, agent.apiVersion),
    method: "POST",
    signal,
  })

  if (!response.ok) {
    return {
      ok: false,
      reason: "network-error",
      diagnostic: {
        message: "Provider HTTP response failed.",
        details: {
          endpoint: endpointDisplay,
          status: response.status,
          statusText: response.statusText,
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
}: RequestAgentPredictionInput): AgentPredictionRequest {
  // Expected aborts are lifecycle cleanup; timeout aborts remain provider/network failures.
  let activeController: AbortController | null = null
  let wasExpectedAbort = false

  // A level's first agent-api turn is the only one that needs the full system/user prompt
  // and tool descriptions logged; later turns repeat that same static content.
  const isFirstRequestOfLevel = state.turnCount === 0

  // Stamp every entry this turn produces with the same turn number. turnCount only advances in
  // commitAgentTurn once the turn resolves, so it stays fixed across the several provider
  // requests made below, and a trailing win/loss entry still carries the turn that produced it.
  setTapooLogTurn(state.turnCount)

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
        state.mazeDimensions?.area, wantsPredictionFormat, requestCount, isFirstRequestOfLevel, agentMode,
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
      // The rank is computed once up front so it appears unconditionally in the system prompt,
      // not only when the model chooses to call get_prediction_rules.
      const batchEfficiencyRank = resolveBatchEfficiencyRank(state.traversalHistory, agent)
      let messages = buildAgentMessages(agent.playerName, batchEfficiencyRank)
      let requestCount = 0

      // Track which tools have already been called this turn so duplicate tool calls can be
      // filtered out of what gets serviced, rather than either serving stale results again or
      // discarding the whole response when only some of its calls are duplicates.
      const calledToolNames = new Set<string>()

      // Set to true after a response contains only duplicate tool calls and receives a reminder.
      // A second all-duplicate response ends the turn instead of reminding indefinitely.
      //
      // This and the finite tool inventory bound requests per turn: every serviced tool is removed
      // from the next request, and only one duplicate-only reminder is allowed before failure.
      let duplicateWarningIssued = false

      while (true) {
        // Honor aborts that land between provider requests, when no active controller exists yet.
        if (wasExpectedAbort) {
          // Exit 1: caller aborted between provider requests.
          return { ok: false, reason: "caller-abort" }
        }

        requestCount += 1

        // Offer only uncalled tools. Once every tool has been serviced, switch to prediction mode.
        const toolsToSend = AGENT_CONTEXT_TOOLS.filter(
          (tool) => !calledToolNames.has(tool.function.name),
        )
        const wantsPredictionFormat = toolsToSend.length === 0
        const agentMode = duplicateWarningIssued ? "warned" : (wantsPredictionFormat ? "predict" : "tools")

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

        const toolCalls = response.message.tool_calls ?? []
        if (toolCalls.length === 0) {
          // Without tool calls, the assistant content must be the final move prediction payload.
          const moves = parseAgentPrediction(response.message.content)
          if (!moves) {
            // Exit 4: final assistant content is not a valid moves payload.
            // The full response is already in the preceding "Agent response." info log.
            return {
              ok: false,
              reason: "malformed-response",
              diagnostic: {
                message: "Malformed agent prediction response.",
                details: { endpoint: endpointDisplay, requestCount },
              },
            }
          }
          // Exit 5: valid moves prediction.
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
          if (duplicateWarningIssued) {
            // Exit 6: second duplicate-only tool response after a reminder.
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
            { role: "assistant", content: response.message.content ?? "", tool_calls: toolCalls },
            buildDuplicateToolCallMessage(duplicateToolCalls),
          ]
          duplicateWarningIssued = true
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
            // Exit 7: unknown tools are malformed model output, not infrastructure failure.
            return {
              ok: false,
              reason: "malformed-response",
              diagnostic: {
                message: "Agent requested an unknown or hallucinated tool.",
                details: { endpoint: endpointDisplay, requestCount, toolNames },
              },
            }
          }

          // Exit 8: a recognized tool handler failed inside Tapoo's context provider.
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
          { role: "assistant", content: response.message.content ?? "", tool_calls: toolCalls },
          ...toolResult.messages,
          ...(duplicateToolCalls.length > 0 ? [buildDuplicateToolCallMessage(duplicateToolCalls)] : []),
        ]
        duplicateWarningIssued = false
      }
    } catch {
      // Fetch failures, timeout aborts, and tool-service failures share one network bucket.
      // Caller aborts are expected lifecycle cleanup, so this catch does not log them as
      // network failures or run failure callbacks. Timeout aborts do not set that flag.
      if (wasExpectedAbort) {
        return { ok: false, reason: "caller-abort" }
      }

      return {
        ok: false,
        reason: "network-error",
        diagnostic: {
          message: "Request failed before a valid response.",
          details: { endpoint: endpointLabel(agent.endpoint) },
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
