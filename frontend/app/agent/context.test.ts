import { describe, expect, it } from "vitest"

import { CONFIG } from "../config"
import {
  AGENT_CONTEXT_TOOLS,
  buildAgentMessages,
  buildAgentToolHandlers,
} from "./context"
import {
  buildMazeActionResult,
} from "../control"
import type {
  AgentApiConfig,
  AgentExpectedResponseSchema,
  MazeActionResult,
  State,
  TraversalHistoryEntry,
} from "../types"

function selfVisit(row: number, col: number): TraversalHistoryEntry {
  return { playerName: CONFIG.runtime.interactivePlayerName, row, col }
}

const expectedAgentPrompt = [
  "Your name is Blue.",
  `playerName ${CONFIG.runtime.interactivePlayerName} always appears first in traversalHistory and marks the start cell.`,
  "Use currentCell as your current position and destinationCell as the target.",
  "Use traversalHistory entries matching your playerName to review your past moves in order.",
  "Explore carefully: prefer unvisited cells and submit shorter predictions when uncertain.",
  "Return only a JSON object matching expectedResponseSchema.",
  "Moves replay in order until the destination or the first invalid move.",
  "Every submitted move counts toward score decay, including moves after the first invalid move.",
  "Stop predicting when lastMoveStatus is reached-target or status is won.",
  "Choose the moves most likely to reach the destination with the fewest submitted moves.",
].join(" ")

const expectedResponseSchema: AgentExpectedResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["moves"],
  properties: {
    moves: {
      type: "array",
      minItems: 1,
      items: {
        type: "string",
        enum: ["MoveUp", "MoveDown", "MoveLeft", "MoveRight"],
      },
    },
  },
}

const expectedLastSubmittedMovesSchema: NonNullable<
  MazeActionResult["lastSubmittedMovesSchema"]
> = {
  type: "array",
  description: "Zero-based replay records formatted as <index>:<move>.",
  items: {
    type: "string",
    pattern: "^(0|[1-9][0-9]*):(MoveUp|MoveDown|MoveLeft|MoveRight)$",
    examples: ["0:MoveRight"],
  },
}

// createState builds a compact agent-facing runtime state for movement feedback tests.
function createState(overrides: Partial<State> = {}): State {
  return {
    controlMode: CONFIG.runtime.controlModes.agentApi,
    level: 4,
    mazeDimensions: { length: 2, width: 1, area: 2 },
    maze: [
      ["|", "---", "|", "---", "|"],
      ["|", "   ", " ", "   ", "|"],
      ["|", "---", "|", "---", "|"],
    ],
    playerPosition: { x: 1, y: 1 },
    traversalHistory: [selfVisit(0, 0)],
    finalPosition: { x: 3, y: 1 },
    status: "running",
    score: 700,
    lastRoundScore: 0,
    lastAttemptRetentionUnits: null,
    bestWinRetentionUnits: null,
    lastWinRequestCount: null,
    bestWinRequestCount: null,
    winSummary: "",
    canResume: false,
    wallWeight: 1,
    scoreDecayUnits: 0,
    agentRequestCount: 0,
    clock: null,
    ...overrides,
  }
}

// These tests lock down the context slices exposed to prediction requests.
describe("agent context", () => {
  it("defines focused context tools that extract their own state slices", () => {
    const agent: AgentApiConfig = {
      id: 1,
      playerName: "Blue",
      model: "llama3.2",
      endpoint: "https://agents.example/chat",
      enabled: true,
    }
    const actionResult = buildMazeActionResult("Blue", {
      lastPlayerName: "Blue",
      lastMoveStatus: "applied",
      lastSubmittedMovesIndexBase: 0,
      lastSubmittedMovesSchema: expectedLastSubmittedMovesSchema,
      lastSubmittedMoves: ["0:MoveRight"],
      lastValidMoveIndex: 0,
      visitedBefore: false,
      decayedMovesCount: 1,
    })
    const toolHandlers = buildAgentToolHandlers(createState(), agent, actionResult)

    expect(AGENT_CONTEXT_TOOLS.map((tool) => tool.function.name)).toEqual([
      "get_game_status",
      "get_maze_positions",
      "get_traversal_history",
      "get_prediction_rules",
      "get_last_replay_result",
    ])
    expect(toolHandlers.get_game_status({})).toEqual({
      level: 4,
      status: "running",
      score: 700,
      model: "llama3.2",
    })
    expect(toolHandlers.get_maze_positions({})).toEqual({
      currentCell: { row: 0, col: 0 },
      destinationCell: { row: 0, col: 1 },
    })
    expect(toolHandlers.get_traversal_history({})).toEqual({
      traversalHistory: [selfVisit(0, 0)],
    })
    expect(toolHandlers.get_prediction_rules({})).toEqual({
      recommendedAvgPredictionLimit: 18,
      expectedResponseSchema,
    })
    expect(toolHandlers.get_last_replay_result({})).toEqual({
      lastPlayerName: "Blue",
      lastMoveStatus: "applied",
      lastSubmittedMovesIndexBase: 0,
      lastSubmittedMovesSchema: expectedLastSubmittedMovesSchema,
      lastSubmittedMoves: ["0:MoveRight"],
      lastValidMoveIndex: 0,
      visitedBefore: false,
      decayedMovesCount: 1,
    })
  })

  it("builds the initial agent chat message without embedding the full maze state", () => {
    expect(buildAgentMessages("Blue")).toEqual([
      {
        role: "developer",
        content: expectedAgentPrompt,
      },
      {
        role: "user",
        content:
          "It is Blue's turn to predict Tapoo maze moves. Use the available tools to inspect the current maze state. Return only JSON matching the movement response schema.",
      },
    ])
  })

})
