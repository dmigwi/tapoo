// Wire-format adapters for each supported agent API provider. This is the only layer that speaks
// a provider's literal request/response shape — request.ts keeps using its own internal dialect
// (AgentChatMessage[], OpenAI-shaped AgentToolDefinition[], and wantsPredictionFormat as a
// structured-output intent flag rather than a literal wire field) both before a request is built
// and after a response is read back. Kept apart from ../agent/config.ts, which validates the
// human-facing form fields rather than anything that goes on the wire, so storage.ts can keep
// importing that leaf cheaply — this file pulls in contextWindowForArea (protocol.ts), which
// storage.ts's restore path has no reason to depend on.
import { CONFIG } from "../config"
import { EXPECTED_RESPONSE_SCHEMA } from "./context"
import { contextWindowForArea } from "./protocol"
import type {
  AgentApiProvider,
  AgentChatMessage,
  AgentToolCall,
  AgentToolDefinition,
} from "../types"

// ProviderRequestInput is everything a provider needs to assemble one chat request body. It
// intentionally mirrors requestChatTurn's existing parameters rather than the whole AgentApiConfig,
// so an adapter cannot reach for credential/extraHeaders by accident — those two are threaded
// separately, only into buildHeaders, which is what keeps them out of anything that could end up
// logged (see the "Agent request." log entry in request.ts). wantsPredictionFormat is the only
// structured-output signal request.ts needs to send — the schema itself, and how each provider
// wraps it on the wire, live entirely below.
export type ProviderRequestInput = {
  model: string
  messages: AgentChatMessage[]
  tools: AgentToolDefinition[]
  mazeArea: number | undefined
  wantsPredictionFormat: boolean
}

export type ProviderAdapter = {
  buildHeaders: (credential: string | undefined, extraHeaders: Record<string, string>) => Record<string, string>
  buildBody: (input: ProviderRequestInput) => Record<string, unknown>
  readMessage: (body: unknown) => AgentChatMessage | undefined
}

const BASE_HEADERS = {
  "Accept": "application/json",
  "Content-Type": "application/json",
}

// BASE_BODY is shared across all three wire bodies: Tapoo only ever wants one full response per
// request, never an incrementally streamed one. Kept apart from BASE_HEADERS since it belongs in
// the body, not the headers, of the fetch call each adapter's buildBody feeds into.
const BASE_BODY = {
  stream: false,
}

// PREDICTION_FORMAT is the JSON Schema constraint every provider's structured-output request
// enforces, shared across all three. It cannot just reuse EXPECTED_RESPONSE_SCHEMA.properties
// verbatim: that schema's moves.minItems is useful prompt-facing documentation (read by the model
// via get_prediction_rules, never validated against), but OpenAI's strict json_schema
// response_format only accepts a restricted JSON Schema subset that excludes array keywords like
// minItems/maxItems outright — confirmed by a real 400 from an OpenAI-compatible endpoint:
// "Invalid fields for schema with types ['array']: {'minItems'}", param "response_format". Also
// drops EXPECTED_RESPONSE_SCHEMA's own description for the same reason it always did: that text is
// prompt-facing annotation, not something any provider's schema-validation payload needs.
const PREDICTION_FORMAT = {
  type: "object",
  additionalProperties: false,
  required: EXPECTED_RESPONSE_SCHEMA.required,
  properties: {
    moves: {
      type: EXPECTED_RESPONSE_SCHEMA.properties.moves.type,
      items: EXPECTED_RESPONSE_SCHEMA.properties.moves.items,
    },
  },
} as const

// Each provider wraps that same schema differently on the wire — grouped together here (rather
// than beside each buildBody) so the three wrapping conventions can be compared at a glance.
// Exported (not just used internally by buildBody) so tests can assert against the real wrapped
// shape instead of duplicating it in a fixture; nothing in production ever imports these directly.
// Ollama takes the schema directly as its `format` field — no extra wrapping.
export const OLLAMA_PREDICTION_FORMAT = { format: PREDICTION_FORMAT }
// OpenAI wraps the schema in a strict json_schema response_format.
export const OPENAI_PREDICTION_FORMAT = {
  response_format: {
    type: "json_schema",
    json_schema: { name: "tapoo_prediction", strict: true, schema: PREDICTION_FORMAT },
  },
}
// Anthropic wraps the schema inside output_config.format.
export const ANTHROPIC_PREDICTION_FORMAT = {
  output_config: { format: { type: "json_schema", schema: PREDICTION_FORMAT } },
}

