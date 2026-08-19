// Wire-format adapters for each supported agent API provider. This is the only layer that speaks
// a provider's literal request/response shape — request.ts keeps using its own internal dialect
// (AgentChatMessage[], OpenAI-shaped AgentToolDefinition[], and wantsPredictionFormat as a
// structured-output intent flag rather than a literal wire field) both before a request is built
// and after a response is read back. Kept apart from ../agent/config.ts, which validates the
// human-facing form fields rather than anything that goes on the wire, so storage.ts can keep
// importing that leaf cheaply.
import { CONFIG } from "../config"
import { EXPECTED_RESPONSE_SCHEMA } from "./context"
import type {
  AgentApiProvider,
  AgentChatMessage,
  AgentReasoningEffort,
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
  wantsPredictionFormat: boolean
  reasoningEffort: AgentReasoningEffort
}

export type ProviderAdapter = {
  buildHeaders: (credential: string | undefined, extraHeaders: Record<string, string>) => Record<string, string>
  buildBody: (input: ProviderRequestInput) => Record<string, unknown>
  readMessage: (body: unknown) => AgentChatMessage | undefined
}

// tokenCount accepts only finite non-negative provider counters. A missing or malformed usage
// value stays undefined instead of becoming a misleading zero in internal message metadata.
function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}

// ollamaMessage removes Tapoo-only metadata before using the otherwise-compatible internal shape.
function ollamaMessage(message: AgentChatMessage): Omit<AgentChatMessage, "tokens_used"> {
  const rest = { ...message }
  delete rest.tokens_used
  return rest
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
// The provider Tapoo originally spoke natively.

function ollamaBuildBody(input: ProviderRequestInput): Record<string, unknown> {
  return {
    model: input.model,
    messages: input.messages.map(ollamaMessage),
    tools: input.tools,
    options: {
      num_ctx: CONFIG.runtime.modelConfig.contextWindowFloor,
      num_predict: CONFIG.runtime.modelConfig.maxTokens,
    },
    ...(input.wantsPredictionFormat ? OLLAMA_PREDICTION_FORMAT : {}),
    ...BASE_BODY,
    // Ollama's think is a plain boolean — the finest-grained control it exposes — so "none" is the
    // only reasoningEffort level that disables it; every other configured level (just "max", per
    // agentConfig.reasoningEffortOptions.ollama) enables it.
    think: input.reasoningEffort !== "none",
  }
}

type OllamaResponseBody = {
  eval_count?: number
  message?: {
    role?: AgentChatMessage["role"]
    content?: string
    thinking?: string
    tool_calls?: AgentToolCall[]
  }
}

function ollamaReadMessage(body: unknown): AgentChatMessage | undefined {
  const responseBody = body as OllamaResponseBody
  const message = responseBody.message
  if (!message) {
    return undefined
  }
  // eval_count is the completion side alone (excludes prompt_eval_count) — see AgentChatMessage's
  // tokens_used comment for why only the completion side is tracked.
  const tokensUsed = tokenCount(responseBody.eval_count)

  return {
    role: message.role ?? "assistant",
    content: message.content,
    // thinking is Ollama's wire name for the same concept the openai-compatible adapter below
    // calls reasoning — mapped onto that shared internal field so request.ts's echoBackReasoning
    // handling (and every other reasoning consumer) works identically across providers.
    reasoning: message.thinking,
    ...(tokensUsed !== undefined ? { tokens_used: tokensUsed } : {}),
    tool_calls: message.tool_calls,
  }
}

// --- OpenAI (and OpenAI-compatible servers: vLLM, LM Studio, llama.cpp, etc.) ---

// openaiMessage translates one internal-dialect message onto the openai wire shape: drops
// tool_name (an Ollama-only field request.ts stamps onto every tool-result message for its own
// diagnostics, which OpenAI-compatible servers running strict schema validation reject outright),
// and renames reasoning to reasoning_content — the wire name this adapter's servers use, mirroring
// openaiReadMessage's reverse translation on the way in. request.ts only ever builds/reads the
// internal reasoning field; this is the one place that name changes for the wire.
function openaiMessage(
  message: AgentChatMessage,
): Omit<AgentChatMessage, "tool_name" | "reasoning" | "tokens_used"> & { reasoning_content?: string } {
  const rest: AgentChatMessage & { reasoning_content?: string } = { ...message }
  delete rest.tool_name
  delete rest.tokens_used
  const reasoning = rest.reasoning
  delete rest.reasoning
  if (reasoning !== undefined) {
    rest.reasoning_content = reasoning
  }
  return rest
}

// Unlike Ollama's think, there is no single OpenAI-compatible field that reliably disables
// reasoning across servers. reasoning_effort ("low"/"medium"/"high"/"max") is the one sent here, since it
// is documented by multiple reasoning models (OpenAI's o-series, Kimi K3) rather than being a
// server-specific convention — omitted entirely for "none", the closest equivalent to disabling it.
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
    max_tokens: CONFIG.runtime.modelConfig.maxTokens,
    ...(input.reasoningEffort !== "none" ? { reasoning_effort: input.reasoningEffort } : {}),
    ...(input.wantsPredictionFormat ? OPENAI_PREDICTION_FORMAT : {}),
    ...BASE_BODY,
  }
}

