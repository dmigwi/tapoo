import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MockInstance } from "vitest"

import { EXPECTED_RESPONSE_SCHEMA } from "./context"
import { requestPredictionWithAbort } from "./request"
import { getNavigationProfile } from "../maze"
import type {
  AgentApiConfig,
  MazeActionResult,
  State,
} from "../types"

const endpoint = "https://agents.example/chat"
const model = "qwen3.6:27b"
const prompt =
  `Your name is Blue. playerName Self always appears first in traversalHistory and marks the start cell. Use currentCell as your current position and destinationCell as the target. The maze is randomly generated at each level with exactly one path to the destination. Use traversalHistory entries matching your playerName to review your past moves in order. By design, the maze never guarantees a direct route from start to destination; the only valid path may require moving away from the target before turning towards it — never assume the direction vector to the destination is traversable. Prefer unvisited cells in any direction over revisiting known cells, and calibrate how many moves you submit against your own last replay outcome from get_last_replay_result: null or invalid-move signals high uncertainty so submit fewer moves; applied signals a confirmed corridor so you may extend further. Return only JSON {"moves":["MoveRight",...]} where each move is one of MoveUp, MoveDown, MoveLeft, MoveRight. Moves replay in order until the destination or the first invalid move (a wall collision or out-of-bounds step). Every submitted move counts toward score decay, including moves after the first invalid move. Stop predicting when lastMoveStatus is reached-target or status is won. Choose the moves most likely to reach the destination with the fewest submitted moves.`
const developerMessage = prompt
const userMessage =
  `It is Blue's turn to predict Tapoo maze moves. Use the available tools to inspect the current maze state. Return only JSON {"moves":["MoveRight",...]} with moves from: MoveUp, MoveDown, MoveLeft, MoveRight.`
