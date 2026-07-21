import { afterEach, describe, expect, it, vi } from "vitest"

import { requestPredictionWithAbort } from "./request"
import type {
  AgentApiConfig,
  MazeActionResult,
  State,
} from "../types"

const endpoint = "https://agents.example/chat"
const model = "qwen3.6:27b"
const prompt =
  "Your name is Blue. playerName Self always appears first in traversalHistory and marks the start cell. Use currentCell as your current position and destinationCell as the target. Use traversalHistory entries matching your playerName to review your past moves in order. Explore carefully: prefer unvisited cells and submit shorter predictions when uncertain. Return only a JSON object matching expectedResponseSchema. Moves replay in order until the destination or the first invalid move. Every submitted move counts toward score decay, including moves after the first invalid move. Stop predicting when lastMoveStatus is reached-target or status is won. Choose the moves most likely to reach the destination with the fewest submitted moves."
const developerMessage = prompt
const userMessage =
  "It is Blue's turn to predict Tapoo maze moves. Use the available tools to inspect the current maze state. Return only JSON matching the movement response schema."
const agentContextTools = [
  {
    type: "function" as const,
    function: {
      name: "get_game_status",
      description:
        "Get current Tapoo level, status, score, and model. Returns JSON: {\"level\":number,\"status\":string,\"score\":number,\"model\":string}.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_maze_positions",
      description:
        "Get current and destination cells. Returns JSON: {\"currentCell\":{\"row\":number,\"col\":number}|null,\"destinationCell\":{\"row\":number,\"col\":number}|null}.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_traversal_history",
      description:
        "Get chronological visited cells. Returns JSON: {\"traversalHistory\":[{\"playerName\":string,\"row\":number,\"col\":number}]}.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_prediction_rules",
      description:
        "Get movement response rules. Returns JSON: {\"recommendedAvgPredictionLimit\":number,\"expectedResponseSchema\":object}.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_last_replay_result",
      description:
        "Get the previous turn replay result. Returns JSON with lastPlayerName, lastMoveStatus, lastSubmittedMoves, lastValidMoveIndex, visitedBefore, and decayedMovesCount.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {},
        required: [],
      },
    },
  },
]
const agent: AgentApiConfig = {
  id: 1,
  playerName: "Blue",
  model,
  endpoint,
  enabled: true,
}

const state: State = {
  agentRequestCount: 0,
  bestWinRequestCount: null,
  bestWinRetentionUnits: null,
  canResume: false,
  clock: null,
  controlMode: "agent-api",
  finalPosition: { x: 15, y: 17 },
  lastAttemptRetentionUnits: null,
  lastRoundScore: 0,
  lastWinRequestCount: null,
  level: 1,
  maze: null,
  mazeDimensions: { length: 10, width: 10, area: 100 },
  playerPosition: { x: 1, y: 1 },
  score: 10000,
  scoreDecayUnits: 0,
  status: "running",
  traversalHistory: [{ playerName: "Self", row: 0, col: 0 }],
  wallWeight: 1,
  winSummary: "",
}

type SerializedRequestBody = {
  format: "json"
  messages: unknown[]
  model: string
  stream: false
  think: false
  tools: unknown[]
}

function requestInput(
  stateOverrides: Partial<State> = {},
  resultOverrides: Partial<MazeActionResult> = {},
) {
  const lastActionResult =
    Object.keys(resultOverrides).length === 0 ? null : resultOverrides

  return {
    agent,
    lastActionResult,
    state: { ...state, ...stateOverrides },
    timeoutMs: 180_000,
  }
}

function requestPrediction(input: Parameters<typeof requestPredictionWithAbort>[0]) {
  return requestPredictionWithAbort(input).promise
}

function successfulResponse(content: string) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue({
      message: { role: "assistant", content },
    }),
  }
}

function toolCallResponse(toolCalls: unknown[]) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue({
      message: {
        role: "assistant",
        content: "",
        tool_calls: toolCalls,
      },
    }),
  }
}

