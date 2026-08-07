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
    mazeArea: 100,
    wantsPredictionFormat: false,
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
    expect(PROVIDER_ADAPTERS.ollama.buildHeaders(undefined, undefined)).toEqual({
      "Accept": "application/json",
      "Content-Type": "application/json",
    })
  })

  it("adds a bearer Authorization header when a credential is configured", () => {
    expect(PROVIDER_ADAPTERS.ollama.buildHeaders("secret-token", undefined)).toEqual({
      "Accept": "application/json",
      "Content-Type": "application/json",
      "Authorization": "Bearer secret-token",
    })
  })

  it("builds the native chat body with sampling options and no format by default", () => {
    const body = PROVIDER_ADAPTERS.ollama.buildBody(requestInput())

    expect(body).toEqual({
      model: "llama3.2",
      messages: requestInput().messages,
      tools,
      options: { num_ctx: contextWindowFloor, temperature, num_predict: numPredict },
      think: false,
      stream: false,
    })
  })

  it("includes the shared prediction format only when requested", () => {
    const body = PROVIDER_ADAPTERS.ollama.buildBody(requestInput({ wantsPredictionFormat: true }))
    expect(body.format).toEqual(OLLAMA_PREDICTION_FORMAT.format)
  })

  it("scales num_ctx with the maze area rather than always using the floor", () => {
    const body = PROVIDER_ADAPTERS.ollama.buildBody(requestInput({ mazeArea: 10_000 })) as {
      options: { num_ctx: number }
    }
    expect(body.options.num_ctx).toBeGreaterThan(contextWindowFloor)
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

  it("caps tokens with max_completion_tokens and omits response_format without a schema", () => {
    const body = PROVIDER_ADAPTERS.openai.buildBody(requestInput())
    expect(body.max_completion_tokens).toBe(numPredict)
    expect(body.response_format).toBeUndefined()
    expect(body.tools).toBe(tools)
  })

  it("sends a best-effort low reasoning-effort hint", () => {
    const body = PROVIDER_ADAPTERS.openai.buildBody(requestInput())
    expect(body.reasoning_effort).toBe("low")
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false })
  })

  it("preserves an assistant message's reasoning_content on the wire, unlike tool_name", () => {
    const assistantMessage: AgentChatMessage = {
      role: "assistant",
      content: "moving on",
      reasoning_content: "thinking...",
      tool_calls: [{ id: "call_1", function: { name: "get_game_status", arguments: {} } }],
    }

    const body = PROVIDER_ADAPTERS.openai.buildBody(requestInput({ messages: [assistantMessage] })) as {
      messages: AgentChatMessage[]
    }

    expect(body.messages[0].reasoning_content).toBe("thinking...")
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

  it("carries reasoning_content through unchanged, for reasoning models that require it echoed back", () => {
    const message = PROVIDER_ADAPTERS.openai.readMessage({
      choices: [{ message: { role: "assistant", content: "hello", reasoning_content: "thinking..." } }],
    })
    expect(message?.reasoning_content).toBe("thinking...")
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
  it("omits Authorization-style headers when no credential or version is configured, but always sends the browser-access header", () => {
    expect(PROVIDER_ADAPTERS.anthropic.buildHeaders(undefined, undefined)).toEqual({
      "Accept": "application/json",
      "Content-Type": "application/json",
      "anthropic-dangerous-direct-browser-access": "true",
    })
  })

  it("adds x-api-key and anthropic-version only when configured", () => {
    expect(PROVIDER_ADAPTERS.anthropic.buildHeaders("sk-secret", "2023-06-01")).toEqual({
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

  it("coalesces consecutive tool-result messages into a single user turn", () => {
    const toolMessages: AgentChatMessage[] = [
      { role: "tool", tool_call_id: "call_1", tool_name: "get_game_status", content: "{\"a\":1}" },
      { role: "tool", tool_call_id: "call_2", tool_name: "get_maze_positions", content: "{\"b\":2}" },
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

  it("returns undefined when the response has no content block array", () => {
    expect(PROVIDER_ADAPTERS.anthropic.readMessage({})).toBeUndefined()
  })
})
