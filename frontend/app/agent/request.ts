import { isMoveAction } from "../traversal"
import { APP_VERSION } from "../config"
import {
  AGENT_CONTEXT_TOOLS,
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

type AgentMessageRole = "assistant" | "tool" | "user" | "system" | "developer"

// AgentToolDefinition mirrors the provider tool schema Tapoo sends with each chat request.
export type AgentToolDefinition = {
  type: "function"
  function: {
    name: string
    description: string
    parameters: {
      type: "object"
      additionalProperties?: boolean
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
  tool_name?: string
  tool_calls?: AgentToolCall[]
}

type AgentChatResponse = {
  message?: {
    role?: AgentMessageRole
    content?: string
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
    onMalformedResponse?: (agent: AgentApiConfig) => void
    onNetworkError?: (agent: AgentApiConfig) => void
}

// defaultMaxToolRounds prevents a model from looping indefinitely through context tools.
const defaultMaxToolRounds = 4

// parseAgentPrediction extracts the single supported prediction payload from final model content.
function parseAgentPrediction(content: string | undefined): MoveAction[] | null {
  if (!content) {
    return null
  }

  let payload: AgentPredictionPayload
  try {
    payload = JSON.parse(content) as AgentPredictionPayload
  } catch {
    return null
  }

  const { moves } = payload
  if (!Array.isArray(moves) || moves.length === 0) {
    return null
  }

  // Reuse the shared action validator so request parsing stays aligned with game controls.
  const isPredictedMove = (move: unknown): move is MoveAction => {
    return typeof move === "string" && isMoveAction({ type: move } as MazeAction)
  }

  return moves.every(isPredictedMove) ? [...moves] : null
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
        tool_name: toolName,
        content: serializeToolResult(result),
      })
    } catch {
      return null
    }
  }

  return toolMessages
}

// requestChatTurn sends one provider-compatible chat request while keeping wire details local.
async function requestChatTurn(
  endpoint: string,
  model: string,
  messages: AgentChatMessage[],
  tools: AgentToolDefinition[],
  signal: AbortSignal,
): Promise<AgentChatResponse | null> {
  // The request body stays provider-neutral enough for Ollama-style chat APIs without importing SDKs.
  const response = await fetch(endpoint, {
    body: JSON.stringify({
      model,
      messages,
      tools,
      think: false,
      stream: false,
      format: "json",
    }),
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "X-Tapoo-Agent": `tapoo:v${APP_VERSION}`,
    },
    method: "POST",
    signal,
  })

  if (!response.ok) {
    return null
  }

  return (await response.json()) as AgentChatResponse
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
  let wasAborted = false
  const controller = new AbortController()
  const timeout = window.setTimeout(() => {
    controller.abort()
  }, timeoutMs)

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
      const chatMessages = buildAgentMessages(agent.playerName)
      // Tool handlers close over the current State snapshot and last replay metadata for this turn.
      const toolHandlers = buildAgentToolHandlers(state, agent, lastActionResult)
      let toolRounds = 0

      while (true) {
        // Each turn sends the accumulated chat/tool transcript until final moves are returned.
        const response = await requestChatTurn(
          agent.endpoint,
          agent.model,
          chatMessages,
          AGENT_CONTEXT_TOOLS,
          controller.signal,
        )
        if (!response?.message) {
          return fail("network-error")
        }

        const toolCalls = response.message.tool_calls ?? []
        if (toolCalls.length === 0) {
          // Final assistant content must be the compact JSON prediction payload.
          const moves = parseAgentPrediction(response.message.content)
          return moves
            ? { ok: true, moves }
            : fail("malformed-response")
        }

        toolRounds += 1
        if (toolRounds > maxToolRounds) {
          // Too many tool rounds usually means the model is not converging toward final moves.
          return fail("network-error")
        }

        // Tool results are appended here so agent-api.ts never manages chat protocol details.
        chatMessages.push({
          role: "assistant",
          content: response.message.content ?? "",
          tool_calls: toolCalls,
        })

        const toolMessages = await buildToolResultMessages(
          toolCalls,
          toolHandlers,
        )
        if (!toolMessages) {
          return fail("network-error")
        }

        chatMessages.push(...toolMessages)
      }
    } catch {
      // Fetch failures, timeout aborts, and tool-service failures share one network bucket.
      notifyFailure("network-error")
      return { ok: false, reason: "network-error" }
    } finally {
      window.clearTimeout(timeout)
    }
  })()

  return {
    abort() {
      // Caller aborts are silent; they should not disable agents or spend score.
      wasAborted = true
      controller.abort()
      window.clearTimeout(timeout)
    },
    isAborted() {
      return wasAborted
    },
    promise,
  }
}

// requestAgentPrediction returns only final movement predictions for callers that do not need abort control.
export async function requestAgentPrediction(
  input: RequestAgentPredictionInput,
): Promise<AgentPredictionResult> {
  return requestPredictionWithAbort(input).promise
}
