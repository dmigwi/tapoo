import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type {
  Elements,
  GameRuntime,
  MazeActionControl,
  PersistedPreferences,
  PersistedRound,
  RoundState,
  State,
  TraversalHistoryEntry,
} from "./types"

function visit(row: number, col: number): TraversalHistoryEntry {
  return { playerName: "Blue", row, col }
}

// createButton reproduces the control datasets used by the browser runtime.
function createButton({
  action,
  move,
  touch = false,
}: {
  action?: string
  move?: string
  touch?: boolean
}): HTMLButtonElement {
  const button = document.createElement("button")

  if (action) {
    button.dataset.action = action
  }

  if (move) {
    button.dataset.move = move
  }

  if (touch) {
    button.dataset.touchControl = "true"
  }

  return button
}

// createElements builds the minimal DOM and control shell required by runtime tests.
function createElements(): Elements {
  const app = document.createElement("div")
  app.focus = vi.fn()
  const controls = [
    createButton({ action: "restart" }),
    createButton({ action: "pause" }),
    createButton({ action: "walls" }),
    createButton({ action: "proceed" }),
  ]
  const touchButtons = [
    createButton({ action: "walls", touch: true }),
    createButton({ move: "MoveUp", touch: true }),
    createButton({ action: "proceed", touch: true }),
    createButton({ move: "MoveLeft", touch: true }),
    createButton({ move: "MoveRight", touch: true }),
    createButton({ move: "MoveDown", touch: true }),
    createButton({ action: "pause", touch: true }),
  ]

  return {
    app,
    body: document.createElement("div"),
    screen: document.createElement("div"),
    measure: document.createElement("div"),
    controls,
    touchControls: document.createElement("div"),
    touchButtons,
  }
}

// createRound returns the smallest square round used by most harness scenarios.
function createRound(): RoundState {
  return {
    maze: [
      ["|", "---", "|"],
      ["|", "   ", "|"],
      ["|", "---", "|"],
    ],
    startPosition: { x: 1, y: 1 },
    finalPosition: { x: 1, y: 1 },
  }
}

// createHorizontalRound exposes one movable corridor for command-dispatch tests.
function createHorizontalRound(): RoundState {
  return {
    maze: [
      ["|", "---", "-", "---", "|"],
      ["|", "   ", " ", "   ", "|"],
      ["|", "---", "-", "---", "|"],
    ],
    startPosition: { x: 1, y: 1 },
    finalPosition: { x: 3, y: 1 },
  }
}

// createPersistedWonRound simulates a stored win that can proceed into the next level.
function createPersistedWonRound(): PersistedRound {
  return {
    version: 3,
    level: 3,
    dims: { length: 1, width: 1 },
    maze: [
      ["|", "---", "|"],
      ["|", "   ", "|"],
      ["|", "---", "|"],
    ],
    playerPosition: { x: 1, y: 1 },
    startCell: { row: 0, col: 0 },
    traversalHistory: [visit(0, 0)],
    finalPosition: { x: 1, y: 1 },
    wallWeight: 1,
    status: "won",
    score: 500,
    lastRoundScore: 500,
    remainingMs: 1000,
    winSummary: "1.20s faster than previous (new record)",
  }
}

// latestRenderedState pulls the most recent render payload out of the mock renderer.
function latestRenderedState(
  render: ReturnType<typeof vi.fn<(elements: Elements, state: State) => void>>,
): State {
  const latestCall = render.mock.calls.at(-1)

  if (!latestCall) {
    throw new Error("expected render to be called")
  }

  return latestCall[1]
}

type DimensionsResult = {
  level: number
  length: number
  width: number
} | null

