import { describe, expect, it } from "vitest"

import { CONFIG } from "../config"
import {
  AGENT_CONTEXT_TOOLS,
  buildAgentMessages,
  buildAgentToolHandlers,
  buildDuplicateToolCallMessage,
  describeAgentSpeedClassification,
} from "./context"
import {
  buildMazeActionResult,
} from "../control"
import type {
  AgentApiConfig,
  AgentExpectedResponseSchema,
  State,
  TraversalHistoryEntry,
} from "../types"

function selfVisit(row: number, col: number, openMoves: TraversalHistoryEntry["openMoves"] = []): TraversalHistoryEntry {
  return { playerName: CONFIG.runtime.interactivePlayerName, row, col, openMoves }
}

function agentVisit(row: number, col: number, playerName: string, openMoves: TraversalHistoryEntry["openMoves"] = []): TraversalHistoryEntry {
  return { playerName, row, col, openMoves }
}

function createAgent(overrides: Partial<AgentApiConfig> = {}): AgentApiConfig {
  return {
    id: 1,
    playerName: "Blue",
    model: "qwen3.6:27b",
    endpoint: new URL("https://agents.example/chat"),
    api: "ollama",
    enabled: true,
    gameLevel: 4,
    turnCount: 2,
    decayUnitsCharged: 2,
    ...overrides,
  }
}