// bearerHeaders is shared by ollama and openai: both accept a plain Authorization: Bearer header,
// sent only when a credential was actually configured — an empty header is worse than none, since
// some servers reject a malformed Authorization value outright rather than treating it as absent.
// extraHeaders is spread last so a user's own configured headers can override a default if they
// choose to — e.g. supplying their own Authorization value.
function bearerHeaders(
  credential: string | undefined,
  extraHeaders: Record<string, string>,
): Record<string, string> {
  return {
    ...BASE_HEADERS,
    ...(credential ? { "Authorization": `Bearer ${credential}` } : {}),
    ...extraHeaders,
  }
}

// --- Ollama ---
// The provider Tapoo originally spoke natively. buildBody's shape here must stay byte-identical to
// the body requestChatTurn built before this file existed, since request.test.ts asserts it exactly.

function ollamaBuildBody(input: ProviderRequestInput): Record<string, unknown> {
  return {
    model: input.model,
    messages: input.messages,
    tools: input.tools,
    options: {
      num_ctx: contextWindowForArea(input.mazeArea),
      temperature: CONFIG.runtime.modelConfig.temperature,
      num_predict: CONFIG.runtime.modelConfig.numPredict,
    },
    ...(input.wantsPredictionFormat ? OLLAMA_PREDICTION_FORMAT : {}),
    think: false,
    ...BASE_BODY,
  }
}

type OllamaResponseBody = {
  message?: {
    role?: AgentChatMessage["role"]
    content?: string
    thinking?: string
    tool_calls?: AgentToolCall[]
  }
}

function ollamaReadMessage(body: unknown): AgentChatMessage | undefined {
  const message = (body as OllamaResponseBody).message
  if (!message) {
    return undefined
  }

  return {
    role: message.role ?? "assistant",
    content: message.content,
    tool_calls: message.tool_calls,
  }
}

// --- OpenAI (and OpenAI-compatible servers: vLLM, LM Studio, llama.cpp, etc.) ---

// openaiMessage drops tool_name: it is an Ollama-only field request.ts stamps onto every tool-result
// message (for its own diagnostics), and OpenAI-compatible servers running strict schema validation
// reject unrecognized message fields outright.
function openaiMessage(message: AgentChatMessage): Omit<AgentChatMessage, "tool_name"> {
  const rest: AgentChatMessage = { ...message }
  delete rest.tool_name
  return rest
}

// Unlike Ollama's think, there is no single OpenAI-compatible field that reliably disables
// reasoning across servers. reasoning_effort ("low"/"high"/"max") is the one sent here, since it
// is documented by multiple reasoning models (OpenAI's o-series, Kimi K3) rather than being a
// server-specific convention.
const OPENAI_REASONING_EFFORT_HINT = {
  reasoning_effort: "high",
}

function openaiBuildBody(input: ProviderRequestInput): Record<string, unknown> {
  return {
    model: input.model,
    messages: input.messages.map(openaiMessage),
    tools: input.tools,
    // max_tokens, not max_completion_tokens: the latter is OpenAI's own newer alias, but it isn't
    // a documented field for Hugging Face's Inference Providers router (its payload spec lists
    // only max_tokens) or for most self-hosted OpenAI-compatible servers this adapter's endpoint
    // placeholders target (vLLM, LM Studio, llama.cpp). A silently-ignored cap here was
    // indistinguishable from a respected one in a short reply, but surfaced directly once a
    // verbose reasoning model ran long enough to actually hit — and blow past — an uncapped limit.
    max_tokens: CONFIG.runtime.modelConfig.numPredict,
    ...OPENAI_REASONING_EFFORT_HINT,
    ...(input.wantsPredictionFormat ? OPENAI_PREDICTION_FORMAT : {}),
    ...BASE_BODY,
  }
}

type OpenAiResponseBody = {
  choices?: {
    message?: {
      role?: AgentChatMessage["role"]
      content?: string | null
      reasoning_content?: string
      tool_calls?: AgentToolCall[]
    }
  }[]
}

function openaiReadMessage(body: unknown): AgentChatMessage | undefined {
  const message = (body as OpenAiResponseBody).choices?.[0]?.message
  if (!message) {
    return undefined
  }

  return {
    role: message.role ?? "assistant",
    content: message.content ?? undefined,
    reasoning_content: message.reasoning_content,
    tool_calls: message.tool_calls,
  }
}

// --- Anthropic ---
// The one non-1:1 transform: the system prompt moves out of `messages` into a top-level `system`
// field, tool calls/results become typed content blocks, consecutive tool-result messages must be
// coalesced into a single user turn (Anthropic rejects consecutive same-role turns), and an empty
// assistant text block is rejected outright rather than tolerated the way Ollama/OpenAI accept "".

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string }

function anthropicToolDefinitions(tools: AgentToolDefinition[]) {
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters,
  }))
}

