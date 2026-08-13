import { describe, expect, it } from "vitest"

import { CONFIG } from "../config"
import {
  ANTHROPIC_PREDICTION_FORMAT,
  OLLAMA_PREDICTION_FORMAT,
  OPENAI_PREDICTION_FORMAT,
  PROVIDER_ADAPTERS,
} from "./providers"
import type { ProviderRequestInput } from "./providers"
import type { AgentChatMessage, AgentToolDefinition } from "../types"

const { contextWindowFloor, temperature, numPredict } = CONFIG.runtime.modelConfig

const tools: AgentToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_game_status",
      description: "Get current status.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
]

function requestInput(overrides: Partial<ProviderRequestInput> = {}): ProviderRequestInput {
  return {
    model: "llama3.2",
    messages: [
      { role: "system", content: "You are Blue." },
      { role: "user", content: "It is Blue's turn." },
    ],
    tools,
    wantsPredictionFormat: false,
    reasoningEffort: "max",
    ...overrides,
  }
}

describe("PROVIDER_ADAPTERS", () => {
  it("keys exactly the three supported providers", () => {
    expect(Object.keys(PROVIDER_ADAPTERS).sort()).toEqual(["anthropic", "ollama", "openai"])
  })

  it("gives every provider its own wire-specific prediction format wrapper", () => {
    expect(OLLAMA_PREDICTION_FORMAT).toHaveProperty("format")
    expect(OPENAI_PREDICTION_FORMAT).toHaveProperty("response_format")
    expect(ANTHROPIC_PREDICTION_FORMAT).toHaveProperty("output_config")
  })
})

describe("ollama adapter", () => {
  it("omits Authorization when no credential is configured", () => {
    expect(PROVIDER_ADAPTERS.ollama.buildHeaders(undefined, {})).toEqual({
      "Accept": "application/json",
      "Content-Type": "application/json",
    })
  })

  it("adds a bearer Authorization header when a credential is configured", () => {
    expect(PROVIDER_ADAPTERS.ollama.buildHeaders("secret-token", {})).toEqual({
      "Accept": "application/json",
      "Content-Type": "application/json",
      "Authorization": "Bearer secret-token",
    })
  })

  it("merges extraHeaders in, letting them override a default if they collide", () => {
    expect(
      PROVIDER_ADAPTERS.ollama.buildHeaders("secret-token", {
        "X-Wait-For-Model": "true",
        "Authorization": "Bearer overridden",
      }),
    ).toEqual({
      "Accept": "application/json",
      "Content-Type": "application/json",
      "Authorization": "Bearer overridden",
      "X-Wait-For-Model": "true",
    })
  })

  it("builds the native chat body with sampling options and no format by default", () => {
    const body = PROVIDER_ADAPTERS.ollama.buildBody(requestInput())

    expect(body).toEqual({
      model: "llama3.2",
      messages: requestInput().messages,
      tools,
      options: { num_ctx: contextWindowFloor, temperature, num_predict: numPredict },
      think: true,
      stream: false,
    })
  })

  it("includes the shared prediction format only when requested", () => {
    const body = PROVIDER_ADAPTERS.ollama.buildBody(requestInput({ wantsPredictionFormat: true }))
    expect(body.format).toEqual(OLLAMA_PREDICTION_FORMAT.format)
  })

  it("strips internal tokens_used metadata from accumulated messages", () => {
    const body = PROVIDER_ADAPTERS.ollama.buildBody(requestInput({
      messages: [{ role: "assistant", content: "hello", tokens_used: 34 }],
    })) as { messages: AgentChatMessage[] }

    expect(body.messages).toEqual([{ role: "assistant", content: "hello" }])
  })

  it("disables think only for the none reasoning effort", () => {
    expect(PROVIDER_ADAPTERS.ollama.buildBody(requestInput({ reasoningEffort: "none" })).think).toBe(false)
    expect(PROVIDER_ADAPTERS.ollama.buildBody(requestInput({ reasoningEffort: "max" })).think).toBe(true)
  })

  it("reads the reply straight from the top-level message field", () => {
    const message = PROVIDER_ADAPTERS.ollama.readMessage({
      message: { role: "assistant", content: "hello", tool_calls: [{ id: "call_1" }] },
    })
    expect(message).toEqual({ role: "assistant", content: "hello", tool_calls: [{ id: "call_1" }] })
  })

  it("returns undefined when the response has no message", () => {
    expect(PROVIDER_ADAPTERS.ollama.readMessage({})).toBeUndefined()
  })

  it("maps Ollama's thinking field onto the shared reasoning dialect field", () => {
    const message = PROVIDER_ADAPTERS.ollama.readMessage({
      message: { role: "assistant", content: "hello", thinking: "pondering..." },
    })
    expect(message?.reasoning).toBe("pondering...")
  })

  it("normalizes Ollama's generated token count into tokens_used, ignoring the prompt side", () => {
    const message = PROVIDER_ADAPTERS.ollama.readMessage({
      message: { role: "assistant", content: "hello" },
      prompt_eval_count: 21,
      eval_count: 13,
    })

    expect(message?.tokens_used).toBe(13)
  })
})

