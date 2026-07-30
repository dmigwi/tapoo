import { isMoveAction } from "../traversal"
import { logTapooDiagnostic, trimLoggedDescription } from "../logs"
import { CONFIG } from "../config"
import {
  AGENT_CONTEXT_TOOLS,
  PREDICTION_FORMAT,
  buildAgentMessages,
  buildAgentToolHandlers,
  buildDuplicateToolCallMessage,
} from "./context"
import { resolveBatchEfficiencyRank } from "./efficiency"
import type {
  AgentApiConfig,
  MazeAction,
  MazeActionResult,
  MoveAction,
  State,
} from "../types"

// AgentMessageRole lists the chat roles Tapoo sends and receives; Ollama's 
// supported set is "system", "user", "assistant", and "tool".
type AgentMessageRole = "assistant" | "tool" | "user" | "system"

// AgentToolDefinition mirrors the provider tool schema Tapoo sends with each chat request.
export type AgentToolDefinition = {
  type: "function"
  function: {
    name: string
    description: string
    parameters: {
      type: "object"
      properties: Record<string, unknown>
      required: string[]
    }
  }
}

// AgentToolHandlers contains local Tapoo functions that satisfy model-requested tool calls.
export type AgentToolHandlers = Record<
  string,
  (args: unknown) => AgentToolResult | Promise<AgentToolResult>
>

export type AgentToolResult =
  | null
  | boolean
  | number
  | string
  | Record<string, unknown>
  | unknown[]

// AgentToolCall is intentionally permissive because providers vary slightly in tool-call shape.
export type AgentToolCall = {
  id?: string
  type?: "function"
  function?: {
    index?: number
    name?: string
    arguments?: unknown
  }
}

// AgentChatMessage is the minimal chat message shape needed by the prediction request loop.
export type AgentChatMessage = {
  role: AgentMessageRole
  content?: string
  tool_call_id?: string
  tool_name?: string
  tool_calls?: AgentToolCall[]
}

type AgentChatResponse = {
  message?: {
    role?: AgentMessageRole
    content?: string
    thinking?: string
    tool_calls?: AgentToolCall[]
  }
}

type AgentPredictionPayload = { moves?: unknown }

// AgentPredictionResult is the only outcome surface exposed to agent-api.ts.
export type AgentPredictionResult =
  | { ok: true; moves: MoveAction[] }
  | AgentPredictionFailure

export type AgentPredictionFailureReason =
  | "caller-abort"
  | "malformed-response"
  | "network-error"

export type AgentPredictionDiagnostic = {
  message: string
  details?: Record<string, unknown>
}

export type AgentPredictionFailure = {
  ok: false
  reason: AgentPredictionFailureReason
  diagnostic?: AgentPredictionDiagnostic
}

// AgentPredictionRequest lets the caller stop polling without learning HTTP/tool-call details.
export type AgentPredictionRequest = {
  abort: () => void
  isAborted: () => boolean
  promise: Promise<AgentPredictionResult>
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


// AgentRequestMode labels each request for logging: "tools" while context tools are still being
// offered, "predict" once every tool has been called and the payload switches to the structured
// prediction format, and "warned" on any request following a round whose tool calls were all
// duplicates and drew a buildDuplicateToolCallMessage reminder. "warned" takes precedence over
// the other two, so it can appear during tool gathering as well as in prediction mode.
type AgentRequestMode = "predict" | "tools" | "warned"

// stripMarkdownFence removes optional ```json or ``` wrappers that models add despite instructions.
function stripMarkdownFence(content: string): string {
  return content.replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/s, "$1").trim()
}

// extractFencedJson finds a ```json or ``` block anywhere in the content, handling models
// that prefix a fenced JSON answer with inline reasoning. Unlike stripMarkdownFence, it
// does not require the fence to span the entire string.
function extractFencedJson(content: string): string | null {
  const match = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/s)
  return match ? match[1].trim() : null
}

// extractEmbeddedJson handles models that emit inline reasoning before the JSON answer.
// The last '{' is used as the anchor because models consistently place the JSON payload
// at the end of their response, after any prose or numbered-list thinking steps.
function extractEmbeddedJson(content: string): string | null {
  const start = content.lastIndexOf("{")
  return start === -1 ? null : content.slice(start).trim()
}