type OpenAiResponseBody = {
  usage?: {
    completion_tokens?: number
  }
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
  const responseBody = body as OpenAiResponseBody
  const message = responseBody.choices?.[0]?.message
  if (!message) {
    return undefined
  }

  // completion_tokens is the completion side alone (excludes prompt_tokens) — see
  // AgentChatMessage's tokens_used comment for why only the completion side is tracked.
  const tokensUsed = tokenCount(responseBody.usage?.completion_tokens)

  return {
    role: message.role ?? "assistant",
    content: message.content ?? undefined,
    // reasoning_content is the openai-compatible wire name for the same concept Ollama calls
    // thinking — mapped onto the shared internal reasoning field so request.ts's echoBackReasoning
    // handling works identically regardless of which provider is active.
    reasoning: message.reasoning_content,
    ...(tokensUsed !== undefined ? { tokens_used: tokensUsed } : {}),
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
  | { type: "thinking"; thinking: string; signature?: string }

// ANTHROPIC_THINKING_RESERVE_FRACTION is the share of maxTokens (Anthropic's max_tokens) reserved
// for the model's actual reply, never spent on thinking — Anthropic rejects a request where
// budget_tokens is not strictly less than max_tokens, and a "max" allocation that ate the whole
// budget would leave no room for a reply at all.
const ANTHROPIC_THINKING_RESERVE_FRACTION = 0.2

// anthropicThinkingBudget subdivides the reasoning-usable share of maxTokens evenly across
// Anthropic's own ordered option list (agentConfig.reasoningEffortOptions.anthropic — read from
// there rather than a second hardcoded list, so the two can't drift apart), so the scale stays
// correct if maxTokens itself is ever retuned rather than hardcoding numbers that would silently
// drift out of sync with it. At the current maxTokens of 10_000 this yields low=2000, medium=4000,
// high=6000, max=8000.
function anthropicThinkingBudget(effort: AgentReasoningEffort): number {
  const levels = CONFIG.agentConfig.reasoningEffortOptions.anthropic
  const usableBudget = CONFIG.runtime.modelConfig.maxTokens * (1 - ANTHROPIC_THINKING_RESERVE_FRACTION)
  const step = usableBudget / levels.length
  const levelIndex = Math.max(0, levels.indexOf(effort))
  return Math.round(step * (levelIndex + 1))
}

function anthropicToolDefinitions(tools: AgentToolDefinition[]) {
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters,
  }))
}

// anthropicAssistantContent folds an assistant turn's text and tool_calls into typed blocks,
// omitting an empty text block entirely rather than sending one Anthropic would reject. Deliberately
// never replays a thinking block: Anthropic requires that block's original signature verbatim to
// accept it back on a later turn, and AgentChatMessage.reasoning is a plain string with no
// signature — replaying content without one would make Anthropic reject the request outright, so
// echoBackReasoning currently has no effect for Anthropic agents (only Ollama/OpenAI-compatible
// reasoning is actually echoed back).
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

    // "user" role: plain text turn (e.g. a corrective warning). Anthropic rejects consecutive
    // same-role turns, and this can immediately follow a tool-result turn (also mapped to "user"
    // above) or another plain-text turn — so fold it into the previous turn instead of opening a
    // new one, the same way consecutive tool results already coalesce above. Prefixed ahead of the
    // existing content so the warning reads first, with what it's warning about following it.
    const previous = anthropicMessages[anthropicMessages.length - 1]
    if (previous && previous.role === "user" && message.content) {
      if (Array.isArray(previous.content)) {
        previous.content.unshift({ type: "text", text: message.content })
      } else {
        previous.content = previous.content
          ? `${message.content}\n\n${previous.content}`
          : message.content
      }
      continue
    }

    anthropicMessages.push({ role: "user", content: message.content ?? "" })
  }

  return {
    model: input.model,
    ...(systemMessage?.content ? { system: systemMessage.content } : {}),
    messages: anthropicMessages,
    tools: anthropicToolDefinitions(input.tools),
    max_tokens: CONFIG.runtime.modelConfig.maxTokens,
    // Anthropic has no "none" reasoning-effort option (agentConfig.reasoningEffortOptions.anthropic),
    // so thinking is always enabled here — every configured level maps to a budget_tokens share of
    // maxTokens (see anthropicThinkingBudget). Temperature is intentionally provider-controlled
    // across all adapters; Anthropic specifically requires its default of 1 while thinking is enabled.
    thinking: { type: "enabled", budget_tokens: anthropicThinkingBudget(input.reasoningEffort) },
    ...(input.wantsPredictionFormat ? ANTHROPIC_PREDICTION_FORMAT : {}),
    ...BASE_BODY,
  }
}

type AnthropicResponseBody = {
  role?: AgentChatMessage["role"]
  content?: AnthropicContentBlock[]
  usage?: {
    output_tokens?: number
  }
}

function anthropicReadMessage(body: unknown): AgentChatMessage | undefined {
  const responseBody = body as AnthropicResponseBody
  if (!Array.isArray(responseBody.content)) {
    return undefined
  }

  let content = ""
  let reasoning = ""
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
    } else if (block.type === "thinking") {
      // Mapped onto the same shared internal reasoning field Ollama's thinking and the
      // openai-compatible adapter's reasoning_content map onto — see anthropicAssistantContent for
      // why this is never echoed back on a later turn despite being read here.
      reasoning += block.thinking
    }
  }

  // output_tokens alone is the completion side billed against max_tokens — it already includes
  // extended-thinking tokens. See AgentChatMessage's tokens_used comment for why only the
  // completion side is tracked (input_tokens and the cache-token fields are never read).
  const tokensUsed = tokenCount(responseBody.usage?.output_tokens)

  return {
    role: responseBody.role ?? "assistant",
    content,
    ...(reasoning ? { reasoning } : {}),
    ...(tokensUsed !== undefined ? { tokens_used: tokensUsed } : {}),
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