const agentContextTools = [
  {
    type: "function" as const,
    function: {
      name: "get_game_status",
      description:
        "Get current Tapoo level, status, score, and maze dimensions. Returns JSON: {\"level\":number,\"status\":string,\"score\":number,\"mazeDimensions\":{\"length\":number,\"width\":number,\"area\":number}}. length is the number of columns, width is the number of rows, area is the total cell count.",
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
        "Get current and destination cells. Row increases going down, col increases going right; MoveUp/Down changes row by ±1, MoveLeft/Right changes col by ±1. Returns JSON: {\"currentCell\":{\"row\":number,\"col\":number}|null,\"destinationCell\":{\"row\":number,\"col\":number}|null}.",
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
        "Get all players' visited cells in chronological order. Returns JSON: {\"traversalHistory\":[{\"playerName\":string,\"row\":number,\"col\":number}]}. Filter by playerName to get a specific player's path.",
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
        "Get movement response rules. suggestedMovesPerTurn is the suggested maximum moves to submit per turn, scaled to maze size; submitting fewer moves on early turns limits wasted score if the path turns out to be wrong. Returns JSON: {\"suggestedMovesPerTurn\":number,\"expectedResponseSchema\":object}.",
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
        "Get the previous turn replay result. lastMoveStatus is the outcome (e.g. applied, reached-target, invalid-move). lastSubmittedMoves lists the moves from that turn; replayStartIndex is their zero-based offset in the overall move history. lastAppliedMoveIndex is the index within lastSubmittedMoves of the last successfully applied move — moves after it were not executed. visitedBefore indicates whether the cell entered by the last valid move was already in traversal history. chargedMovesCount is the total score-decaying moves charged that turn. Returns JSON with lastPlayerName, lastMoveStatus, replayStartIndex, lastSubmittedMovesSchema, lastSubmittedMoves, lastAppliedMoveIndex, visitedBefore, and chargedMovesCount.",
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
  endpoint: new URL(endpoint),
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
  messages: unknown[]
  model: string
  stream: false
  think: false
  tools: unknown[]
}

type AgentLogDetails = {
  endpoint: string
  payload: {
    message?: { content?: string }
    model?: string
    stream?: boolean
    think?: boolean
  }
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

function thinkingToolCallResponse(toolCalls: unknown[]) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue({
      message: {
        role: "assistant",
        content: "",
        thinking: "I should inspect the maze state before predicting moves.",
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
  let info: MockInstance<typeof console.info>
  let warn: MockInstance<typeof console.warn>

  beforeEach(() => {
    info = vi.spyOn(console, "info").mockImplementation(() => {})
    warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("documents the raw follow-up json payload sent after a tool call", async () => {
    const expectedJsonInput = {
      model: "qwen3.6:27b",
      messages: [
        {
          role: "system",
          content:
            `Your name is Blue. playerName Self always appears first in traversalHistory and marks the start cell. Use currentCell as your current position and destinationCell as the target. The maze is randomly generated at each level with exactly one path to the destination. Use traversalHistory entries matching your playerName to review your past moves in order. By design, the maze never guarantees a direct route from start to destination; the only valid path may require moving away from the target before turning towards it — never assume the direction vector to the destination is traversable. Prefer unvisited cells in any direction over revisiting known cells, and calibrate how many moves you submit against your own last replay outcome from get_last_replay_result: null or invalid-move signals high uncertainty so submit fewer moves; applied signals a confirmed corridor so you may extend further. Return only JSON {"moves":["MoveRight",...]} where each move is one of MoveUp, MoveDown, MoveLeft, MoveRight. Moves replay in order until the destination or the first invalid move (a wall collision or out-of-bounds step). Every submitted move counts toward score decay, including moves after the first invalid move. Stop predicting when lastMoveStatus is reached-target or status is won. Choose the moves most likely to reach the destination with the fewest submitted moves.`,
        },
        {
          role: "user",
          content:
            `It is Blue's turn to predict Tapoo maze moves. Use the available tools to inspect the current maze state. Return only JSON {"moves":["MoveRight",...]} with moves from: MoveUp, MoveDown, MoveLeft, MoveRight.`,
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
          tool_call_id: "call_positions",
          content:
            "{\"currentCell\":{\"row\":0,\"col\":0},\"destinationCell\":{\"row\":8,\"col\":7}}",
        },
      ],
      tools: agentContextTools,
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
      new URL(endpoint),
      expect.objectContaining({
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
    )

    const request = fetchMock.mock.calls[0][1] as RequestInit
    const requestBody = JSON.parse(request.body as string) as SerializedRequestBody
    expect(requestBody).toEqual({
      model,
      messages: [
        { role: "system", content: developerMessage },
        { role: "user", content: userMessage },
      ],
      tools: agentContextTools,
      think: false,
      stream: false,
    })
    const requestLog = info.mock.calls.find(([message]) =>
      message === "[Tapoo] Agent request.",
    )?.[1] as AgentLogDetails | undefined
    const responseLog = info.mock.calls.find(([message]) =>
      message === "[Tapoo] Agent response.",
    )?.[1] as AgentLogDetails | undefined
    expect(requestLog?.endpoint).toBe(endpoint)
    expect(requestLog?.payload.model).toBe(model)
    expect(requestLog?.payload.stream).toBe(false)
    expect(requestLog?.payload.think).toBe(false)
    expect(responseLog?.endpoint).toBe(endpoint)
    expect(responseLog?.payload.message?.content).toBe(
      "{\"moves\":[\"MoveRight\",\"MoveDown\"]}",
    )
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
      { role: "system", content: developerMessage },
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
        tool_call_id: "call_1",
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
        content: positionsContent(),
      },
      {
        role: "tool",
        content: JSON.stringify({
          traversalHistory: state.traversalHistory,
        }),
      },
    ])
  })

  it("detects Ollama thinking responses that include native tool calls", async () => {
    const firstResponse = thinkingToolCallResponse([
      {
        id: "call_status",
        function: { index: 0, name: "get_game_status", arguments: {} },
      },
      {
        id: "call_positions",
        function: { index: 1, name: "get_maze_positions", arguments: {} },
      },
      {
        id: "call_history",
        function: { index: 2, name: "get_traversal_history", arguments: {} },
      },
      {
        id: "call_rules",
        function: { index: 3, name: "get_prediction_rules", arguments: {} },
      },
      {
        id: "call_replay",
        function: { index: 4, name: "get_last_replay_result", arguments: {} },
      },
    ])
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(firstResponse)
      .mockResolvedValueOnce(successfulResponse("{\"moves\":[\"MoveRight\"]}"))
    vi.stubGlobal("fetch", fetchMock)

    await expect(requestPrediction(requestInput())).resolves.toEqual({
      ok: true,
      moves: ["MoveRight"],
    })

    expect(firstResponse.json).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const secondRequest = fetchMock.mock.calls[1][1] as RequestInit
    const secondRequestBody = JSON.parse(secondRequest.body as string) as SerializedRequestBody
    const toolMessages = secondRequestBody.messages.slice(-5) as Array<{
      role: string
      tool_call_id: string
      content: string
    }>
    expect(toolMessages.map(({ role, tool_call_id }) => ({ role, tool_call_id }))).toEqual([
      { role: "tool", tool_call_id: "call_status" },
      { role: "tool", tool_call_id: "call_positions" },
      { role: "tool", tool_call_id: "call_history" },
      { role: "tool", tool_call_id: "call_rules" },
      { role: "tool", tool_call_id: "call_replay" },
    ])
    expect(toolMessages.map(({ content }) => JSON.parse(content) as unknown)).toEqual([
      {
        level: state.level,
        status: state.status,
        score: state.score,
        mazeDimensions: state.mazeDimensions,
      },
      JSON.parse(positionsContent()) as unknown,
      { traversalHistory: state.traversalHistory },
      {
        suggestedMovesPerTurn: getNavigationProfile(state.mazeDimensions).__hardCorridorLimit,
        expectedResponseSchema: EXPECTED_RESPONSE_SCHEMA,
      },
      {
        lastPlayerName: null,
        lastMoveStatus: null,
        replayStartIndex: null,
        lastSubmittedMovesSchema: null,
        lastSubmittedMoves: [],
        lastAppliedMoveIndex: null,
        visitedBefore: null,
        chargedMovesCount: 0,
      },
    ])
  })

  it.each([
    ["bare json", "{\"moves\":[\"MoveRight\"]}", ["MoveRight"]],
    ["json fence", "```json\n{\"moves\":[\"MoveDown\"]}\n```", ["MoveDown"]],
    ["plain fence", "```\n{\"moves\":[\"MoveLeft\",\"MoveUp\"]}\n```", ["MoveLeft", "MoveUp"]],
    [
      "prose prefix with reasoning",
      [
        "I am currently at (0,8). The destination is at (2,2).",
        "The maze is 10x7.",
        "Since this is Level 1 and my history only shows the start cell (0,8), I need to explore.",
        "The target is down and to the left. I should generally move in that direction.",
        'Let\'s try moving Left first along the top row. Given "suggestedMovesPerTurn" is 10, but I should start conservative.',
        "",
        "Proposed moves:",
        "1. MoveLeft (to 0,7)",
        "2. MoveLeft (to 0,6)",
        "3. MoveLeft (to 0,5)",
        "4. MoveDown (to 1,5)",
        "5. MoveDown (to 2,5)",
        "6. MoveLeft (to 2,4)",
        "7. MoveLeft (to 2,3)",
        "8. MoveLeft (to 2,2 - Target!)",
        "",
        "Let's refine: Start by moving **Left** until col 2, then Down.",
        "",
        "{\"moves\":[\"MoveLeft\",\"MoveLeft\",\"MoveLeft\",\"MoveLeft\",\"MoveLeft\",\"MoveLeft\",\"MoveDown\",\"MoveDown\"]}",
      ].join("\n"),
      ["MoveLeft", "MoveLeft", "MoveLeft", "MoveLeft", "MoveLeft", "MoveLeft", "MoveDown", "MoveDown"],
    ],
  ])("parses valid predictions wrapped as %s", async (_caseName, content, moves) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(successfulResponse(content)))
    await expect(requestPrediction(requestInput())).resolves.toEqual({ ok: true, moves })
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
    expect(warn).toHaveBeenCalledWith(
      "[Tapoo] Agent prediction failed.",
      expect.objectContaining({
        lastMoveStatus: null,
        level: state.level,
        model: agent.model,
        playerName: agent.playerName,
        reason: "malformed-response",
        status: state.status,
        timeoutMs: 180_000,
      }),
    )
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
    expect(warn).toHaveBeenCalledWith(
      "[Tapoo] Agent prediction failed.",
      expect.objectContaining({
        endpoint: "https://agents.example/chat",
        reason: "network-error",
      }),
    )
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