// parseAgentPrediction extracts the single supported prediction payload from final model content.
function parseAgentPrediction(content: string | undefined): MoveAction[] | null {
  if (!content) {
    return null
  }

  // Reuse the shared action validator so request parsing stays aligned with game controls.
  const isPredictedMove = (move: unknown): move is MoveAction => {
    return typeof move === "string" && isMoveAction({ type: move } as MazeAction)
  }

  // Try progressively looser extractions: full-string fence, embedded fence in prose, plain JSON in prose.
  const candidates = [stripMarkdownFence(content), extractFencedJson(content), extractEmbeddedJson(content)]
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      const { moves } = JSON.parse(candidate) as AgentPredictionPayload
      if (Array.isArray(moves) && moves.length > 0 && moves.every(isPredictedMove)) {
        return [...moves]
      }
    } catch {
      // try next candidate
    }
  }

  return null
}

// normalizeToolArguments accepts object arguments and provider variants that encode them as JSON.
function normalizeToolArguments(args: unknown): unknown {
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
function serializeToolResult(result: unknown): string {
  return typeof result === "string" ? result : JSON.stringify(result)
}

// previewLoggedMessage trims content only for the system/user roles, the two known static,
// repeated-every-turn prompt messages. Assistant/tool messages are always turn-unique content
// (tool-call results), so they're left untouched regardless of keepFull — gating by role here,
// not by round, keeps every message's treatment consistent across every round of a turn.
function previewLoggedMessage(message: AgentChatMessage, keepFull: boolean): AgentChatMessage {
  if (message.role !== "system" && message.role !== "user") {
    return message
  }

  return { ...message, content: trimLoggedDescription(message.content, keepFull) }
}

// previewLoggedTool applies trimLoggedDescription to a tool's function.description, the other
// field known to carry long, repeated text (the same 5 static schemas resent every round).
// Name is kept as-is regardless — it's short and still tells you which tools were on offer.
function previewLoggedTool(
  tool: object,
  keepFull: boolean,
): { name: string; description: string | undefined } {
  const { function: fn } = tool as AgentToolDefinition
  return { name: fn.name, description: trimLoggedDescription(fn.description, keepFull) }
}

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

// contextWindowForArea scales the KV-cache size proportionally to maze area so larger mazes
// with longer traversal histories do not overflow the context window.
function contextWindowForArea(area: number): number {
  const { contextWindowFloor, contextWindowAreaMultiplier } = CONFIG.runtime.modelConfig
  return Math.max(contextWindowFloor, area * contextWindowAreaMultiplier)
}

function endpointLabel(endpoint: URL): string {
  return `${endpoint.origin}${endpoint.pathname}`
}

// requestChatTurn sends one provider-compatible chat request while keeping wire details local.
async function requestChatTurn(
  endpoint: URL,
  model: string,
  messages: AgentChatMessage[],
  tools: object[],
  signal: AbortSignal,
  mazeArea: number | undefined,
  format: Record<string, unknown> | undefined,
  reqTurn: number,
  isFirstRequestOfLevel: boolean,
  mode: AgentRequestMode,
): Promise<AgentChatTurnResult> {

  const msgBody = {
    model,
    messages,
    tools,
    options: {
      num_ctx: contextWindowForArea(mazeArea ?? 0),
      temperature: CONFIG.runtime.modelConfig.temperature,
      num_predict: CONFIG.runtime.modelConfig.numPredict,
    },
    ...(format !== undefined ? { format } : {}),
    think: false,
    stream: false,
  }

  const endpointDisplay = endpointLabel(endpoint)
  const agentApiModeName = CONFIG.runtime.controlModes.agentApi
  const keepFull = isFirstRequestOfLevel && reqTurn <= 1

  logTapooDiagnostic(agentApiModeName, "info", "Agent request.", {
    endpoint: endpointDisplay,
    requestTurn: reqTurn,
    mode,
    tools: tools.map((tool) => previewLoggedTool(tool, keepFull)),
    // This is the full conversation sent on this request, not just the round's new turns: the
    // caller appends to `messages` each round rather than replacing it, so earlier assistant and
    // tool messages are re-sent — and therefore re-logged — every round. previewLoggedMessage only
    // trims the static system/user prompts, so a long turn's log still grows with each round.
    messages: messages.map((msg) => previewLoggedMessage(msg, keepFull)),
  })

  const response = await fetch(endpoint, {
    body: JSON.stringify(msgBody),
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
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

  const responseBody = (await response.json()) as AgentChatResponse
  logTapooDiagnostic(agentApiModeName, "info", "Agent response.", {
    endpoint: endpointDisplay,
    payload: responseBody,
  })
  return { ok: true, response: responseBody }
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

  // A level's first agent-api request is the only one that needs the full system/user prompt
  // and tool descriptions logged; every later turn repeats that same static content.
  const isFirstRequestOfLevel = state.agentRequestCount === 0

  // requestChatTurnWithTimeout gives each provider HTTP request its own timeout window; the round
  // loop below covers what that means for a whole turn.
  const requestChatTurnWithTimeout = async (
    messages: AgentChatMessage[],
    tools: object[],
    format: Record<string, unknown> | undefined,
    reqTurn: number,
    mode: AgentRequestMode,
  ): Promise<AgentChatTurnResult> => {
    const controller = new AbortController()
    activeController = controller
    const requestTimeout = window.setTimeout(() => {
      controller.abort()
    }, timeoutMs)

    try {
      return await requestChatTurn(
        agent.endpoint, agent.model, messages, tools, controller.signal,
        state.mazeDimensions?.area, format, reqTurn, isFirstRequestOfLevel, mode,
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

      // Tool handlers close over the current State snapshot and last replay metadata for this turn.
      const toolHandlers = buildAgentToolHandlers(state, lastActionResult, agent)
      // The rank is computed once up front so it appears unconditionally in the system prompt,
      // not only when the model chooses to call get_prediction_rules.
      const batchEfficiencyRank = resolveBatchEfficiencyRank(state.traversalHistory, agent)
      let messages = buildAgentMessages(agent.playerName, batchEfficiencyRank)
      let requestTurns = 0

      // Track which tools have already been called this turn so duplicate requests can be
      // filtered out of what gets serviced, rather than either serving stale results again or
      // discarding the whole round when only some of its calls are duplicates.
      const calledToolNames = new Set<string>()

      // Set to True once a round produced zero new tool calls (i.e. every requested tool was already
      // called) and got a reminder (warning) naming those specific duplicates. A second such round in a
      // row, ends the turn instead of reminding indefinitely.
      //
      // That rule and the tool inventory together bound requests per turn, so no round-count
      // ceiling is needed: servicing a new tool adds to calledToolNames, capping serviced rounds at
      // AGENT_CONTEXT_TOOLS.length, and an all-duplicate round needs duplicateWarningIssued false,
      // which only a serviced round resets. timeoutMs applies per request, so a worst-case turn
      // takes a multiple of it — acceptable, since a dead provider is caught on the first round.
      let duplicateWarningIssued = false

      while (true) {
        // Guards the window between rounds where activeController is briefly null (after one
        // round's cleanup, before the next round's fetch starts) — without this, an abort() call
        // landing in that window would otherwise be silently dropped and the next round would
        // fire anyway, ignoring the caller's request to stop.
        if (wasExpectedAbort) {
          // Exit 1: caller aborted between rounds.
          return { ok: false, reason: "caller-abort" }
        }

        requestTurns += 1

        // Offer whatever is still uncalled, always at full definition: a called tool cannot return
        // new information this turn. This yields [] once every tool has been called (calledToolNames grows
        // only from serviced, non-duplicate calls), which is what switches to prediction mode.
        const toolsToSend = AGENT_CONTEXT_TOOLS.filter(
          (tool) => !calledToolNames.has(tool.function.name),
        )
        const format = toolsToSend.length === 0 ? PREDICTION_FORMAT : undefined
        const mode = duplicateWarningIssued ? "warned" : (format === undefined ? "tools" : "predict")

        const chatTurn = await requestChatTurnWithTimeout(messages, toolsToSend, format, requestTurns, mode)
        if (chatTurn.ok === false) {
          // Exit 2: the HTTP request itself failed (network-error) or a timeout/abort fired
          // mid-request (chatTurn already carries the right failure shape).
          return chatTurn
        }

        const { response } = chatTurn
        if (!response.message) {
          // Exit 3: provider responded 200 OK but with no message body.
          return {
            ok: false,
            reason: "network-error",
            diagnostic: {
              message: "Provider response did not include a message.",
              details: { endpoint: endpointDisplay, requestTurn: requestTurns },
            },
          }
        }

        const toolCalls = response.message.tool_calls ?? []
        if (toolCalls.length === 0) {
          // Final assistant content must be the compact JSON prediction payload.
          const moves = parseAgentPrediction(response.message.content)
          if (!moves) {
            // Exit 4: no tool calls and the content isn't a valid moves payload either.
            // The full response payload is already in the preceding "Agent response." info log.
            return {
              ok: false,
              reason: "malformed-response",
              diagnostic: {
                message: "Malformed agent prediction response.",
                details: { endpoint: endpointDisplay, requestTurn: requestTurns },
              },
            }
          }
          // Exit 5: the success path — a valid moves prediction.
          return { ok: true, moves }
        }

        // Split this round's requests into calls that actually need servicing and calls that
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
          // Every requested tool this round was already called — no new work to service.
          if (duplicateWarningIssued) {
            // Exit 6: second all-duplicate round in a row despite the reminder — end the turn
            // rather than reminding indefinitely.
            return {
              ok: false,
              reason: "malformed-response",
              diagnostic: {
                message: "Agent kept re-requesting already-called tools after being told so.",
                details: { endpoint: endpointDisplay, requestTurn: requestTurns },
              },
            }
          }

          messages = [
            ...messages,
            { role: "assistant", content: response.message.content ?? "", tool_calls: toolCalls },
            buildDuplicateToolCallMessage(duplicateToolCalls),
          ]
          duplicateWarningIssued = true
          // Loop back: not an exit — a reminder was appended, the turn continues.
          continue
        }

        // Record only the names actually serviced this round, so a later round's duplicate
        // check is judged against real progress, not against calls that were requested but
        // whose name was missing (those fall through to buildToolResultMessages's own failure).
        newToolCalls.forEach((tc) => {
          if (tc.function?.name) calledToolNames.add(tc.function.name)
        })

        const toolResult = await buildToolResultMessages(newToolCalls, toolHandlers)
        if (toolResult.ok === false) {
          const toolNames = newToolCalls
            .map((tc) => tc.function?.name)
            .filter((name): name is string => name !== undefined)

          if (toolResult.reason === "unknown-tool") {
            // Exit 7: the model requested a tool that doesn't exist — most likely a
            // hallucinated call — which is the model's own fault, not an infrastructure issue.
            return {
              ok: false,
              reason: "malformed-response",
              diagnostic: {
                message: "Agent requested an unknown or hallucinated tool.",
                details: { endpoint: endpointDisplay, requestTurn: requestTurns, toolNames },
              },
            }
          }

          // Exit 8: a recognized tool's own handler threw — a bug in our implementation, not
          // something the model did wrong.
          return {
            ok: false,
            reason: "network-error",
            diagnostic: {
              message: "Tool request could not be serviced.",
              details: { endpoint: endpointDisplay, requestTurn: requestTurns, toolNames },
            },
          }
        }

        // Rebind rather than push so the array identity changes each round; the diagnostic log
        // snapshots this reference, and mutating a shared array in place would make every earlier
        // log entry reflect the final state. The content still accumulates — the provider needs
        // the whole conversation each round. Any duplicates mixed in with genuinely new calls
        // still get named, but don't block or reset progress the way an all-duplicate round does.
        messages = [
          ...messages,
          { role: "assistant", content: response.message.content ?? "", tool_calls: toolCalls },
          ...toolResult.messages,
          ...(duplicateToolCalls.length > 0 ? [buildDuplicateToolCallMessage(duplicateToolCalls)] : []),
        ]
        duplicateWarningIssued = false
        // Loop back: not an exit — new tool results were serviced, the turn continues.
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
