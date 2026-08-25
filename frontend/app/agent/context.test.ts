import { describe, expect, it } from "vitest"

import { CONFIG } from "../config"
import {
  AGENT_CONTEXT_TOOLS,
  buildAgentMessages,
  buildAgentToolHandlers,
  buildDuplicateToolCallMessage,
  buildTokenLimitExhaustionPrompt,
  describeAgentSpeedClassification,
} from "./context"
import { snapshotAgentState } from "./state-snapshot"
import {
  buildMazeActionResult,
} from "../control"
import type {
  AgentApiSeatConfig,
  AgentExpectedResponseSchema,
  State,
  TraversalHistoryEntry,
} from "../types"

function selfVisit(
  row: number,
  col: number,
  openMoves: TraversalHistoryEntry["openMoves"] = [],
  visitCount = 1,
): TraversalHistoryEntry {
  return { playerName: CONFIG.runtime.interactivePlayerName, row, col, openMoves, visitCount }
}

function agentVisit(
  row: number,
  col: number,
  playerName: string,
  openMoves: TraversalHistoryEntry["openMoves"] = [],
  visitCount = 1,
): TraversalHistoryEntry {
  return { playerName, row, col, openMoves, visitCount }
}

function createAgent(overrides: Partial<AgentApiSeatConfig> = {}): AgentApiSeatConfig {
  return {
    seatId: 1,
    sessionId: 1_700_000_000_000,
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
  "You are Blue and your traversal speed currently classifies as navigator. Conservative play and retrace-only batching can be structurally capped below trailblazer; exceeding 1.0 requires forward batching into unvisited cells.",
  "Call every available tool once on each turn before returning moves. Start with get_maze_structure to read currentCell, destinationCell, and nearby maze structure; call get_prediction_rules for the required response format, suggested move count, mazeDimensions, and traversal-speed metrics; call get_last_prediction_outcome for current status, score, and the previous prediction outcome.",
  "The maze is randomly generated at the start of each level with exactly one path to the destination. For the current level, maze dimensions and wall/open-exit structure are fixed once generated.",
  `When present in filteredTraversalHistory, playerName ${CONFIG.runtime.interactivePlayerName} marks the start cell.`,
  "Use openMoves from filteredTraversalHistory entries to build a local map; entries recorded by other players are just as trustworthy as your own. currentCell is the position you landed on after applying the valid moves from the previous turn; at the start of each level, currentCell matches the start-cell.",
  "Your primary objective is to reach destinationCell, the level's fixed target position, with the highest traversal speed. cellType start-cell and target-cell label the start and destination cells respectively. Every openMoves entry is a candidate direction and includes the reached cell's visitStatus as guidance for choosing that move: unvisited means new ground, explored means already reached but still holding unused exits, backtracking means all exits have been used, and oscillating means the cell has been over-visited. Each turn, prefer an unvisited neighbor of currentCell before weighing distance to destinationCell; when none is adjacent, move through explored neighbors to reach one. Treat moves into cells whose visitStatus is backtracking or oscillating as the exhausted dead-end region to move away from; moves into cells with explored or unvisited status point back toward useful search.",
  "Retreat cues are cells reached by openMoves whose visitStatus is backtracking or oscillating. A dead-end cell is set to backtracking visitStatus on first visit, then oscillating if revisited again. During deliberate retreat, revisiting a cell already in filteredTraversalHistory is not a mistake, although it adds no new-cell progress. Once a retreat cue appears, use filteredTraversalHistory to search earlier visited cells for an unexplored branch point, maybe within or beyond historyWindowRadius, so keep retreating through explored cells until a later turn's filteredTraversalHistory brings it into view. When judging whether one candidate cell is closer to destinationCell than another, compare the full combined row and col differences for each candidate, not just one axis \u2014 a cell closer on one axis can be equally far or farther away overall once the other axis is considered. By design, the maze never guarantees a direct route from start to destination; the only valid path may require moving away from the target before turning towards it.",
  "Use lastMoveStatus to understand the outcome and chargedMovesCount for the exact score-decay impact from that outcome.",
  "A turn with any valid moves costs a constant 1-unit decay charge regardless of how many submitted moves apply. If replay then reaches an invalid move, that adds a 1-unit penalty, for a total charge of 2. If the very first submitted move is already invalid — no progress at all — the turn instead costs a flat 2-unit decay charge. A malformed response (invalid JSON, an unknown tool request, or ignoring a warning) costs a fixed 3 decay units with no moves applied — the costliest outcome of all.",
  "One way to sustain a traversal speed above 1.0, keeping your classification at trailblazer, is to build a picture of the maze around your current cell using filteredTraversalHistory and the static maze dimensions.",
  "The openMoves in the filteredTraversalHistory entry matching currentCell are a natural place to start when extracting high-confidence multi-move predictions. With enough of that picture assembled, you can often find several consecutive moves that are all certain to apply without producing an invalid-move. You could also invent a better way to sustain that classification.",
  "get_prediction_rules provides the required response format and move count guidance. Submitted moves execute in order until the destination is reached or the first invalid move (a wall collision or out-of-bounds step) is hit.",
  "Because the charge above is per turn rather than per move, a longer prediction whose moves all land can cover more new cells for the same decay. get_prediction_rules explains the live traversal-speed metrics and classification.",
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
    const toolHandlers = buildAgentToolHandlers(snapshotAgentState(createState()), actionResult, createAgent())

    expect(AGENT_CONTEXT_TOOLS.map((tool) => tool.function.name)).toEqual([
      "get_maze_structure",
      "get_prediction_rules",
      "get_last_prediction_outcome",
    ])
    expect(toolHandlers.get_maze_structure({})).toEqual({
      level: 4,
      currentCell: { row: 0, col: 0 },
      destinationCell: { row: 0, col: 1 },
      historyWindowRadius: CONFIG.runtime.modelConfig.manhattanDistance,
      filteredTraversalHistory: [
        {
          playerName: "Self",
          cell: { row: 0, col: 0 },
          cellType: "start-cell",
          // (0,1) is in history with one open exit and one visit, so every way out of it has been
          // taken — backtracking, not merely explored.
          openMoves: { MoveRight: { row: 0, col: 1, visitStatus: "backtracking" } },
        },
        {
          playerName: "Blue",
          cell: { row: 0, col: 1 },
          cellType: "target-cell",
          openMoves: { MoveRight: { row: 0, col: 2, visitStatus: "unvisited" } },
        },
      ],
    })
    expect(toolHandlers.get_prediction_rules({})).toEqual({
      suggestedMovesPerTurn: CONFIG.runtime.modelConfig.suggestedMovesPerTurnRange,
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
      decayUnitsRemaining: 7,
      lastMoveStatus: "applied",
      predictionStatus: null,
      lastReplayStartIndex: 0,
      lastSubmittedMoves: ["0:MoveRight"],
      lastAppliedMoveIndex: 0,
      chargedMovesCount: 1,
    })
  })

  it("freezes a snapshot taken once, unaffected by state mutations made afterward", () => {
    const state = createState()
    const toolHandlers = buildAgentToolHandlers(snapshotAgentState(state), null, createAgent())

    // Mutate the live state after the snapshot was taken — a push (in place) and reassignments
    // (new references), mirroring exactly how game.ts mutates State mid-round.
    state.traversalHistory.push(agentVisit(0, 2, "Blue", ["MoveRight"]))
    state.playerPosition = { x: 3, y: 1 }
    state.score = 1
    state.turnCount = 9
    state.status = "won"

    expect(toolHandlers.get_prediction_rules({})).toMatchObject({
      totalTurnCount: 0,
      playerTurnsTaken: 2,
    })
    expect(toolHandlers.get_maze_structure({})).toMatchObject({
      currentCell: { row: 0, col: 0 },
      filteredTraversalHistory: [
        expect.objectContaining({ cell: { row: 0, col: 0 } }),
        expect.objectContaining({ cell: { row: 0, col: 1 } }),
      ],
    })
    expect(toolHandlers.get_last_prediction_outcome({})).toMatchObject({
      status: "running",
      score: 700,
    })
  })

  it("includes the final potentially winning decay unit in the remaining budget", () => {
    expect(buildAgentToolHandlers(snapshotAgentState(createState({ score: 100 })), null, createAgent())
      .get_last_prediction_outcome({})).toMatchObject({ decayUnitsRemaining: 1 })
    expect(buildAgentToolHandlers(snapshotAgentState(createState({ score: 0 })), null, createAgent())
      .get_last_prediction_outcome({})).toMatchObject({ decayUnitsRemaining: 0 })
  })

  // suggestedMovesPerTurn is a static configured range, not derived from maze dimensions — it stays
  // the same even in the unreachable case where dimensions are missing.
  it("suggests the same static moves-per-turn range regardless of maze dimensions", () => {
    const toolHandlers = buildAgentToolHandlers(
      snapshotAgentState(createState({ mazeDimensions: null })),
      null,
      createAgent({}),
    )

    expect(toolHandlers.get_prediction_rules({})).toMatchObject({
      suggestedMovesPerTurn: CONFIG.runtime.modelConfig.suggestedMovesPerTurnRange,
    })
  })

  it("defaults a fresh agent's prediction rules to a trailblazer level regardless of raw counts", () => {
    const freshAgent = createAgent({ turnCount: undefined, decayUnitsCharged: undefined })
    const toolHandlers = buildAgentToolHandlers(snapshotAgentState(createState()), null, freshAgent)

    expect(toolHandlers.get_prediction_rules({})).toEqual({
      suggestedMovesPerTurn: CONFIG.runtime.modelConfig.suggestedMovesPerTurnRange,
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
    // Every cell carries at least one open exit: the generator cannot produce a zero-exit cell, so a
    // fixture without one would exercise a state the game can never reach.
    const fullTraversalHistory = [
      selfVisit(0, 0, ["MoveRight"]),
      agentVisit(4, 4, "Blue", ["MoveRight", "MoveUp"]),
      agentVisit(4, 8, "Blue", ["MoveRight"]),
      agentVisit(4, 9, "Blue", ["MoveLeft"]),
      agentVisit(9, 9, "Blue", ["MoveUp"]),
      agentVisit(1, 4, "Blue", ["MoveUp"]),
      agentVisit(0, 4, "Blue", ["MoveDown"]),
    ]
    const state = createState({
      mazeDimensions: { numCols: 10, numRows: 10, area: 100 },
      playerPosition: { x: 9, y: 9 },
      finalPosition: { x: 15, y: 9 },
      traversalHistory: fullTraversalHistory,
    })
    const toolHandlers = buildAgentToolHandlers(snapshotAgentState(state), null, createAgent())

    expect(toolHandlers.get_maze_structure({})).toEqual({
      level: 4,
      currentCell: { row: 4, col: 4 },
      destinationCell: { row: 4, col: 7 },
      historyWindowRadius: CONFIG.runtime.modelConfig.manhattanDistance,
      filteredTraversalHistory: [
        {
          playerName: "Blue",
          cell: { row: 4, col: 4 },
          cellType: "corridor",
          openMoves: {
            MoveRight: { row: 4, col: 5, visitStatus: "unvisited" },
            MoveUp: { row: 3, col: 4, visitStatus: "unvisited" },
          },
        },
        {
          playerName: "Blue",
          cell: { row: 4, col: 8 },
          cellType: "dead-end",
          // (4,9) has one exit and one visit, so its visit count matches its exit count.
          openMoves: { MoveRight: { row: 4, col: 9, visitStatus: "backtracking" } },
        },
        {
          playerName: "Blue",
          cell: { row: 1, col: 4 },
          cellType: "dead-end",
          openMoves: { MoveUp: { row: 0, col: 4, visitStatus: "backtracking" } },
        },
        {
          playerName: "Blue",
          cell: { row: 0, col: 4 },
          cellType: "dead-end",
          openMoves: { MoveDown: { row: 1, col: 4, visitStatus: "backtracking" } },
        },
      ],
    })
    expect(state.traversalHistory).toEqual(fullTraversalHistory)
  })

  it("keeps both the moves-per-turn range and the maze-structure distance unaffected by a larger maze area", () => {
    const state = createState({
      mazeDimensions: { numCols: 40, numRows: 40, area: 1600 },
      playerPosition: { x: 9, y: 9 },
      traversalHistory: [
        selfVisit(0, 0),
        agentVisit(4, 4, "Blue"),
        agentVisit(4, 8, "Blue"),
      ],
    })
    const toolHandlers = buildAgentToolHandlers(snapshotAgentState(state), null, createAgent())

    expect(toolHandlers.get_prediction_rules({})).toMatchObject({
      suggestedMovesPerTurn: CONFIG.runtime.modelConfig.suggestedMovesPerTurnRange,
    })
    expect(toolHandlers.get_maze_structure({})).toMatchObject({
      level: 4,
      historyWindowRadius: CONFIG.runtime.modelConfig.manhattanDistance,
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

describe("buildTokenLimitExhaustionPrompt", () => {
  it("gives the model one free corrective prediction opportunity and names the repeat-failure cost", () => {
    expect(buildTokenLimitExhaustionPrompt(10_000)).toEqual({
      role: "user",
      content:
        "Warning: Your previous response had a token-limit-exhaustion error and used 10000 tokens without returning a " +
        "prediction. Try once more to return the correct prediction format output without overthinking. This retry is " +
        "free, but on reaching the token limit again without a prediction you will be charged the same fixed penalty " +
        "as a malformed response.",
    })
  })
})

describe("describeAgentSpeedClassification", () => {
  it("states that trailblazer means forward deduction happened", () => {
    const description = describeAgentSpeedClassification("Blue", "trailblazer")

    expect(description).toContain("You are Blue")
    expect(description).toContain("classifies as trailblazer")
    expect(description).toContain("more than one new-cell visit per decay unit")
    expect(description).toContain("forward deduction into unexplored structure")
  })

  it("states that backtracker can be a structural ceiling without forward batching", () => {
    const description = describeAgentSpeedClassification("Blue", "backtracker")

    expect(description).toContain("You are Blue")
    expect(description).toContain("currently classifies as backtracker")
    expect(description).toContain("structurally capped below trailblazer")
    expect(description).toContain("forward batching into unvisited cells")
  })

  it("states that navigator can be a structural ceiling without forward batching", () => {
    const description = describeAgentSpeedClassification("Blue", "navigator")

    expect(description).toContain("You are Blue")
    expect(description).toContain("currently classifies as navigator")
    expect(description).toContain("structurally capped below trailblazer")
    expect(description).toContain("forward batching into unvisited cells")
  })
  it("derives visitStatus from visits against a cell's own exit count", () => {
    // A 4-exit junction at (0,1) is the discriminating shape: it stays explored while unused exits
    // remain and only flips once visits reach its exit count, so the boundary is exercised rather
    // than assumed. (0,2) is never reached at all, and (0,0) is a one-exit cell already stood on.
    const junction = agentVisit(0, 1, "Blue", ["MoveLeft", "MoveRight", "MoveUp", "MoveDown"], 3)
    const state = createState({
      mazeDimensions: { numCols: 3, numRows: 1, area: 3 },
      traversalHistory: [selfVisit(0, 0, ["MoveRight"]), junction],
    })

    const structure = buildAgentToolHandlers(snapshotAgentState(state), null, createAgent())
      .get_maze_structure({}) as {
        filteredTraversalHistory: { cell: { row: number; col: number }; openMoves: Record<string, { visitStatus: string }> }[]
      }
    const statusOf = (row: number, col: number, move: string) =>
      structure.filteredTraversalHistory.find((entry) => entry.cell.row === row && entry.cell.col === col)
        ?.openMoves[move]?.visitStatus

    // 3 visits against 4 exits — a way out remains, so the direction is still live.
    expect(statusOf(0, 0, "MoveRight")).toBe("explored")
    // No entry at all for (0,2).
    expect(statusOf(0, 1, "MoveRight")).toBe("unvisited")
    // (0,0) has a single exit and one visit: 1 >= 1, so every way out of it has been taken.
    expect(statusOf(0, 1, "MoveLeft")).toBe("backtracking")

    // One more visit puts the junction at its exit count, which is the flip point.
    junction.visitCount = 4
    const exhausted = buildAgentToolHandlers(snapshotAgentState(state), null, createAgent())
      .get_maze_structure({}) as {
        filteredTraversalHistory: { cell: { row: number; col: number }; openMoves: Record<string, { visitStatus: string }> }[]
      }
    expect(
      exhausted.filteredTraversalHistory.find((entry) => entry.cell.col === 0)
        ?.openMoves.MoveRight.visitStatus,
    ).toBe("backtracking")

    // Past the exit count, the cell is no longer merely backtracking — it is over-revisiting.
    junction.visitCount = 5
    const oscillating = buildAgentToolHandlers(snapshotAgentState(state), null, createAgent())
      .get_maze_structure({}) as {
        filteredTraversalHistory: { cell: { row: number; col: number }; openMoves: Record<string, { visitStatus: string }> }[]
      }
    expect(
      oscillating.filteredTraversalHistory.find((entry) => entry.cell.col === 0)
        ?.openMoves.MoveRight.visitStatus,
    ).toBe("oscillating")
  })

  it("never exposes the raw visitCount to the model", () => {
    // visitStatus is the model-facing preprocessing of visitCount; handing over the tally itself
    // would invite the model to re-derive the threshold and get it wrong. get_maze_structure builds
    // its entries from an explicit allowlist to prevent that, and this locks the guarantee in.
    const state = createState({
      traversalHistory: [selfVisit(0, 0, ["MoveRight"], 97), agentVisit(0, 1, "Blue", ["MoveRight"], 98)],
    })

    const structure = buildAgentToolHandlers(snapshotAgentState(state), null, createAgent())
      .get_maze_structure({})

    const serialized = JSON.stringify(structure)
    expect(serialized).not.toContain("visitCount")
    expect(serialized).not.toContain("97")
    expect(serialized).not.toContain("98")
  })
})
