import { isMoveAction } from "../traversal"
import { logTapooDiagnostic } from "../logs"
import { CONFIG } from "../config"
import {
  AGENT_CONTEXT_TOOLS,
  PREDICTION_FORMAT,
  buildAgentMessages,
  buildAgentToolHandlers,
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
type AgentToolCall = {
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
    maxToolRounds?: number
    lastActionResult: MazeActionResult | null
}

type AgentChatTurnResult =
  | { ok: true; response: AgentChatResponse }
  | AgentPredictionFailure

// defaultMaxToolRounds caps context-gathering rounds per prediction turn. The higher limit
// reserves capacity for future multi-agent levels; duplicate-call detection (below) prevents
// the model from wasting rounds by calling the same tool more than once per turn.
const defaultMaxToolRounds = 4

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

// loggedDescriptionPreviewLength caps how much of a known long/repeated description field
// survives into the log when the full text isn't needed.
const loggedDescriptionPreviewLength = 50

// trimLoggedDescription is the single place every long, repeated description field goes through
// before being logged. Passing keepFull lets each call site decide once whether this entry needs
// the real text (e.g. the level's first request) or just a short, recognizable preview.
function trimLoggedDescription(
  description: string | undefined,
  keepFull: boolean,
): string | undefined {
  if (keepFull || !description || description.length <= loggedDescriptionPreviewLength) {
    return description
  }

  return `${description.slice(0, loggedDescriptionPreviewLength)}.....`
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
): Promise<AgentChatMessage[] | null> {
  const toolMessages: AgentChatMessage[] = []

  for (const toolCall of toolCalls) {
    // Unknown or unnamed tools are treated as provider/request failures, not agent mistakes.
    const toolName = toolCall.function?.name
    if (!toolName) {
      return null
    }

    const handler = toolHandlers[toolName]
    if (!handler) {
      return null
    }

    try {
      // Tool handlers own Tapoo context extraction; this layer only adapts them to chat messages.
      const result = await handler(normalizeToolArguments(toolCall.function?.arguments))
      toolMessages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        tool_name: toolCall.function?.name,
        content: serializeToolResult(result),
      })
    } catch {
      return null
    }
  }

  return toolMessages
}

