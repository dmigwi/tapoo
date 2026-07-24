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

function selfVisit(row: number, col: number, openMoves: TraversalHistoryEntry["openMoves"] = []): TraversalHistoryEntry {
  return { playerName: CONFIG.runtime.interactivePlayerName, row, col, openMoves }
}

const expectedAgentPrompt = [
  "Your name is Blue.",
  `playerName ${CONFIG.runtime.interactivePlayerName} always appears first in traversalHistory and marks the start cell.`,
  "currentCell is your current position; destinationCell is the target.",
  "The maze is randomly generated at each level with exactly one path to the destination.",
  "traversalHistory entries matching your playerName record your past moves in chronological order.",
  "Each entry includes openMoves — the exits that were open from that cell.",
  "openMoves count reveals cell topology: one open move is a dead end (unless that is where you came from); two is a corridor; three or more is a junction.",
  "If the traversalHistory shows each cell has exactly one unvisited exit, you may safely predict that entire sequence of moves in one response.",
  "traversalHistory only records the first visit to each cell; cells revisited during backtracking don't appear again, so apparent gaps are expected.",
  "Revisiting a cell already in traversalHistory is only valid when every other exit from the current cell leads to already-visited cells.",
  "By design, the maze never guarantees a direct route from start to destination; the only valid path may require moving away from the target before turning towards it.",
  "Tool results reflect the maze state at the time of each call — a repeat call may return updated or identical data depending on what has changed.",
  "get_last_replay_result reflects the most recent replay across all agents; lastPlayerName identifies whose outcome it is.",
  "lastMoveStatus null means no moves have been made yet; invalid-move means the last prediction hit a wall; malformed-response means the previous response was not valid JSON and a score penalty was charged; applied means it succeeded.",
  "get_prediction_rules provides the required response format and move count guidance.",
  "Moves replay in order until the destination or the first invalid move (a wall collision or out-of-bounds step).",
  "Every move in your response counts toward score decay, including moves after the first invalid move.",
  "lastMoveStatus reached-target or status won means the game is complete — stop predicting.",
  "Score decay charges every submitted move, so fewer correct moves preserve more score.",
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
        enum: ["MoveLeft", "MoveRight", "MoveUp", "MoveDown"],
      },
    },
  },
}


// createState builds a compact agent-facing runtime state for movement feedback tests.
function createState(overrides: Partial<State> = {}): State {
  return {
    controlMode: CONFIG.runtime.controlModes.agentApi,
    level: 4,
    mazeDimensions: { numCols: 2, numRows: 1, area: 2 },
    maze: [
      ["|", "---", "|", "---", "|"],
      ["|", "   ", " ", "   ", "|"],
      ["|", "---", "|", "---", "|"],
    ],
    playerPosition: { x: 1, y: 1 },
    traversalHistory: [selfVisit(0, 0, ["MoveRight"])],
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
    const toolHandlers = buildAgentToolHandlers(createState(), actionResult)

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
      mazeDimensions: { numCols: 2, numRows: 1, area: 2 },
    })
    expect(toolHandlers.get_maze_positions({})).toEqual({
      currentCell: { row: 0, col: 0 },
      destinationCell: { row: 0, col: 1 },
    })
    expect(toolHandlers.get_traversal_history({})).toEqual({
      traversalHistory: [selfVisit(0, 0, ["MoveRight"])],
    })
    expect(toolHandlers.get_prediction_rules({})).toEqual({
      suggestedMovesPerTurn: 4,
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
