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
  AgentExpectedResponseSchema,
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
  "The maze is randomly generated at each level with exactly one path to the destination.",
  "Use traversalHistory entries matching your playerName to review your past moves in order.",
  "By design, the maze never guarantees a direct route from start to destination; the only valid path may require moving away from the target before turning towards it — never assume moves toward the destination are passable.",
  "Tool results reflect the maze state at the time of each call — a repeat call may return updated or identical data depending on what has changed.",
  "Prefer unvisited cells over revisiting known ones, and calibrate how many moves you submit against your own last replay outcome from get_last_replay_result: null or invalid-move signals high uncertainty so return fewer moves; applied signals confirmed progress so you may include more moves in your response.",
  "Call get_prediction_rules to get the required response format and move count guidance before predicting moves.",
  "Moves replay in order until the destination or the first invalid move (a wall collision or out-of-bounds step).",
  "Every move in your response counts toward score decay, including moves after the first invalid move.",
  "Stop predicting when lastMoveStatus is reached-target or status is won.",
  "Choose the moves most likely to reach the destination with the fewest moves in your response.",
].join(" ")

const expectedResponseSchema: AgentExpectedResponseSchema = {
  type: "object",
  description: "The only accepted response format. Return this exact JSON object with no surrounding text or markdown fences.",
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
    const actionResult = buildMazeActionResult("Blue", {
      lastPlayerName: "Blue",
      lastMoveStatus: "applied",
      lastReplayStartIndex: 0,
      lastSubmittedMoves: ["0:MoveRight"],
      lastAppliedMoveIndex: 0,
      visitedBefore: false,
      chargedMovesCount: 1,
    })
    const toolHandlers = buildAgentToolHandlers(createState(), actionResult, ["MoveRight"])

    expect(AGENT_CONTEXT_TOOLS.map((tool) => tool.function.name)).toEqual([
      "get_game_status",
      "get_maze_positions",
      "get_traversal_history",
      "get_last_replay_result",
      "get_prediction_rules",
    ])
    expect(toolHandlers.get_game_status({})).toEqual({
      level: 4,
      status: "running",
      score: 700,
      mazeDimensions: { length: 2, width: 1, area: 2 },
    })
    expect(toolHandlers.get_maze_positions({})).toEqual({
      currentCell: { row: 0, col: 0 },
      destinationCell: { row: 0, col: 1 },
      directions: { open: ["MoveRight"], blocked: ["MoveUp", "MoveDown", "MoveLeft"] },
    })
    expect(toolHandlers.get_traversal_history({})).toEqual({
      traversalHistory: [selfVisit(0, 0)],
    })
    expect(toolHandlers.get_prediction_rules({})).toEqual({
      suggestedMovesPerTurn: 10,
      expectedResponseSchema,
    })
    expect(toolHandlers.get_last_replay_result({})).toEqual({
      lastPlayerName: "Blue",
      lastMoveStatus: "applied",
      lastReplayStartIndex: 0,
      lastSubmittedMoves: ["0:MoveRight"],
      lastAppliedMoveIndex: 0,
      visitedBefore: false,
      chargedMovesCount: 1,
    })
  })

  it("builds the initial agent chat message without embedding the full maze state", () => {
    expect(buildAgentMessages("Blue")).toEqual([
      {
        role: "system",
        content: expectedAgentPrompt,
      },
      {
        role: "user",
        content: `It is Blue's turn to predict Tapoo maze moves. Use the available tools to inspect the current maze state.`,
      },
    ])
  })

})