// compactToolsPayload manages the follow-up tool payload in one place:
// - Round 0 or no tools: returns tools unchanged (full definitions for the first request).
// - All tools called: returns [] to signal prediction mode (no tools, structured-output format).
// - Otherwise: compact called tools to name-only (model already has their definitions in context)
//   and keep uncalled tools at full definition to prompt the model to consider them.
function compactToolsPayload(
  tools: AgentToolDefinition[],
  calledToolNames: Set<string>,
  toolRounds: number,
): object[] {
  if (toolRounds === 0 || tools.length === 0) return tools
  if (tools.every((t) => calledToolNames.has(t.function.name))) return []
  return tools.map((t) =>
    calledToolNames.has(t.function.name)
      ? { type: t.type, function: { name: t.function.name } }
      : t
  )
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
    mode: format !== undefined ? "predict" : "tools",
    tools: tools.map((tool) => previewLoggedTool(tool, keepFull)),
    newMessages: messages.map((msg) => previewLoggedMessage(msg, keepFull)),
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
  maxToolRounds = defaultMaxToolRounds,
  timeoutMs,
}: RequestAgentPredictionInput): AgentPredictionRequest {
  // Expected aborts are lifecycle cleanup; timeout aborts remain provider/network failures.
  let activeController: AbortController | null = null
  let wasExpectedAbort = false

  // A level's first agent-api request is the only one that needs the full system/user prompt
  // and tool descriptions logged; every later turn repeats that same static content.
  const isFirstRequestOfLevel = state.agentRequestCount === 0

  // requestChatTurnWithTimeout gives each provider HTTP request its own timeout window.
  const requestChatTurnWithTimeout = async (
    messages: AgentChatMessage[],
    tools: object[],
    format: Record<string, unknown> | undefined,
    reqTurn: number,
  ): Promise<AgentChatTurnResult> => {
    const controller = new AbortController()
    activeController = controller
    const requestTimeout = window.setTimeout(() => {
      controller.abort()
    }, timeoutMs)

    try {
      return await requestChatTurn(
        agent.endpoint, agent.model, messages, tools, controller.signal,
        state.mazeDimensions?.area, format, reqTurn, isFirstRequestOfLevel,
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
      let availableTools = AGENT_CONTEXT_TOOLS
      // Allow configured tool rounds plus two final no-tools requests for the actual prediction.
      const maxRequestTurns = maxToolRounds + 2
      let requestTurns = 0
      let toolRounds = 0
      // Track which tools have already been called this turn so duplicate-only rounds are skipped.
      const calledToolNames = new Set<string>()

      while (true) {
        // Guards the window between rounds where activeController is briefly null (after one
        // round's cleanup, before the next round's fetch starts) — without this, an abort() call
        // landing in that window would otherwise be silently dropped and the next round would
        // fire anyway, ignoring the caller's request to stop.
        if (wasExpectedAbort) {
          return { ok: false, reason: "caller-abort" }
        }

        requestTurns += 1
        if (requestTurns > maxRequestTurns) {
          // Failing to converge on a final prediction within the round budget is the agent's own
          // behavior, not an external failure — the same bucket as a malformed response, so it
          // gets the mistake penalty and keeps playing rather than being disabled for investigation.
          return {
            ok: false,
            reason: "malformed-response",
            diagnostic: {
              message: "Agent request exceeded provider turn limit.",
              details: { endpoint: endpointDisplay, maxRequestTurns, requestTurns },
            },
          }
        }

        // compactToolsPayload owns all follow-up tool payload decisions: compacts called tools,
        // keeps full definitions for uncalled ones, and returns [] when all tools are exhausted
        // or availableTools was explicitly cleared (max-rounds), switching to prediction mode.
        const toolsToSend = compactToolsPayload(availableTools, calledToolNames, toolRounds)
        const format = toolsToSend.length === 0 ? PREDICTION_FORMAT : undefined
        const chatTurn = await requestChatTurnWithTimeout(messages, toolsToSend, format, requestTurns)
        if (chatTurn.ok === false) {
          return chatTurn
        }

        const { response } = chatTurn
        if (!response.message) {
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
          return { ok: true, moves }
        }

        // If every requested tool was already called this turn, skip appending duplicate messages
        // to keep the context window bounded. Clear availableTools so compactToolsPayload returns []
        // on the next iteration, switching to prediction mode regardless of how many tools remain.
        // (compactToolsPayload alone only clears when every *available* tool is exhausted; the model
        // could otherwise keep requesting the same subset of duplicates until maxRequestTurns.)
        const requestedNames = toolCalls.map((tc) => tc.function?.name)
          .filter((name): name is string => name !== undefined)
        if (requestedNames.length > 0 && requestedNames.every((name) => calledToolNames.has(name))) {
          availableTools = []
          continue
        }
        requestedNames.forEach((name) => calledToolNames.add(name))

        const toolMessages = await buildToolResultMessages(toolCalls, toolHandlers)
        if (!toolMessages) {
          return {
            ok: false,
            reason: "network-error",
            diagnostic: {
              message: "Tool request could not be serviced.",
              details: {
                endpoint: endpointDisplay,
                requestTurn: requestTurns,
                toolNames: requestedNames,
              },
            },
          }
        }

        // Build a fresh messages array for the next request so each turn's log entry captures
        // only the messages that were actually sent in that turn, not the accumulated history.
        messages = [
          ...messages,
          { role: "assistant", content: response.message.content ?? "", tool_calls: toolCalls },
          ...toolMessages,
        ]

        toolRounds += 1
        if (toolRounds >= maxToolRounds) {
          // After enough context rounds, remove tools to nudge the model into a final prediction.
          availableTools = []
        }
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