// positionsContent mirrors the exact JSON string sent by the focused positions tool.
function positionsContent(overrides: Partial<State> = {}): string {
  const nextState = { ...state, ...overrides }
  return JSON.stringify({
    currentCell: nextState.playerPosition
      ? {
          row: Math.floor((nextState.playerPosition.y - 1) / 2),
          col: Math.floor((nextState.playerPosition.x - 1) / 2),
        }
      : null,
    destinationCell: nextState.finalPosition
      ? {
          row: Math.floor((nextState.finalPosition.y - 1) / 2),
          col: Math.floor((nextState.finalPosition.x - 1) / 2),
        }
      : null,
  })
}

describe("agent request service", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("documents the raw follow-up json payload sent after a tool call", async () => {
    const expectedJsonInput = {
      model: "qwen3.6:27b",
      messages: [
        {
          role: "developer",
          content:
            "Your name is Blue. playerName Self always appears first in traversalHistory and marks the start cell. Use currentCell as your current position and destinationCell as the target. Use traversalHistory entries matching your playerName to review your past moves in order. Explore carefully: prefer unvisited cells and submit shorter predictions when uncertain. Return only a JSON object matching expectedResponseSchema. Moves replay in order until the destination or the first invalid move. Every submitted move counts toward score decay, including moves after the first invalid move. Stop predicting when lastMoveStatus is reached-target or status is won. Choose the moves most likely to reach the destination with the fewest submitted moves.",
        },
        {
          role: "user",
          content:
            "It is Blue's turn to predict Tapoo maze moves. Use the available tools to inspect the current maze state. Return only JSON matching the movement response schema.",
        },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call_positions",
              function: {
                index: 0,
                name: "get_maze_positions",
                arguments: {},
              },
            },
          ],
        },
        {
          role: "tool",
          tool_name: "get_maze_positions",
          content:
            "{\"currentCell\":{\"row\":0,\"col\":0},\"destinationCell\":{\"row\":8,\"col\":7}}",
        },
      ],
      tools: agentContextTools,
      format: "json",
      think: false,
      stream: false,
    }
    const expectedJsonOutput = {
      ok: true,
      moves: ["MoveRight", "MoveDown"],
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        toolCallResponse([
          {
              id: "call_positions",
              function: {
                index: 0,
                name: "get_maze_positions",
                arguments: {},
              },
            },
        ]),
      )
      .mockResolvedValueOnce(
        successfulResponse(JSON.stringify({ moves: expectedJsonOutput.moves })),
      )
    vi.stubGlobal("fetch", fetchMock)

    await expect(requestPrediction(requestInput())).resolves.toEqual(
      expectedJsonOutput,
    )

    const secondRequest = fetchMock.mock.calls[1][1] as RequestInit
    expect(JSON.parse(secondRequest.body as string)).toEqual(expectedJsonInput)
  })

  it("sends the initial chat payload and returns final movement predictions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      successfulResponse("{\"moves\":[\"MoveRight\",\"MoveDown\"]}"),
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(requestPrediction(requestInput())).resolves.toEqual({
      ok: true,
      moves: ["MoveRight", "MoveDown"],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      endpoint,
      expect.objectContaining({
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "X-Tapoo-Agent": "tapoo:v2.0.0",
        },
        method: "POST",
      }),
    )

    const request = fetchMock.mock.calls[0][1] as RequestInit
    const requestBody = JSON.parse(request.body as string) as SerializedRequestBody
    expect(requestBody).toEqual({
      model,
      messages: [
        { role: "developer", content: developerMessage },
        { role: "user", content: userMessage },
      ],
      tools: agentContextTools,
      format: "json",
      think: false,
      stream: false,
    })
  })

  it("executes one tool-call round before reading the final prediction", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        toolCallResponse([
          {
            id: "call_1",
            function: { index: 0, name: "get_maze_positions", arguments: {} },
          },
        ]),
      )
      .mockResolvedValueOnce(successfulResponse("{\"moves\":[\"MoveRight\"]}"))
    vi.stubGlobal("fetch", fetchMock)

    const result = await requestPrediction(
      requestInput({
        finalPosition: { x: 3, y: 1 },
        playerPosition: { x: 1, y: 1 },
      }),
    )

    expect(result).toEqual({ ok: true, moves: ["MoveRight"] })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const secondRequest = fetchMock.mock.calls[1][1] as RequestInit
    const secondRequestBody = JSON.parse(secondRequest.body as string) as SerializedRequestBody
    expect(secondRequestBody.messages).toEqual([
      { role: "developer", content: developerMessage },
      { role: "user", content: userMessage },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call_1",
            function: {
              index: 0,
              name: "get_maze_positions",
              arguments: {},
            },
          },
        ],
      },
      {
        role: "tool",
        tool_name: "get_maze_positions",
        content: positionsContent({
          finalPosition: { x: 3, y: 1 },
          playerPosition: { x: 1, y: 1 },
        }),
      },
    ])
  })

  it("handles multiple context tool calls in one response in order", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        toolCallResponse([
          { function: { name: "get_maze_positions", arguments: {} } },
          { function: { name: "get_traversal_history", arguments: "{}" } },
        ]),
      )
      .mockResolvedValueOnce(successfulResponse("{\"moves\":[\"MoveDown\"]}"))
    vi.stubGlobal("fetch", fetchMock)

    await requestPrediction(requestInput())

    const secondRequest = fetchMock.mock.calls[1][1] as RequestInit
    const secondRequestBody = JSON.parse(secondRequest.body as string) as SerializedRequestBody
    expect(secondRequestBody.messages.slice(-2)).toEqual([
      {
        role: "tool",
        tool_name: "get_maze_positions",
        content: positionsContent(),
      },
      {
        role: "tool",
        tool_name: "get_traversal_history",
        content: JSON.stringify({
          traversalHistory: state.traversalHistory,
        }),
      },
    ])
  })

  it.each([
    ["invalid json", "not-json"],
    ["missing moves", "{}"],
    ["empty moves", "{\"moves\":[]}"],
    ["unsupported move", "{\"moves\":[\"MoveSideways\"]}"],
  ])("returns malformed-response for %s", async (_caseName, content) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(successfulResponse(content)))

    await expect(requestPrediction(requestInput())).resolves.toEqual({
      ok: false,
      reason: "malformed-response",
    })
  })

  it.each([
    ["non-ok response", vi.fn().mockResolvedValue({ ok: false })],
    ["fetch failure", vi.fn().mockRejectedValue(new TypeError("failed"))],
  ])("returns network-error for %s", async (_caseName, fetchMock) => {
    vi.stubGlobal("fetch", fetchMock)

    await expect(requestPrediction(requestInput())).resolves.toEqual({
      ok: false,
      reason: "network-error",
    })
  })

  it("returns network-error when the request times out", async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_endpoint: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"))
        })
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = requestPrediction({ ...requestInput(), timeoutMs: 1000 })
    await vi.advanceTimersByTimeAsync(1000)

    await expect(result).resolves.toEqual({
      ok: false,
      reason: "network-error",
    })
  })

  it("marks manually aborted requests without throwing provider details", async () => {
    const fetchMock = vi.fn((_endpoint: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"))
        })
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    const request = requestPredictionWithAbort(requestInput())
    request.abort()

    expect(request.isAborted()).toBe(true)
    await expect(request.promise).resolves.toEqual({
      ok: false,
      reason: "network-error",
    })
  })

  it.each([
    ["unknown tool", "missing_tool"],
    ["missing tool name", undefined],
  ])("returns network-error for %s", async (_caseName, name) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        toolCallResponse([{ function: { name, arguments: {} } }]),
      ),
    )

    await expect(requestPrediction(requestInput())).resolves.toEqual({
      ok: false,
      reason: "network-error",
    })
  })

  it("removes tools after the maximum tool rounds so the model can answer from context", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        toolCallResponse([
          { function: { name: "get_maze_positions", arguments: {} } },
        ]),
      )
      .mockResolvedValueOnce(successfulResponse("{\"moves\":[\"MoveRight\"]}"))
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      requestPrediction({ ...requestInput(), maxToolRounds: 1 }),
    ).resolves.toEqual({ ok: true, moves: ["MoveRight"] })

    const secondRequest = fetchMock.mock.calls[1][1] as RequestInit
    const secondRequestBody = JSON.parse(secondRequest.body as string) as SerializedRequestBody
    expect(secondRequestBody.tools).toEqual([])
  })

  it("returns network-error when the hard request turn limit is exceeded", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      toolCallResponse([
        { function: { name: "get_maze_positions", arguments: {} } },
      ]),
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      requestPrediction({
        ...requestInput(),
        maxToolRounds: 1,
      }),
    ).resolves.toEqual({ ok: false, reason: "network-error" })

    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