type GameHarness = {
  clearPersistedSnapshot: ReturnType<typeof vi.fn>
  clearPersistedRound: ReturnType<typeof vi.fn>
  elements: Elements
  generateMaze: ReturnType<typeof vi.fn>
  getMazeDimensions: ReturnType<typeof vi.fn>
  intervalCallback: (() => void) | null
  loadPersistedSnapshot: ReturnType<typeof vi.fn>
  mode: MazeActionControl
  render: ReturnType<typeof vi.fn<(elements: Elements, state: State) => void>>
  reweightMaze: ReturnType<typeof vi.fn>
  runtime: GameRuntime
  savePersistedPreferences: ReturnType<typeof vi.fn>
  savePersistedRoundState: ReturnType<typeof vi.fn>
}

// bootstrapHarness wires a mocked runtime so high-level browser game flows stay testable.
async function bootstrapHarness({
  dimensionsResults = [{ level: 1, length: 1, width: 1 }],
  isSpaceFound = () => true,
  persistedSnapshots = [
    { preferences: { level: 1, wallWeight: 1 }, round: null },
  ],
  reweightedMaze,
  round = createRound(),
  mode = "interactive",
  terminalSizes = [{ length: 20, width: 20 }],
}: {
  dimensionsResults?: DimensionsResult[]
  isSpaceFound?: (cell: string) => boolean
  persistedSnapshots?: Array<{
    preferences: PersistedPreferences
    round: PersistedRound | null
  }>
  reweightedMaze?: string[][]
  round?: RoundState
  mode?: "interactive" | "agent-api"
  terminalSizes?: Array<{ length: number; width: number }>
} = {}): Promise<GameHarness> {
  const elements = createElements()
  const render = vi.fn<(elements: Elements, state: State) => void>()
  const savePersistedPreferences = vi.fn()
  const savePersistedRoundState = vi.fn()
  const clearPersistedSnapshot = vi.fn()
  const clearPersistedRound = vi.fn()
  const generateMaze = vi.fn(() => round)
  const reweightMaze = vi.fn(() => reweightedMaze ?? round.maze)

  let intervalCallback: (() => void) | null = null
  let terminalSizeIndex = 0
  let snapshotIndex = 0
  let dimensionsIndex = 0

  const loadPersistedSnapshot = vi.fn(() => {
    const snapshot =
      persistedSnapshots[Math.min(snapshotIndex, persistedSnapshots.length - 1)]
    snapshotIndex += 1
    return snapshot
  })

  const getMazeDimensions = vi.fn(() => {
    const result =
      dimensionsResults[Math.min(dimensionsIndex, dimensionsResults.length - 1)]
    dimensionsIndex += 1
    return result
  })

  vi.doMock("./clock", () => {
    class MockClock {
      levelDurationMs: number
      startedAt = 0
      pausedAt = 0
      pausedDuration = 0
      elapsedValue = 0
      blinkValue = true
      remainingValue: number
      pause = vi.fn(() => {
        this.pausedAt = 1
      })
      resume = vi.fn(() => {
        this.pausedAt = 0
      })
      elapsed = vi.fn(() => this.elapsedValue)
      blink = vi.fn(() => this.blinkValue)
      remaining = vi.fn(() => this.remainingValue)

      constructor(levelDurationMs: number) {
        this.levelDurationMs = levelDurationMs
        this.remainingValue = levelDurationMs
      }
    }

    return { GameClock: MockClock }
  })

  vi.doMock("./dom", () => ({
    elements,
    getTerminalSize: vi.fn(() => {
      const size =
        terminalSizes[Math.min(terminalSizeIndex, terminalSizes.length - 1)]
      terminalSizeIndex += 1
      return size
    }),
  }))
  vi.doMock("./maze", () => ({
    generateMaze,
    getMazeDimensions,
    getNavigationProfile: vi.fn(() => ({
      __softCorridorLimit: 8,
      __hardCorridorLimit: 10,
      __preferTurnPercent: 90,
    })),
  }))
  vi.doMock("./traversal", () => ({
    isSpaceFound: vi.fn(isSpaceFound),
    isWallWeight: vi.fn((value: number) => value >= 1 && value <= 3),
    nextWallWeight: vi.fn((weight: number) => (weight === 3 ? 1 : weight + 1)),
    reweightMaze,
  }))
  vi.doMock("./render", () => ({ render }))
  vi.doMock("./storage", () => ({
    clearPersistedSnapshot,
    clearPersistedRound,
    loadPersistedSnapshot,
    savePersistedPreferences,
    savePersistedRoundState,
  }))
  vi.spyOn(window, "setInterval").mockImplementation(
    (handler: TimerHandler) => {
      if (typeof handler === "function") {
        const callback = handler as () => void
        intervalCallback = () => {
          callback()
        }
      }

      return 1
    },
  )

  const { createAgentMode } = await import("./control/agent")
  const { createInteractiveMode } = await import("./control/interactive")
  const { bootstrapGame } = await import("./game")
  const controlMode =
    mode === "agent-api" ? createAgentMode(elements) : createInteractiveMode(elements)
  const runtime = bootstrapGame(controlMode, elements)

  return {
    clearPersistedSnapshot,
    clearPersistedRound,
    elements,
    generateMaze,
    getMazeDimensions,
    intervalCallback,
    loadPersistedSnapshot,
    mode: controlMode,
    render,
    reweightMaze,
    runtime,
    savePersistedPreferences,
    savePersistedRoundState,
  }
}