describe("openai adapter", () => {
  it("strips the Ollama-only tool_name field from tool-result messages", () => {
    const toolResultMessage: AgentChatMessage = {
      role: "tool",
      tool_call_id: "call_1",
      tool_name: "get_game_status",
      content: "{}",
    }

    const body = PROVIDER_ADAPTERS.openai.buildBody(requestInput({ messages: [toolResultMessage] })) as {
      messages: AgentChatMessage[]
    }

    expect(body.messages).toEqual([
      { role: "tool", tool_call_id: "call_1", content: "{}" },
    ])
  })

  it("caps tokens with max_tokens and omits response_format without a schema", () => {
    const body = PROVIDER_ADAPTERS.openai.buildBody(requestInput())
    expect(body.max_tokens).toBe(numPredict)
    expect(body.response_format).toBeUndefined()
    expect(body.tools).toBe(tools)
  })

  it("sends the configured reasoning-effort level", () => {
    const body = PROVIDER_ADAPTERS.openai.buildBody(requestInput())
    expect(body.reasoning_effort).toBe("max")
    expect(body.chat_template_kwargs).toBeUndefined()

    expect(PROVIDER_ADAPTERS.openai.buildBody(requestInput({ reasoningEffort: "low" })).reasoning_effort).toBe("low")
  })

  it("omits reasoning_effort entirely for the none level, unlike Ollama's boolean think", () => {
    const body = PROVIDER_ADAPTERS.openai.buildBody(requestInput({ reasoningEffort: "none" }))
    expect(body.reasoning_effort).toBeUndefined()
  })

  it("renames the internal reasoning field to the wire's reasoning_content, unlike tool_name which it just drops", () => {
    const assistantMessage: AgentChatMessage = {
      role: "assistant",
      content: "moving on",
      reasoning: "thinking...",
      tokens_used: 34,
      tool_calls: [{ id: "call_1", function: { name: "get_game_status", arguments: {} } }],
    }

    const body = PROVIDER_ADAPTERS.openai.buildBody(requestInput({ messages: [assistantMessage] })) as {
      messages: (AgentChatMessage & { reasoning_content?: string })[]
    }

    expect(body.messages[0].reasoning_content).toBe("thinking...")
    expect(body.messages[0].reasoning).toBeUndefined()
    expect(body.messages[0].tokens_used).toBeUndefined()
  })

  it("wraps the shared prediction format in a strict json_schema response_format when requested", () => {
    const body = PROVIDER_ADAPTERS.openai.buildBody(requestInput({ wantsPredictionFormat: true }))
    expect(body.response_format).toEqual(OPENAI_PREDICTION_FORMAT.response_format)
  })

  it("reads the reply from choices[0].message", () => {
    const message = PROVIDER_ADAPTERS.openai.readMessage({
      choices: [{ message: { role: "assistant", content: "hello" } }],
    })
    expect(message).toEqual({ role: "assistant", content: "hello", tool_calls: undefined })
  })

  it("maps the wire's reasoning_content onto the shared internal reasoning field", () => {
    const message = PROVIDER_ADAPTERS.openai.readMessage({
      choices: [{ message: { role: "assistant", content: "hello", reasoning_content: "thinking..." } }],
    })
    expect(message?.reasoning).toBe("thinking...")
  })

  it("normalizes OpenAI's completion token count into tokens_used, ignoring the prompt side", () => {
    const message = PROVIDER_ADAPTERS.openai.readMessage({
      choices: [{ message: { role: "assistant", content: "hello" } }],
      usage: { prompt_tokens: 21, completion_tokens: 13, total_tokens: 34 },
    })

    expect(message?.tokens_used).toBe(13)
  })

  it("treats a null content (tool-call-only reply) as no content rather than the literal null", () => {
    const message = PROVIDER_ADAPTERS.openai.readMessage({
      choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call_1" }] } }],
    })
    expect(message?.content).toBeUndefined()
  })

  it("returns undefined when there are no choices", () => {
    expect(PROVIDER_ADAPTERS.openai.readMessage({ choices: [] })).toBeUndefined()
  })
})

