import { isMoveAction } from "../traversal"
import { logTapooDiagnostic } from "../logs"
import { CONFIG } from "../config"
import {
  AGENT_CONTEXT_TOOLS,
  PREDICTION_FORMAT,
  buildAgentMessages,
  buildAgentToolHandlers,
} from "./context"
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
  | { ok: false; reason: "malformed-response" | "network-error" }

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
    onNetworkError?: (agent: AgentApiConfig) => void
    onMalformedResponse?: (agent: AgentApiConfig) => void
}

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

// requestChatTurn sends one provider-compatible chat request while keeping wire details local.
async function requestChatTurn(
  endpoint: URL,
  model: string,
  messages: AgentChatMessage[],
  tools: object[],
  signal: AbortSignal,
  mazeArea?: number,
  format?: Record<string, unknown>,
): Promise<AgentChatResponse | null> {

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

  const endpointLabel = `${endpoint.origin}${endpoint.pathname}`
  // Snapshot messages at log time: chatMessages is mutated by push() after each tool round,
  // so storing the live reference would cause all log entries to reflect the final state.
  const agentApiModeName = CONFIG.runtime.controlModes.agentApi
  
  logTapooDiagnostic(agentApiModeName, "info", "Agent request.", {
    endpoint: endpointLabel,
    payload: { ...msgBody, messages: [...messages] },
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
    logTapooDiagnostic(agentApiModeName, "warn", "Agent HTTP response failed.", {
      endpoint: endpointLabel,
      status: response.status,
      statusText: response.statusText,
    })
    return null
  }

  const responseBody = (await response.json()) as AgentChatResponse
  logTapooDiagnostic(agentApiModeName, "info", "Agent response.", {
    endpoint: endpointLabel,
    payload: responseBody,
  })
  return responseBody
}

// requestPredictionWithAbort hides request construction, timeout control, and tool-call servicing.
export function requestPredictionWithAbort({
  lastActionResult,
  state,
  agent,
  maxToolRounds = defaultMaxToolRounds,
  onMalformedResponse,
  onNetworkError,
  timeoutMs,
}: RequestAgentPredictionInput): AgentPredictionRequest {
  // Manual aborts are caller-owned cleanup; timeout aborts remain provider/network failures.
  let activeController: AbortController | null = null
  let wasAborted = false

  // requestChatTurnWithTimeout gives each provider HTTP request its own timeout window.
  const requestChatTurnWithTimeout = async (
    messages: AgentChatMessage[],
    tools: object[],
    format?: Record<string, unknown>,
  ): Promise<AgentChatResponse | null> => {
    const controller = new AbortController()
    activeController = controller
    const requestTimeout = window.setTimeout(() => {
      controller.abort()
    }, timeoutMs)

    try {
      return await requestChatTurn(
        agent.endpoint, agent.model, messages, tools, controller.signal, state.mazeDimensions?.area, format,
      )
    } finally {
      window.clearTimeout(requestTimeout)
      if (activeController === controller) {
        activeController = null
      }
    }
  }

  // notifyFailure centralizes side effects so callers see one classified result path.
  const notifyFailure = (
    reason: Extract<AgentPredictionResult, { ok: false }>["reason"],
  ): void => {
    if (wasAborted) {
      return
    }

    try {
      if (reason === "network-error") {
        onNetworkError?.(agent)
        return
      }

      onMalformedResponse?.(agent)
    } catch {
      // Failure handlers update local game state; they should not recategorize provider results.
    }
  }

  const promise = (async (): Promise<AgentPredictionResult> => {
    try {
      const fail = (
        reason: Extract<AgentPredictionResult, { ok: false }>["reason"],
      ): AgentPredictionResult => {
        notifyFailure(reason)
        return { ok: false, reason }
      }

      // Tool handlers close over the current State snapshot and last replay metadata for this turn.
      const toolHandlers = buildAgentToolHandlers(state, lastActionResult)
      let messages = buildAgentMessages(agent.playerName)
      let availableTools = AGENT_CONTEXT_TOOLS
      // Allow configured tool rounds plus two final no-tools requests for the actual prediction.
      const maxRequestTurns = maxToolRounds + 2
      let requestTurns = 0
      let toolRounds = 0
      // Track which tools have already been called this turn so duplicate-only rounds are skipped.
      const calledToolNames = new Set<string>()

      while (true) {
        requestTurns += 1
        if (requestTurns > maxRequestTurns) {
          return fail("network-error")
        }

        // compactToolsPayload owns all follow-up tool payload decisions: compacts called tools,
        // keeps full definitions for uncalled ones, and returns [] when all tools are exhausted
        // or availableTools was explicitly cleared (max-rounds), switching to prediction mode.
        const toolsToSend = compactToolsPayload(availableTools, calledToolNames, toolRounds)
        const format = toolsToSend.length === 0 ? PREDICTION_FORMAT : undefined
        const response = await requestChatTurnWithTimeout(messages, toolsToSend, format)
        if (!response?.message) {
          return fail("network-error")
        }

        const toolCalls = response.message.tool_calls ?? []
        if (toolCalls.length === 0) {
          // Final assistant content must be the compact JSON prediction payload.
          const moves = parseAgentPrediction(response.message.content)
          if (!moves) {
            // The full response payload is already in the preceding "Agent response." info log.
            logTapooDiagnostic(CONFIG.runtime.controlModes.agentApi, "warn", "Malformed response.", {
              endpoint: `${agent.endpoint.origin}${agent.endpoint.pathname}`,
            })
            return fail("malformed-response")
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
          return fail("network-error")
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
      // Caller-initiated aborts (wasAborted) are silent; all other failures are logged.
      if (!wasAborted) {
        logTapooDiagnostic(CONFIG.runtime.controlModes.agentApi, "warn", "Network error.", {
          endpoint: `${agent.endpoint.origin}${agent.endpoint.pathname}`,
        })
      }
      notifyFailure("network-error")
      return { ok: false, reason: "network-error" }
    }
  })()

  return {
    abort() {
      // Caller aborts are silent; they should not disable agents or spend score.
      wasAborted = true
      activeController?.abort()
      activeController = null
    },
    isAborted() {
      return wasAborted
    },
    promise,
  }
}
