import { describe, expect, it } from "vitest"

import { CONFIG } from "../config"
import {
  AGENT_CONTEXT_TOOLS,
  buildAgentMessages,
  buildAgentToolHandlers,
  buildDuplicateToolCallMessage,
  buildMazeActionPrompt,
  buildTokenLimitExhaustionPrompt,
  buildAgentPersonaPrompt,
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
  "You are Blue and your traversal speed currently classifies as navigator. You are holding the 1.0000 baseline: reaching exactly one new cell for every decay unit spent. Nothing in the maze pins you there - a turn whose moves all land is charged one unit whether it reached one new cell or several cells, and even a forced retreat can be batched into a single turn. Raise the rate by batching longer predictions into unvisited cells, as far as you can prove the moves will apply.",
  "Call every available tool once on each turn before returning moves. Start with get_maze_structure to read currentCell, destinationCell, and nearby maze structure; call get_prediction_rules for the required response format, suggested move count, mazeDimensions, and traversal-speed metrics; call get_last_prediction_outcome for current status, score, decayUnitsRemaining, and the previous prediction outcome.",
  "The maze is randomly generated at the start of each level with exactly one path to the destination. For the current level, maze dimensions and wall/open-exit structure are fixed once generated.",
  `When present in filteredTraversalHistory, playerName ${CONFIG.runtime.interactivePlayerName} marks the start cell.`,
  "Use openMoves from filteredTraversalHistory entries to build a local map; entries recorded by other players are just as trustworthy as your own. currentCell is where the previous turn's valid moves ended, whoever played it; at the start of each level, currentCell matches the start-cell.",
  "Your primary objective is to reach destinationCell, the level's fixed target position, with the highest traversal speed. cellType start-cell and target-cell label the start and destination cells respectively. Every openMoves entry is a candidate direction and includes the reached cell's visitStatus as guidance for choosing that move; get_maze_structure defines what each value means. Each turn, prefer an unvisited neighbor of currentCell before weighing distance to destinationCell; when none is adjacent, move through explored neighbors to reach one. Treat moves into cells whose visitStatus is backtracking or oscillating as the exhausted dead-end region to move away from; moves into cells with explored or unvisited status point back toward useful search.",
  "Retreat cues are cells reached by openMoves whose visitStatus is backtracking or oscillating. A dead-end cell is set to backtracking visitStatus on first visit, then oscillating if revisited again. During deliberate retreat, revisiting a cell already in filteredTraversalHistory is not a mistake, although it adds no new-cell progress. Once a retreat cue appears, use filteredTraversalHistory to search earlier visited cells for an unexplored branch point, maybe within or beyond historyWindowRadius, so keep retreating through explored cells until a later turn's filteredTraversalHistory brings it into view. When judging whether one candidate cell is closer to destinationCell than another, compare the full combined row and col differences for each candidate, not just one axis - a cell closer on one axis can be equally far or farther away overall once the other axis is considered. By design, the maze never guarantees a direct route from start to destination; the only valid path may require moving away from the target before turning towards it.",
  "Use lastMoveStatus to understand the outcome and chargedMovesCount for the exact score-decay impact from that outcome.",
  "A turn with any valid moves costs a constant 1-unit decay charge regardless of how many submitted moves apply. If replay then reaches an invalid move, that adds a 1-unit penalty, for a total charge of 2. If the very first submitted move is already invalid - no progress at all - the turn instead costs a flat 2-unit decay charge. A malformed response (invalid JSON, an unknown tool request, or ignoring a warning) costs a fixed 3 decay units with no moves applied - the costliest outcome of all.",
  "Those charges are what spend decayUnitsRemaining, and every turn spends at least one of them, so it caps how many turns you have left - fewer than that whenever a turn takes a penalty. get_last_prediction_outcome reports its current value and what running out of it means.",
  "One way to raise a traversal speed above 1.0000 is to build a picture of the maze around your current cell using filteredTraversalHistory and the static maze dimensions.",
  "The openMoves in the filteredTraversalHistory entry matching currentCell are a natural place to start when extracting high-confidence multi-move predictions. With enough of that picture assembled, you can often find several consecutive moves that are all certain to apply without producing an invalid-move. You could also invent a better way to keep raising it.",
  "Submitted moves execute in order until the destination is reached or the first invalid move (a wall collision or out-of-bounds step) is hit.",
  "lastMoveStatus reached-target or status won means the game is complete - stop predicting.",
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
    restartLevel: 1,
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
      lastReplayStartCell: null,
      lastReplayStartIndex: 0,
      lastSubmittedMoves: ["MoveRight"],
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
          // taken - backtracking, not merely explored.
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
      lastReplayStartCell: null,
      lastSubmittedMoves: ["MoveRight"],
      lastAppliedMoveIndex: 0,
      chargedMovesCount: 1,
    })
  })

  it("freezes a snapshot taken once, unaffected by state mutations made afterward", () => {
    const state = createState()
    const toolHandlers = buildAgentToolHandlers(snapshotAgentState(state), null, createAgent())

    // Mutate the live state after the snapshot was taken - a push (in place) and reassignments
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

  // suggestedMovesPerTurn is a static configured range, not derived from maze dimensions - it stays
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

  // The costs block prices a turn; this line names what those charges draw down and points at the
  // tool that reports the balance. Deliberately short - get_last_prediction_outcome already
  // documents decayUnitsRemaining and the loss condition, so restating either here would only give
  // the two places a chance to disagree.
  //
  // The negative assertions pin claims earlier drafts made and that must not return:
  //   - that a turn's charge is independent of how many moves it carries (it tracks the outcome -
  //     a batch stopped at a wall costs more than one that lands),
  //   - that the budget should be weighed against the distance to destinationCell (reads as licence
  //     to beeline, contradicting the retreat guidance in this same prompt),
  //   - that a turn is "worth" the ground it covers (score is pure decay; a new cell never adds to
  //     it, so value language makes exploration look self-financing).
  it("names what the charges spend and points at the tool that reports it", () => {
    const prompt = buildMazeActionPrompt("Blue", "navigator", false)

    expect(prompt).toContain("every turn spends at least one of them")
    expect(prompt).toContain("caps how many turns you have left")
    expect(prompt).toContain("get_last_prediction_outcome reports its current value")
    expect(prompt).not.toContain("costs no more than")
    expect(prompt).not.toContain("difference between currentCell and destinationCell")
    // Narrow on purpose: a bare "worth" also matches "trustworthy" elsewhere in the prompt.
    expect(prompt).not.toContain("is worth")
  })

  it("builds the initial agent chat message without embedding the full maze state", () => {
    expect(buildAgentMessages("Blue", "navigator", false)).toEqual([
      {
        role: "system",
        content: expectedAgentPrompt,
      },
      {
        role: "user",
        content: `It is Blue's turn to predict the next moves. Call every available tool once, then reply with only the moves JSON.`,
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
        "You may still call any tools you haven't used yet, or reply now with only the moves JSON. " +
        "Requesting them again will be treated as a malformed-response.",
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
        "prediction. Keep your reasoning brief this time and reply with only the moves JSON. This retry is " +
        "free, but on reaching the token limit again without a prediction you will be charged the same fixed penalty " +
        "as a malformed response.",
    })
  })
})

describe("buildAgentPersonaPrompt", () => {
  // Nothing charged is its own branch. resolveStatusSpeedClass reports trailblazer here, so the
  // wording must name that default without claiming a measurement that has not happened.
  it("primes the agent for success without inventing a history", () => {
    const description = buildAgentPersonaPrompt("Blue", "trailblazer", true)

    expect(description).toContain("You are Blue")
    expect(description).toContain("start this level primed for success")
    expect(description).toContain("opens at trailblazer before your first prediction")
    // The claim that made the first turn false: no prediction has been measured yet.
    expect(description).not.toContain("have been reaching")
  })

  it("states that trailblazer means forward deduction happened", () => {
    const description = buildAgentPersonaPrompt("Blue", "trailblazer", false)

    expect(description).toContain("You are Blue")
    expect(description).toContain("currently classifies as trailblazer")
    expect(description).toContain("have been reaching more than 1.0000 new cells for every decay unit spent")
    // The stance: keep climbing, not keep the label. Reaching trailblazer at the minimum rate and
    // then coasting is what produced observed oscillation between classes, because any rate above
    // 1.0000 reads as trailblazer.
    expect(description).toContain("Your current speed is a floor you have cleared, not a target to settle on")
    // The branch argues from what a correct batch earns, not from what a wrong one costs. A draft
    // that led with the penalty ("a guess that fails costs the partial-invalid charge", "the
    // shorter proven one is the correct answer") was withdrawn: it reads as an argument for playing
    // safe, and conservative play is exactly what cannot reach this class. The mechanism is the
    // incentive - a clean turn is charged once however far it reaches, so each further proven move
    // is a free new cell.
    expect(description).toContain("a clean turn is charged once however far it reaches")
    expect(description).toContain("carries its new cell at no extra charge")
    expect(description).toContain("Keep raising it with every batch you can prove")
    expect(description).not.toContain("it is a guess")
    expect(description).not.toContain("not a concession")
    expect(description).not.toContain("Hold that standard")
    // The toContain assertions above span the array-element boundaries on purpose. Each branch is
    // one .join(" ") over elements, so a stray "+" between two of them fuses the adjoining words
    // ("speedis a floor") - matching across the seam is what catches that.
  })

  // backtracker is below the baseline, navigator sits on it. One shared message told an agent
  // losing ground that it might simply be capped, so the two now read differently.
  it("tells a backtracker it is losing ground, not merely capped", () => {
    const description = buildAgentPersonaPrompt("Blue", "backtracker", false)

    expect(description).toContain("currently classifies as backtracker")
    expect(description).toContain("reaching fewer new cells than the decay units you spend")
    expect(description).toContain("below the 1.0000 baseline")
    expect(description).toContain("Climb back")
    // Not the navigator's message: this agent is below the baseline, not holding it.
    expect(description).not.toContain("holding the 1.0000 baseline")
  })

  // Traversal speed is first visits over decay units spent - a spend-efficiency ratio, and one that
  // says nothing authoritative about "gaining" anything. Nothing in this game credits an agent for
  // a cell: score only decays (scoring.ts subtracts units from maxScore). Every branch therefore
  // states the measured ratio and stops there, rather than describing a return.
  for (const [speedClass, isOpeningTurn] of [
    ["trailblazer", true], ["trailblazer", false], ["backtracker", false], ["navigator", false],
  ] as const) {
    it(`states ${speedClass} as spend efficiency, never as acquisition (opening: ${isOpeningTurn})`, () => {
      const description = buildAgentPersonaPrompt("Blue", speedClass, isOpeningTurn)

      // Case-insensitive: an earlier version of this guard checked lowercase "earn" and passed
      // vacuously against the branch's own capitalised "Earn it".
      const lowered = description.toLowerCase()
      // Narrow form on purpose: a bare "gain" also matches "again" elsewhere in the prompt.
      expect(lowered).not.toContain("gaining")
      expect(lowered).not.toContain("you gain")
      expect(lowered).not.toContain("is worth")
      expect(lowered).not.toContain("earn")
    })
  }

  // The branch must not offer the maze as an explanation for sitting at the baseline. "That may be
  // the best this maze allows" did exactly that, and reads as licence to stop trying: a turn whose
  // moves all land is charged the base unit however many new cells it reached, so the rate is set
  // by how much a turn commits to, not by maze shape.
  it("tells a navigator the baseline is not the maze's ceiling", () => {
    const description = buildAgentPersonaPrompt("Blue", "navigator", false)

    expect(description).toContain("currently classifies as navigator")
    expect(description).toContain("holding the 1.0000 baseline")
    expect(description).toContain("Nothing in the maze pins you there")
    expect(description).toContain("charged one unit whether it reached one new cell or several")
    expect(description).toContain("a forced retreat can be batched into a single turn")
    expect(description).toContain("Raise the rate by batching longer predictions into unvisited cells")
    // The qualifier is what stops "batch longer" from reading as "batch further than you can
    // verify". An unproven extra move that hits a wall takes the partial-invalid penalty, which
    // lowers the very rate this branch is telling the agent to raise.
    expect(description).toContain("as far as you can prove the moves will apply")
    expect(description).not.toContain("may be the best")
    expect(description).not.toContain("this maze allows")
    expect(description).not.toContain("reaching fewer new cells")
  })

  // Every branch states the threshold the same way get_prediction_rules does.
  it("expresses the baseline as 1.0000 in every branch that names it", () => {
    for (const speedClass of ["trailblazer", "backtracker", "navigator"] as const) {
      const description = buildAgentPersonaPrompt("Blue", speedClass, false)
      expect(description, speedClass).toContain("1.0000")
      expect(description, speedClass).not.toMatch(/more than one new-cell/)
    }
  })
})