describe("bootstrapGame", () => {
  beforeEach(() => {
    vi.resetModules()
    document.body.innerHTML = ""
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(window, "visualViewport")
  })

  it("starts a fresh round from persisted preferences when no round is stored", async () => {
    const elements = createElements()
    const render = vi.fn<(elements: Elements, state: State) => void>()
    const loadPersistedSnapshot = vi.fn(() => ({
      preferences: { level: 2, wallWeight: 1 },
      round: null,
    }))
    const generateMaze = vi.fn(() => createRound())
    const getMazeDimensions = vi.fn(() => ({
      level: 2,
      length: 1,
      width: 1,
    }))

    vi.doMock("./dom", () => ({
      elements,
      getTerminalSize: vi.fn(() => ({ length: 20, width: 20 })),
    }))
    vi.doMock("./maze", () => ({
      generateMaze,
      getMazeDimensions,
      getNavigationProfile: vi.fn(() => ({
        __softCorridorLimit: 8,
        __hardCorridorLimit: 10,
        __preferTurnPercent: 90,
      })),
    }))
    vi.doMock("./traversal", () => ({
      isSpaceFound: vi.fn(() => true),
      isWallWeight: vi.fn((value: number) => value >= 1 && value <= 3),
      nextWallWeight: vi.fn((weight: number) =>
        weight === 3 ? 1 : weight + 1,
      ),
      reweightMaze: vi.fn((maze: string[][]) => maze),
    }))
    vi.doMock("./render", () => ({ render }))
    vi.doMock("./storage", () => ({
      clearPersistedSnapshot: vi.fn(),
      clearPersistedRound: vi.fn(),
      loadPersistedSnapshot,
      savePersistedPreferences: vi.fn(),
      savePersistedRoundState: vi.fn(),
    }))
    vi.spyOn(window, "setInterval").mockImplementation(() => 1)

    const { createInteractiveMode } = await import("./control/interactive")
    const { bootstrapGame } = await import("./game")

    bootstrapGame(createInteractiveMode(elements), elements)

    expect(loadPersistedSnapshot).toHaveBeenCalledWith(
      "interactive",
      1,
      1,
      expect.any(Function),
    )
    expect(getMazeDimensions).toHaveBeenCalledWith(2, { length: 20, width: 20 })
    expect(generateMaze).toHaveBeenCalledWith(
      { level: 2, length: 1, width: 1 },
      1,
    )
    expect(render).toHaveBeenCalled()

    const state = latestRenderedState(render)
    expect(state.status).toBe("running")
    expect(state.level).toBe(2)
    expect(state.wallWeight).toBe(1)
    expect(state.traversalHistory).toEqual([visit(0, 0)])
  })

  it("subscribes to visual viewport resize events when available", async () => {
    const elements = createElements()
    const render = vi.fn<(elements: Elements, state: State) => void>()
    const addViewportListener = vi.fn()

    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: {
        addEventListener: addViewportListener,
      },
    })

    vi.doMock("./dom", () => ({
      elements,
      getTerminalSize: vi.fn(() => ({ length: 20, width: 20 })),
    }))
    vi.doMock("./maze", () => ({
      generateMaze: vi.fn(() => createRound()),
      getMazeDimensions: vi.fn(() => ({
        level: 1,
        length: 1,
        width: 1,
      })),
      getNavigationProfile: vi.fn(() => ({
        __softCorridorLimit: 8,
        __hardCorridorLimit: 10,
        __preferTurnPercent: 90,
      })),
    }))
    vi.doMock("./traversal", () => ({
      isSpaceFound: vi.fn(() => true),
      isWallWeight: vi.fn((value: number) => value >= 1 && value <= 3),
      nextWallWeight: vi.fn((weight: number) =>
        weight === 3 ? 1 : weight + 1,
      ),
      reweightMaze: vi.fn((maze: string[][]) => maze),
    }))
    vi.doMock("./render", () => ({ render }))
    vi.doMock("./storage", () => ({
      clearPersistedSnapshot: vi.fn(),
      clearPersistedRound: vi.fn(),
      loadPersistedSnapshot: vi.fn(() => ({
        preferences: { level: 1, wallWeight: 1 },
        round: null,
      })),
      savePersistedPreferences: vi.fn(),
      savePersistedRoundState: vi.fn(),
    }))
    vi.spyOn(window, "setInterval").mockImplementation(() => 1)

    const { createInteractiveMode } = await import("./control/interactive")
    const { bootstrapGame } = await import("./game")

    bootstrapGame(createInteractiveMode(elements), elements)

    expect(addViewportListener).toHaveBeenCalledWith(
      "resize",
      expect.any(Function),
    )
  })

  it("proceeds to the next level after a restored win when Ctrl+P is pressed", async () => {
    const elements = createElements()
    const render = vi.fn<(elements: Elements, state: State) => void>()
    const loadPersistedSnapshot = vi.fn(() => ({
      preferences: { level: 3, wallWeight: 1 },
      round: createPersistedWonRound(),
    }))
    const getMazeDimensions = vi
      .fn()
      .mockReturnValueOnce({ level: 4, length: 1, width: 1 })
    const generateMaze = vi.fn(() => createRound())

    vi.doMock("./dom", () => ({
      elements,
      getTerminalSize: vi.fn(() => ({ length: 20, width: 20 })),
    }))
    vi.doMock("./maze", () => ({
      generateMaze,
      getMazeDimensions,
      getNavigationProfile: vi.fn(() => ({
        __softCorridorLimit: 8,
        __hardCorridorLimit: 10,
        __preferTurnPercent: 90,
      })),
    }))
    vi.doMock("./traversal", () => ({
      isSpaceFound: vi.fn(() => true),
      isWallWeight: vi.fn((value: number) => value >= 1 && value <= 3),
      nextWallWeight: vi.fn((weight: number) =>
        weight === 3 ? 1 : weight + 1,
      ),
      reweightMaze: vi.fn((maze: string[][]) => maze),
    }))
    vi.doMock("./render", () => ({ render }))
    vi.doMock("./storage", () => ({
      clearPersistedSnapshot: vi.fn(),
      clearPersistedRound: vi.fn(),
      loadPersistedSnapshot,
      savePersistedPreferences: vi.fn(),
      savePersistedRoundState: vi.fn(),
    }))
    vi.spyOn(window, "setInterval").mockImplementation(() => 1)

    const { createInteractiveMode } = await import("./control/interactive")
    const { bootstrapGame } = await import("./game")

    bootstrapGame(createInteractiveMode(elements), elements)
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "p",
        ctrlKey: true,
        bubbles: true,
      }),
    )

    expect(getMazeDimensions).toHaveBeenCalledWith(4, { length: 20, width: 20 })
    expect(generateMaze).toHaveBeenCalledWith(
      { level: 4, length: 1, width: 1 },
      1,
    )
  })

  it("cycles wall weight and reweights the live maze when Ctrl+B is pressed", async () => {
    const elements = createElements()
    const render = vi.fn<(elements: Elements, state: State) => void>()
    const reweightedMaze = [
      ["╏", "╍╍╍", "╏"],
      ["╏", "   ", "╏"],
      ["╏", "╍╍╍", "╏"],
    ]
    const reweightMaze = vi.fn(() => reweightedMaze)

    vi.doMock("./dom", () => ({
      elements,
      getTerminalSize: vi.fn(() => ({ length: 20, width: 20 })),
    }))
    vi.doMock("./maze", () => ({
      generateMaze: vi.fn(() => createRound()),
      getMazeDimensions: vi.fn(() => ({ level: 1, length: 1, width: 1 })),
      getNavigationProfile: vi.fn(() => ({
        __softCorridorLimit: 8,
        __hardCorridorLimit: 10,
        __preferTurnPercent: 90,
      })),
    }))
    vi.doMock("./traversal", () => ({
      isSpaceFound: vi.fn(() => true),
      isWallWeight: vi.fn((value: number) => value >= 1 && value <= 3),
      nextWallWeight: vi.fn(() => 2),
      reweightMaze,
    }))
    vi.doMock("./render", () => ({ render }))
    vi.doMock("./storage", () => ({
      clearPersistedSnapshot: vi.fn(),
      clearPersistedRound: vi.fn(),
      loadPersistedSnapshot: vi.fn(() => ({
        preferences: { level: 1, wallWeight: 1 },
        round: null,
      })),
      savePersistedPreferences: vi.fn(),
      savePersistedRoundState: vi.fn(),
    }))
    vi.spyOn(window, "setInterval").mockImplementation(() => 1)

    const { createInteractiveMode } = await import("./control/interactive")
    const { bootstrapGame } = await import("./game")

    bootstrapGame(createInteractiveMode(elements), elements)
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "b",
        ctrlKey: true,
        bubbles: true,
      }),
    )

    expect(reweightMaze).toHaveBeenCalledWith(createRound().maze, 1)

    const state = latestRenderedState(render)
    expect(state.wallWeight).toBe(2)
    expect(state.maze).toEqual(reweightedMaze)
  })

  it("clears persisted browser state before restarting from level 1", async () => {
    const harness = await bootstrapHarness({
      persistedSnapshots: [
        {
          preferences: {
            level: 7,
            wallWeight: 3,
            lastAttemptRetention: 710000,
            bestWinRetention: 880000,
          },
          round: null,
        },
      ],
    })

    harness.elements.controls[0].click()

    expect(harness.clearPersistedSnapshot).toHaveBeenCalledTimes(1)
    expect(harness.loadPersistedSnapshot).toHaveBeenCalledTimes(1)
    expect(harness.getMazeDimensions).toHaveBeenLastCalledWith(1, {
      length: 20,
      width: 20,
    })

    const state = latestRenderedState(harness.render)
    expect(state.level).toBe(1)
    expect(state.wallWeight).toBe(1)
    expect(state.status).toBe("running")
    expect(state.lastAttemptRetention).toBeNull()
    expect(state.bestWinRetention).toBeNull()
    expect(state.lastRoundScore).toBe(0)
    expect(state.winSummary).toBe("")
  })

  it("pauses and resumes a running round through interactive controls", async () => {
    const harness = await bootstrapHarness()

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true }),
    )

    let state = latestRenderedState(harness.render)
    expect(state.status).toBe("paused")
    expect(state.canResume).toBe(true)
    expect(harness.savePersistedPreferences).toHaveBeenCalled()
    expect(harness.savePersistedRoundState).toHaveBeenCalled()

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "p",
        ctrlKey: true,
        bubbles: true,
      }),
    )

    state = latestRenderedState(harness.render)
    expect(state.status).toBe("running")
    expect(state.canResume).toBe(false)
  })

  it("moves the player to the target and persists a win", async () => {
    const harness = await bootstrapHarness({
      dimensionsResults: [{ level: 1, length: 2, width: 1 }],
      round: createHorizontalRound(),
    })

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
      }),
    )

    const state = latestRenderedState(harness.render)
    expect(state.playerPosition).toEqual({ x: 3, y: 1 })
    expect(state.traversalHistory).toEqual([
      visit(0, 0),
      visit(0, 1),
    ])
    expect(state.status).toBe("won")
    expect(state.lastRoundScore).toBe(200)
    expect(state.lastAttemptRetention).toBe(1_000_000)
    expect(state.bestWinRetention).toBe(1_000_000)
    expect(state.winSummary).toBe("New scores retention record")
    expect(harness.savePersistedRoundState).toHaveBeenCalled()
  })

  it("builds a browser win summary from persisted timing history", async () => {
    const harness = await bootstrapHarness({
      dimensionsResults: [{ level: 1, length: 2, width: 1 }],
      round: createHorizontalRound(),
      persistedSnapshots: [
        {
          preferences: {
            level: 1,
            wallWeight: 1,
            lastAttemptRetention: 0,
            bestWinRetention: 1_000_000,
          },
          round: null,
        },
      ],
    })

    const stateBeforeMove = latestRenderedState(harness.render)
    if (!stateBeforeMove.clock) {
      throw new Error("expected a running round clock before the winning move")
    }

    const clock = stateBeforeMove.clock as NonNullable<State["clock"]> & {
      elapsedValue: number
    }
    clock.elapsedValue = 800

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
      }),
    )

    const state = latestRenderedState(harness.render)
    expect(state.status).toBe("won")
    expect(state.lastAttemptRetention).toBe(600000)
    expect(state.bestWinRetention).toBe(1_000_000)
    expect(state.winSummary).toBe(
      "1.20s faster than previous (0.80s behind best)",
    )
  })

  it("does not duplicate traversal history when the player backtracks", async () => {
    const backtrackRound: RoundState = {
      maze: [
        ["|", "---", "|", "---", "|", "---", "|"],
        ["|", "   ", " ", "   ", " ", "   ", "|"],
        ["|", "---", "|", "---", "|", "---", "|"],
      ],
      startPosition: { x: 1, y: 1 },
      finalPosition: { x: 5, y: 1 },
    }

    const harness = await bootstrapHarness({
      dimensionsResults: [{ level: 1, length: 3, width: 1 }],
      round: backtrackRound,
    })

    harness.runtime.dispatch({ type: "MoveRight" })
    harness.runtime.dispatch({ type: "MoveLeft" })

    const state = latestRenderedState(harness.render)
    expect(state.playerPosition).toEqual({ x: 1, y: 1 })
    expect(state.traversalHistory).toEqual([
      visit(0, 0),
      visit(0, 1),
    ])
  })


  it("marks the round as lost when the refresh callback reaches zero remaining time", async () => {
    const harness = await bootstrapHarness({
      dimensionsResults: [{ level: 1, length: 2, width: 1 }],
      round: createHorizontalRound(),
    })

    const stateBeforeTick = latestRenderedState(harness.render)
    if (!stateBeforeTick.clock || !harness.intervalCallback) {
      throw new Error("expected running round clock and interval callback")
    }

    const clock = stateBeforeTick.clock as NonNullable<State["clock"]> & {
      elapsedValue: number
      remainingValue: number
    }

    clock.elapsedValue = 1000
    clock.remainingValue = 0

    harness.intervalCallback()

    const state = latestRenderedState(harness.render)
    expect(state.status).toBe("lost")
    expect(state.lastRoundScore).toBe(100)
    expect(state.lastAttemptRetention).toBe(0)
    expect(state.winSummary).toBe("")
    expect(harness.savePersistedRoundState).toHaveBeenCalled()
  })

  it("re-renders a running round when only the blink phase changes", async () => {
    const harness = await bootstrapHarness({
      dimensionsResults: [{ level: 1, length: 2, width: 1 }],
      round: createHorizontalRound(),
    })

    const renderCallsBeforeTick = harness.render.mock.calls.length
    const stateBeforeTick = latestRenderedState(harness.render)
    if (!stateBeforeTick.clock || !harness.intervalCallback) {
      throw new Error("expected running round clock and interval callback")
    }

    const clock = stateBeforeTick.clock as NonNullable<State["clock"]> & {
      blinkValue: boolean
      elapsedValue: number
      remainingValue: number
    }

    clock.elapsedValue = 0
    clock.remainingValue = 2_000
    clock.blinkValue = false

    harness.intervalCallback()

    expect(harness.render.mock.calls.length).toBe(renderCallsBeforeTick + 1)
    expect(latestRenderedState(harness.render).status).toBe("running")
  })

  it("updates the running score with sub-second precision on refresh ticks", async () => {
    const harness = await bootstrapHarness({
      dimensionsResults: [{ level: 1, length: 2, width: 1 }],
      round: createHorizontalRound(),
    })

    const stateBeforeTick = latestRenderedState(harness.render)
    if (!stateBeforeTick.clock || !harness.intervalCallback) {
      throw new Error("expected running round clock and interval callback")
    }

    const clock = stateBeforeTick.clock as NonNullable<State["clock"]> & {
      blinkValue: boolean
      elapsedValue: number
      remainingValue: number
    }

    clock.elapsedValue = 250
    clock.remainingValue = 1_750
    clock.blinkValue = true

    harness.intervalCallback()

    const state = latestRenderedState(harness.render)
    expect(state.status).toBe("running")
    expect(state.score).toBe(175)
  })

  it("restores a persisted round in paused mode once the viewport fits again", async () => {
    const persistedRound: PersistedRound = {
      version: 3,
      level: 1,
      dims: { length: 2, width: 1 },
      maze: createHorizontalRound().maze,
      playerPosition: { x: 1, y: 1 },
      startCell: { row: 0, col: 0 },
      traversalHistory: [visit(0, 0)],
      finalPosition: { x: 3, y: 1 },
      wallWeight: 1,
      status: "running",
      score: 200,
      lastRoundScore: 0,
      remainingMs: 1500,
      winSummary: "",
    }

    const harness = await bootstrapHarness({
      dimensionsResults: [
        null,
        null,
      ],
      round: createHorizontalRound(),
      persistedSnapshots: [
        {
          preferences: { level: 1, wallWeight: 1 },
          round: persistedRound,
        },
      ],
      terminalSizes: [
        { length: 20, width: 20 },
        { length: 1, width: 1 },
        { length: 1, width: 1 },
        { length: 20, width: 20 },
      ],
    })

    window.dispatchEvent(new Event("resize"))

    let state = latestRenderedState(harness.render)
    expect(state.status).toBe("too-small")

    window.dispatchEvent(new Event("resize"))

    state = latestRenderedState(harness.render)
    expect(state.status).toBe("paused")
    expect(state.canResume).toBe(true)
    expect(state.traversalHistory).toEqual([visit(0, 0)])
    expect(harness.loadPersistedSnapshot).toHaveBeenCalledTimes(3)
  })

  it("rejects malformed persisted traversal history and falls back to a fresh round", async () => {
    const invalidPersistedRound: PersistedRound = {
      version: 3,
      level: 2,
      dims: { length: 2, width: 1 },
      maze: createHorizontalRound().maze,
      playerPosition: { x: 3, y: 1 },
      startCell: { row: 0, col: 0 },
      traversalHistory: [visit(0, 0), visit(0, 0)],
      finalPosition: { x: 3, y: 1 },
      wallWeight: 1,
      status: "running",
      score: 200,
      lastRoundScore: 0,
      remainingMs: 1500,
      winSummary: "",
    }

    const harness = await bootstrapHarness({
      persistedSnapshots: [
        {
          preferences: { level: 2, wallWeight: 1 },
          round: invalidPersistedRound,
        },
      ],
      dimensionsResults: [{ level: 2, length: 1, width: 1 }],
    })

    const state = latestRenderedState(harness.render)
    expect(harness.clearPersistedRound).toHaveBeenCalledTimes(1)
    expect(state.status).toBe("running")
    expect(state.level).toBe(2)
    expect(state.traversalHistory).toEqual([visit(0, 0)])
  })

  it("does not auto-restart a too-small game when the viewport fits again without a persisted round", async () => {
    const harness = await bootstrapHarness({
      dimensionsResults: [
        null,
        { level: 1, length: 2, width: 1 },
      ],
      persistedSnapshots: [
        { preferences: { level: 1, wallWeight: 1 }, round: null },
      ],
      terminalSizes: [
        { length: 1, width: 1 },
        { length: 20, width: 20 },
      ],
    })

    const initialState = latestRenderedState(harness.render)
    expect(initialState.status).toBe("too-small")

    window.dispatchEvent(new Event("resize"))

    const state = latestRenderedState(harness.render)
    expect(state.status).toBe("too-small")
    expect(harness.generateMaze).not.toHaveBeenCalled()
  })

  it("handles touch controls and page lifecycle persistence", async () => {
    const harness = await bootstrapHarness({
      dimensionsResults: [{ level: 1, length: 2, width: 1 }],
      round: createHorizontalRound(),
    })

    harness.elements.touchButtons[4].click()

    const state = latestRenderedState(harness.render)
    expect(state.status).toBe("won")

    window.dispatchEvent(new Event("pagehide"))
    expect(harness.savePersistedRoundState).toHaveBeenCalled()

    harness.elements.app.click()
    const focusSpy = Reflect.get(harness.elements.app, "focus") as ReturnType<
      typeof vi.fn
    >
    expect(focusSpy).toHaveBeenCalled()
  })

  it("keeps traversal input out of local keyboard handling in agent-api mode", async () => {
    const harness = await bootstrapHarness({
      dimensionsResults: [{ level: 1, length: 2, width: 1 }],
      mode: "agent-api",
      round: createHorizontalRound(),
    })

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
      }),
    )

    let state = latestRenderedState(harness.render)
    expect(state.status).toBe("running")
    expect(state.playerPosition).toEqual({ x: 1, y: 1 })
    expect(state.controlMode).toBe("agent-api")
    expect(harness.mode.readLastActionState()).toBeNull()

    const actionState = harness.runtime.dispatch(
      { type: "MoveRight" },
      { wantFeedback: true },
    )

    state = latestRenderedState(harness.render)
    expect(state.status).toBe("won")
    expect(state.playerPosition).toEqual({ x: 3, y: 1 })
    expect(actionState).toEqual(expect.objectContaining({
      currentCell: { row: 0, col: 1 },
      destinationCell: { row: 0, col: 1 },
      traversalHistory: [visit(0, 0), visit(0, 1)],
      lastMoveStatus: "reached-target",
      visitedBefore: false,
      submittedMoves: ["0:MoveRight"],
      lastValidMoveIndex: 0,
    }))
    expect(harness.mode.readLastActionState()).toEqual(actionState)
  })

  it("keeps pause, proceed, and wall cycling human-driven in agent-api mode", async () => {
    const harness = await bootstrapHarness({
      mode: "agent-api",
    })

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true }),
    )
    let state = latestRenderedState(harness.render)
    expect(state.status).toBe("paused")
    expect(harness.mode.readLastActionState()).toBeNull()

    harness.elements.touchButtons[0].click()
    state = latestRenderedState(harness.render)
    expect(state.wallWeight).toBe(2)
    expect(harness.mode.readLastActionState()).toBeNull()

    harness.elements.touchButtons[2].click()
    state = latestRenderedState(harness.render)
    expect(state.status).toBe("running")
    expect(harness.mode.readLastActionState()).toBeNull()
  })
})