describe("anthropic adapter", () => {
  it("omits Authorization-style headers when no credential or extra headers are configured, but always sends the browser-access header", () => {
    expect(PROVIDER_ADAPTERS.anthropic.buildHeaders(undefined, {})).toEqual({
      "Accept": "application/json",
      "Content-Type": "application/json",
      "anthropic-dangerous-direct-browser-access": "true",
    })
  })

  it("adds x-api-key when configured, and anthropic-version only via extraHeaders (no dedicated field)", () => {
    expect(
      PROVIDER_ADAPTERS.anthropic.buildHeaders("sk-secret", { "anthropic-version": "2023-06-01" }),
    ).toEqual({
      "Accept": "application/json",
      "Content-Type": "application/json",
      "anthropic-dangerous-direct-browser-access": "true",
      "x-api-key": "sk-secret",
      "anthropic-version": "2023-06-01",
    })
  })

  it("lifts the system message out of messages into a top-level system field", () => {
    const body = PROVIDER_ADAPTERS.anthropic.buildBody(requestInput()) as {
      system?: string
      messages: unknown[]
    }

    expect(body.system).toBe("You are Blue.")
    expect(body.messages).toEqual([{ role: "user", content: "It is Blue's turn." }])
  })

  it("omits system entirely when there is no system message", () => {
    const body = PROVIDER_ADAPTERS.anthropic.buildBody(
      requestInput({ messages: [{ role: "user", content: "hi" }] }),
    )
    expect(body.system).toBeUndefined()
  })

  it("maps tool definitions to Anthropic's name/description/input_schema shape", () => {
    const body = PROVIDER_ADAPTERS.anthropic.buildBody(requestInput())
    expect(body.tools).toEqual([
      { name: "get_game_status", description: "Get current status.", input_schema: tools[0].function.parameters },
    ])
  })

  it("encodes an assistant tool call as a tool_use block, omitting the text block when content is empty", () => {
    const assistantMessage: AgentChatMessage = {
      role: "assistant",
      content: "",
      tool_calls: [
        { id: "call_1", function: { name: "get_game_status", arguments: { level: 3 } } },
      ],
    }

    const body = PROVIDER_ADAPTERS.anthropic.buildBody(requestInput({ messages: [assistantMessage] })) as {
      messages: { role: string; content: unknown }[]
    }

    expect(body.messages).toEqual([
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "call_1", name: "get_game_status", input: { level: 3 } },
        ],
      },
    ])
  })

  it("keeps a text block alongside tool_use blocks when the assistant also wrote content", () => {
    const assistantMessage: AgentChatMessage = {
      role: "assistant",
      content: "Checking status first.",
      tool_calls: [{ id: "call_1", function: { name: "get_game_status", arguments: {} } }],
    }

    const body = PROVIDER_ADAPTERS.anthropic.buildBody(requestInput({ messages: [assistantMessage] })) as {
      messages: { content: unknown[] }[]
    }

    expect(body.messages[0].content).toEqual([
      { type: "text", text: "Checking status first." },
      { type: "tool_use", id: "call_1", name: "get_game_status", input: {} },
    ])
  })

  it("does not send internal tokens_used metadata in Anthropic assistant content", () => {
    const body = PROVIDER_ADAPTERS.anthropic.buildBody(requestInput({
      messages: [{ role: "assistant", content: "hello", tokens_used: 34 }],
    })) as { messages: unknown[] }

    expect(JSON.stringify(body.messages)).not.toContain("tokens_used")
  })

  it("coalesces consecutive tool-result messages into a single user turn", () => {
    const toolMessages: AgentChatMessage[] = [
      { role: "tool", tool_call_id: "call_1", tool_name: "get_game_status", content: "{\"a\":1}" },
      { role: "tool", tool_call_id: "call_2", tool_name: "get_maze_structure", content: "{\"b\":2}" },
    ]

    const body = PROVIDER_ADAPTERS.anthropic.buildBody(requestInput({ messages: toolMessages })) as {
      messages: { role: string; content: unknown }[]
    }

    expect(body.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "call_1", content: "{\"a\":1}" },
          { type: "tool_result", tool_use_id: "call_2", content: "{\"b\":2}" },
        ],
      },
    ])
  })

  it("does not coalesce a tool result into an unrelated earlier user turn", () => {
    const messages: AgentChatMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "", tool_calls: [{ id: "call_1", function: { name: "get_game_status", arguments: {} } }] },
      { role: "tool", tool_call_id: "call_1", tool_name: "get_game_status", content: "{}" },
    ]

    const body = PROVIDER_ADAPTERS.anthropic.buildBody(requestInput({ messages })) as {
      messages: { role: string; content: unknown }[]
    }

    expect(body.messages).toEqual([
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "call_1", name: "get_game_status", input: {} }],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "call_1", content: "{}" }],
      },
    ])
  })

  it("requires max_tokens and includes output_config only when a schema is requested", () => {
    const withoutFormat = PROVIDER_ADAPTERS.anthropic.buildBody(requestInput())
    expect(withoutFormat.max_tokens).toBe(numPredict)
    expect(withoutFormat.output_config).toBeUndefined()

    const withFormat = PROVIDER_ADAPTERS.anthropic.buildBody(requestInput({ wantsPredictionFormat: true }))
    expect(withFormat.output_config).toEqual(ANTHROPIC_PREDICTION_FORMAT.output_config)
  })

  it("always enables thinking, scaling budget_tokens with the configured reasoning-effort level", () => {
    const budgetFor = (reasoningEffort: "low" | "medium" | "high" | "max") =>
      (PROVIDER_ADAPTERS.anthropic.buildBody(requestInput({ reasoningEffort })) as {
        thinking: { type: string; budget_tokens: number }
      }).thinking

    expect(budgetFor("low")).toEqual({ type: "enabled", budget_tokens: 2000 })
    expect(budgetFor("medium")).toEqual({ type: "enabled", budget_tokens: 4000 })
    expect(budgetFor("high")).toEqual({ type: "enabled", budget_tokens: 6000 })
    expect(budgetFor("max")).toEqual({ type: "enabled", budget_tokens: 8000 })
    // Every level stays strictly under max_tokens, which Anthropic requires.
    expect(budgetFor("max").budget_tokens).toBeLessThan(numPredict)
  })

  it("folds text and tool_use content blocks into the internal message shape", () => {
    const message = PROVIDER_ADAPTERS.anthropic.readMessage({
      role: "assistant",
      content: [
        { type: "text", text: "Checking status first." },
        { type: "tool_use", id: "call_1", name: "get_game_status", input: { level: 3 } },
      ],
    })

    expect(message).toEqual({
      role: "assistant",
      content: "Checking status first.",
      tool_calls: [
        { id: "call_1", type: "function", function: { name: "get_game_status", arguments: { level: 3 } } },
      ],
    })
  })

  it("omits tool_calls entirely for a text-only reply", () => {
    const message = PROVIDER_ADAPTERS.anthropic.readMessage({
      role: "assistant",
      content: [{ type: "text", text: "{\"moves\":[\"MoveRight\"]}" }],
    })

    expect(message).toEqual({ role: "assistant", content: "{\"moves\":[\"MoveRight\"]}" })
    expect(message).not.toHaveProperty("tool_calls")
  })

  it("maps a thinking block onto the shared internal reasoning field", () => {
    const message = PROVIDER_ADAPTERS.anthropic.readMessage({
      role: "assistant",
      content: [
        { type: "thinking", thinking: "pondering...", signature: "sig" },
        { type: "text", text: "Checking status first." },
      ],
    })

    expect(message?.reasoning).toBe("pondering...")
    expect(message?.content).toBe("Checking status first.")
  })

  it("normalizes Anthropic's output token count into tokens_used, ignoring input and cache tokens", () => {
    const message = PROVIDER_ADAPTERS.anthropic.readMessage({
      role: "assistant",
      content: [{ type: "text", text: "hello" }],
      usage: {
        input_tokens: 21,
        cache_creation_input_tokens: 5,
        cache_read_input_tokens: 3,
        output_tokens: 13,
      },
    })

    expect(message?.tokens_used).toBe(13)
  })

  it("returns undefined when the response has no content block array", () => {
    expect(PROVIDER_ADAPTERS.anthropic.readMessage({})).toBeUndefined()
  })
})