const expectedAgentPrompt = [
  "You are Blue and your traversal speed has dropped to a classification of navigator. You've got an uphill task and need to work smarter to climb into the genius zone of trailblazer classification.",
  "Call every available tool once on each turn before returning moves. Start with get_maze_structure to read currentCell, destinationCell, and nearby maze structure; call get_prediction_rules for the required response format, suggested move count, mazeDimensions, and traversal-speed metrics; call get_last_prediction_outcome for current status, score, and the previous prediction outcome.",
  "The maze is randomly generated at the start of each level with exactly one path to the destination. For the current level, maze dimensions and wall/open-exit structure are fixed once generated.",
  `When present in filteredTraversalHistory, playerName ${CONFIG.runtime.interactivePlayerName} marks the start cell.`,
  "Use openMoves from filteredTraversalHistory entries to build a local map; entries recorded by other players are just as trustworthy as your own.",
  "Revisiting a cell already in filteredTraversalHistory is not a mistake — once the current path is confirmed as leading to a dead end, backtracking through those cells is usually the only way to reach unexplored territory or the destination. By design, the maze never guarantees a direct route from start to destination; the only valid path may require moving away from the target before turning towards it.",
  "Use lastMoveStatus to understand the outcome and chargedMovesCount for the exact score-decay impact from that outcome.",
  "A turn with any valid moves costs a constant 1 decay units regardless of how many moves it applied. If any of those moves is invalid, that adds a further penalty of 1 decay unit on top - for 2 decay units in total. If the very first submitted move is already invalid — no progress at all — the turn instead costs a flat 2 decay units. A malformed response (invalid JSON, an unknown tool request, or ignoring a duplicate tool call warning) costs a fixed 3 decay units with no moves applied — the costliest outcome of all.",
  "One way to sustain a traversal speed above 1.0, keeping your classification at trailblazer, is to build a picture of the maze around your current cell using filteredTraversalHistory and the static maze dimensions.",
  "currentCell's openMoves are a natural place to start when extracting high-confidence multi-move predictions. With enough of that picture assembled, you can often find several consecutive moves that are all certain to apply without any invalid-move. You could also invent a better way to sustain that classification.",
  "get_prediction_rules provides the required response format and move count guidance. Submitted moves execute in order until the destination is reached or the first invalid move (a wall collision or out-of-bounds step) is hit.",
  "Because the charge above is per turn rather than per move, a longer prediction whose moves all land covers more new cells for the same decay. get_prediction_rules explains the live traversal-speed metrics and classification.",
  "lastMoveStatus reached-target or status won means the game is complete — stop predicting.",
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
    startPosition: { x: 1, y: 1 },
    playerPosition: { x: 1, y: 1 },
    traversalHistory: [selfVisit(0, 0, ["MoveRight"]), agentVisit(0, 1, "Blue", ["MoveRight"])],
    finalPosition: { x: 3, y: 1 },
    status: "running",
    score: 700,
    lastRoundScore: 0,
    lastAttemptRetentionUnits: null,
    bestWinRetentionUnits: null,
    lastWinTraversalSpeedUnits: null,
    bestWinTraversalSpeedUnits: null,
    winSummary: "",
    wallWeight: 1,
    scoreDecayUnits: 0,
    turnCount: 0,
    cumulativeRoundCount: 0,
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
    const toolHandlers = buildAgentToolHandlers(createState(), actionResult, createAgent())

    expect(AGENT_CONTEXT_TOOLS.map((tool) => tool.function.name)).toEqual([
      "get_maze_structure",
      "get_prediction_rules",
      "get_last_prediction_outcome",
    ])
    expect(toolHandlers.get_maze_structure({})).toEqual({
      level: 4,
      currentCell: { row: 0, col: 0 },
      destinationCell: { row: 0, col: 1 },
      manhattanDistance: CONFIG.runtime.modelConfig.manhattanDistance,
      filteredTraversalHistory: [
        {
          playerName: "Self",
          cell: { row: 0, col: 0 },
          openMoves: { MoveRight: { row: 0, col: 1, visited: true } },
        },
        {
          playerName: "Blue",
          cell: { row: 0, col: 1 },
          openMoves: { MoveRight: { row: 0, col: 2, visited: false } },
        },
      ],
    })
    expect(toolHandlers.get_prediction_rules({})).toEqual({
      suggestedMovesPerTurn: 4,
      playerUniqueCellsVisited: 1,
      allUniqueCellsVisited: 2,
      decayUnitsCharged: 2,
      totalTurnCount: 0,
      playerTurnsTaken: 2,
      batchEfficiencyClass: "backtracker",
      mazeDimensions: { numCols: 2, numRows: 1, totalMazeCells: 2 },
      expectedResponseSchema,
    })
    expect(toolHandlers.get_last_prediction_outcome({})).toEqual({
      status: "running",
      score: 700,
      lastPlayerName: "Blue",
      lastMoveStatus: "applied",
      lastReplayStartIndex: 0,
      lastSubmittedMoves: ["0:MoveRight"],
      lastAppliedMoveIndex: 0,
      visitedBefore: false,
      chargedMovesCount: 1,
    })
  })

  // A zero suggestion would read as "batch nothing" - a followable instruction no level intends -
  // so the count stays positive even in the unreachable case where dimensions are missing.
  it("never suggests zero moves per turn, even without maze dimensions", () => {
    const toolHandlers = buildAgentToolHandlers(
      createState({ mazeDimensions: null }),
      null,
      createAgent({}),
    )

    const { suggestedMovesPerTurn } = toolHandlers.get_prediction_rules({}) as {
      suggestedMovesPerTurn: number
    }
    expect(suggestedMovesPerTurn).toBeGreaterThan(0)
  })

  it("defaults a fresh agent's prediction rules to a trailblazer level regardless of raw counts", () => {
    const freshAgent = createAgent({ turnCount: undefined, decayUnitsCharged: undefined })
    const toolHandlers = buildAgentToolHandlers(createState(), null, freshAgent)

    expect(toolHandlers.get_prediction_rules({})).toEqual({
      suggestedMovesPerTurn: 4,
      playerUniqueCellsVisited: 1,
      allUniqueCellsVisited: 2,
      decayUnitsCharged: 0,
      totalTurnCount: 0,
      playerTurnsTaken: 0,
      batchEfficiencyClass: "trailblazer",
      mazeDimensions: { numCols: 2, numRows: 1, totalMazeCells: 2 },
      expectedResponseSchema,
    })
  })

  it("filters maze structure by Manhattan distance without trimming internal history", () => {
    const fullTraversalHistory = [
      selfVisit(0, 0, ["MoveRight"]),
      agentVisit(4, 4, "Blue", ["MoveRight", "MoveUp"]),
      agentVisit(4, 8, "Blue", ["MoveRight"]),
      agentVisit(4, 9, "Blue"),
      agentVisit(9, 9, "Blue"),
      agentVisit(1, 4, "Blue"),
      agentVisit(0, 4, "Blue"),
    ]
    const state = createState({
      mazeDimensions: { numCols: 10, numRows: 10, area: 100 },
      playerPosition: { x: 9, y: 9 },
      finalPosition: { x: 15, y: 9 },
      traversalHistory: fullTraversalHistory,
    })
    const toolHandlers = buildAgentToolHandlers(state, null, createAgent())

    expect(toolHandlers.get_maze_structure({})).toEqual({
      level: 4,
      currentCell: { row: 4, col: 4 },
      destinationCell: { row: 4, col: 7 },
      manhattanDistance: CONFIG.runtime.modelConfig.manhattanDistance,
      filteredTraversalHistory: [
        {
          playerName: "Blue",
          cell: { row: 4, col: 4 },
          openMoves: {
            MoveRight: { row: 4, col: 5, visited: false },
            MoveUp: { row: 3, col: 4, visited: false },
          },
        },
        {
          playerName: "Blue",
          cell: { row: 4, col: 8 },
          openMoves: { MoveRight: { row: 4, col: 9, visited: true } },
        },
        {
          playerName: "Blue",
          cell: { row: 1, col: 4 },
          openMoves: {},
        },
        {
          playerName: "Blue",
          cell: { row: 0, col: 4 },
          openMoves: {},
        },
      ],
    })
    expect(state.traversalHistory).toEqual(fullTraversalHistory)
  })

  it("keeps maze-structure distance at the configured ceiling even when suggested moves shrink", () => {
    const state = createState({
      mazeDimensions: { numCols: 40, numRows: 40, area: 1600 },
      playerPosition: { x: 9, y: 9 },
      traversalHistory: [
        selfVisit(0, 0),
        agentVisit(4, 4, "Blue"),
        agentVisit(4, 8, "Blue"),
      ],
    })
    const toolHandlers = buildAgentToolHandlers(state, null, createAgent())

    expect(toolHandlers.get_prediction_rules({})).toMatchObject({
      suggestedMovesPerTurn: 3,
    })
    expect(toolHandlers.get_maze_structure({})).toMatchObject({
      level: 4,
      manhattanDistance: CONFIG.runtime.modelConfig.manhattanDistance,
      filteredTraversalHistory: [
        { playerName: "Blue", cell: { row: 4, col: 4 }, openMoves: {} },
        { playerName: "Blue", cell: { row: 4, col: 8 }, openMoves: {} },
      ],
    })
  })

  it("builds the initial agent chat message without embedding the full maze state", () => {
    expect(buildAgentMessages("Blue", "navigator")).toEqual([
      {
        role: "system",
        content: expectedAgentPrompt,
      },
      {
        role: "user",
        content: `It is Blue's turn to predict next moves. Use the available tools to see the maze state.`,
      },
    ])
  })

})