// anthropicAssistantContent folds an assistant turn's text and tool_calls into typed blocks,
// omitting an empty text block entirely rather than sending one Anthropic would reject.
function anthropicAssistantContent(message: AgentChatMessage): AnthropicContentBlock[] {
  const blocks: AnthropicContentBlock[] = []
  if (message.content) {
    blocks.push({ type: "text", text: message.content })
  }

  for (const call of message.tool_calls ?? []) {
    if (!call.function?.name) continue
    blocks.push({
      type: "tool_use",
      // Falls back to the function name for an id-less call — anthropicBuildBody's tool_result
      // branch mirrors this exact fallback so the two block types stay pairable by id.
      id: call.id ?? call.function.name,
      name: call.function.name,
      input: typeof call.function.arguments === "object" && call.function.arguments !== null
        ? call.function.arguments
        : {},
    })
  }

  return blocks
}

function anthropicBuildBody(input: ProviderRequestInput): Record<string, unknown> {
  const systemMessage = input.messages.find((message) => message.role === "system")
  const anthropicMessages: { role: "user" | "assistant"; content: string | AnthropicContentBlock[] }[] = []

  for (const message of input.messages) {
    if (message.role === "system") {
      continue
    }

    if (message.role === "tool") {
      const toolResultBlock: AnthropicContentBlock = {
        type: "tool_result",
        // Falls back to tool_name the same way anthropicAssistantContent's tool_use.id does — both
        // must agree on the same id for an id-less call, or Anthropic can't pair this result back
        // to the tool_use block that requested it.
        tool_use_id: message.tool_call_id ?? message.tool_name ?? "",
        content: message.content ?? "",
      }

      // Coalesce consecutive tool results into the same user turn — Anthropic rejects consecutive
      // same-role turns, and a single tool-servicing round can produce several results in a row.
      const previous = anthropicMessages[anthropicMessages.length - 1]
      if (previous && previous.role === "user" && Array.isArray(previous.content)) {
        previous.content.push(toolResultBlock)
      } else {
        anthropicMessages.push({ role: "user", content: [toolResultBlock] })
      }
      continue
    }

    if (message.role === "assistant") {
      anthropicMessages.push({ role: "assistant", content: anthropicAssistantContent(message) })
      continue
    }

    // "user" role: plain text turn.
    anthropicMessages.push({ role: "user", content: message.content ?? "" })
  }

  return {
    model: input.model,
    ...(systemMessage?.content ? { system: systemMessage.content } : {}),
    messages: anthropicMessages,
    tools: anthropicToolDefinitions(input.tools),
    max_tokens: CONFIG.runtime.modelConfig.numPredict,
    ...(input.wantsPredictionFormat ? ANTHROPIC_PREDICTION_FORMAT : {}),
    ...BASE_BODY,
  }
}

type AnthropicResponseBody = {
  role?: AgentChatMessage["role"]
  content?: AnthropicContentBlock[]
}

function anthropicReadMessage(body: unknown): AgentChatMessage | undefined {
  const responseBody = body as AnthropicResponseBody
  if (!Array.isArray(responseBody.content)) {
    return undefined
  }

  let content = ""
  const toolCalls: AgentToolCall[] = []

  for (const block of responseBody.content) {
    if (block.type === "text") {
      content += block.text
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        type: "function",
        function: { name: block.name, arguments: block.input },
      })
    }
  }

  return {
    role: responseBody.role ?? "assistant",
    content,
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  }
}

// anthropic-version has no default here — Anthropic requires it, but pinning a value in code would
// go stale as their API evolves, so it is the user's responsibility to supply it via extraHeaders
// (e.g. "anthropic-version: 2023-06-01"); extraHeadersPlaceholders (config.ts) hints at this when
// Anthropic is the selected provider.
function anthropicHeaders(
  credential: string | undefined,
  extraHeaders: Record<string, string>,
): Record<string, string> {
  return {
    ...BASE_HEADERS,
    // Required for any Anthropic call made from a browser origin rather than a server backend.
    "anthropic-dangerous-direct-browser-access": "true",
    ...(credential ? { "x-api-key": credential } : {}),
    ...extraHeaders,
  }
}

// PROVIDER_ADAPTERS keys one adapter per AgentApiProvider, matching the existing MOVE_DELTAS /
// AGENT_CONTEXT_TOOLS table convention: a fourth provider becomes a compile error at this one site.
export const PROVIDER_ADAPTERS: Record<AgentApiProvider, ProviderAdapter> = {
  ollama: {
    buildHeaders: bearerHeaders,
    buildBody: ollamaBuildBody,
    readMessage: ollamaReadMessage,
  },
  openai: {
    buildHeaders: bearerHeaders,
    buildBody: openaiBuildBody,
    readMessage: openaiReadMessage,
  },
  anthropic: {
    buildHeaders: anthropicHeaders,
    buildBody: anthropicBuildBody,
    readMessage: anthropicReadMessage,
  },
}