describe("buildDuplicateToolCallMessage", () => {
  it("names a single duplicate call as an explicit warning tied to malformed-response", () => {
    const message = buildDuplicateToolCallMessage([
      { id: "call_2", function: { name: "get_last_prediction_outcome", arguments: {} } },
    ])

    expect(message).toEqual({
      role: "user",
      content:
        "Warning: get_last_prediction_outcome (call_2) won't yield any new information. " +
        "You may still call any tools you haven't used yet, or respond now with only the moves JSON. " +
        "Requesting these tool call(s) once again will be treated as a malformed-response.",
    })
  })

  it("lists multiple duplicate calls together, in order", () => {
    const message = buildDuplicateToolCallMessage([
      { id: "call_2", function: { name: "get_last_prediction_outcome", arguments: {} } },
      { id: "call_3", function: { name: "get_maze_structure", arguments: {} } },
    ])

    expect(message.content).toContain(
      "get_last_prediction_outcome (call_2), get_maze_structure (call_3) won't yield any new information.",
    )
  })

  it("falls back to placeholders when a call is missing its name or id", () => {
    const message = buildDuplicateToolCallMessage([{ function: { arguments: {} } }])

    expect(message.content).toContain("unknown (no id)")
  })
})

describe("describeAgentSpeedClassification", () => {
  it("tells a trailblazer it's in the genius zone rather than needing to climb toward it", () => {
    const description = describeAgentSpeedClassification("Blue", "trailblazer")

    expect(description).toContain("You are Blue")
    expect(description).toContain("classifies as trailblazer")
    expect(description).toContain("genius zone")
    expect(description).toContain("might set a new record")
  })

  it("tells a backtracker it has dropped from trailblazer and should climb back", () => {
    const description = describeAgentSpeedClassification("Blue", "backtracker")

    expect(description).toContain("You are Blue")
    expect(description).toContain("dropped to a classification of backtracker")
    expect(description).toContain("work smarter to climb into")
    expect(description).toContain("climb into the genius zone")
  })

  it("tells a navigator it has dropped from trailblazer and should climb back", () => {
    const description = describeAgentSpeedClassification("Blue", "navigator")

    expect(description).toContain("You are Blue")
    expect(description).toContain("dropped to a classification of navigator")
    expect(description).toContain("work smarter to climb into")
    expect(description).toContain("climb into the genius zone")
  })
})
