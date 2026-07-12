import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { Elements, PersistedRound, RoundState, State } from "./types"

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

function createRound(): RoundState {
  return {
    maze: [
      ["|", "---", "|"],
      ["|", "   ", "|"],
      ["|", "---", "|"],
    ],
    startPosition: [1, 1],
    finalPosition: [1, 1],
  }
}

function createHorizontalRound(): RoundState {
  return {
    maze: [
      ["|", "---", "-", "---", "|"],
      ["|", "   ", " ", "   ", "|"],
      ["|", "---", "-", "---", "|"],
    ],
    startPosition: [1, 1],
    finalPosition: [1, 3],
  }
}

function createPersistedWonRound(): PersistedRound {
  return {
    version: 1,
    level: 3,
    dims: { length: 1, width: 1 },
    maze: [
      ["|", "---", "|"],
      ["|", "   ", "|"],
      ["|", "---", "|"],
    ],
    playerPosition: [1, 1],
    finalPosition: [1, 1],
    wallWeight: 1,
    status: "won",
    score: 500,
    lastRoundScore: 500,
    remainingMs: 1000,
  }
}

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
  clearPersistedRound: ReturnType<typeof vi.fn>
  elements: Elements
  generateMaze: ReturnType<typeof vi.fn>
  getMazeDimensions: ReturnType<typeof vi.fn>
  intervalCallback: (() => void) | null
  loadPersistedSnapshot: ReturnType<typeof vi.fn>
  render: ReturnType<typeof vi.fn<(elements: Elements, state: State) => void>>
  reweightMaze: ReturnType<typeof vi.fn>
  savePersistedPreferences: ReturnType<typeof vi.fn>
  savePersistedRoundState: ReturnType<typeof vi.fn>
}

async function bootstrapHarness({
  dimensionsResults = [{ level: 1, length: 1, width: 1 }],
  isSpaceFound = () => true,
  persistedSnapshots = [
    { preferences: { level: 1, wallWeight: 1 }, round: null },
  ],
  reweightedMaze,
  round = createRound(),
  terminalSizes = [{ length: 20, width: 20 }],
}: {
  dimensionsResults?: DimensionsResult[]
  isSpaceFound?: (cell: string) => boolean
  persistedSnapshots?: Array<{
    preferences: { level: number; wallWeight: 1 | 2 | 3 }
    round: PersistedRound | null
  }>
  reweightedMaze?: string[][]
  round?: RoundState
  terminalSizes?: Array<{ length: number; width: number }>
} = {}): Promise<GameHarness> {
  const elements = createElements()
  const render = vi.fn<(elements: Elements, state: State) => void>()
  const savePersistedPreferences = vi.fn()
  const savePersistedRoundState = vi.fn()
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
    detectInputMode: vi.fn(() => "keyboard"),
    applyInputMode: vi.fn(),
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
    isSpaceFound: vi.fn(isSpaceFound),
    isWallWeight: vi.fn((value: number) => value >= 1 && value <= 3),
    nextWallWeight: vi.fn((weight: number) => (weight === 3 ? 1 : weight + 1)),
    reweightMaze,
  }))
  vi.doMock("./render", () => ({ render }))
  vi.doMock("./storage", () => ({
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

  const { bootstrapGame } = await import("./game")
  bootstrapGame()

  return {
    clearPersistedRound,
    elements,
    generateMaze,
    getMazeDimensions,
    intervalCallback,
    loadPersistedSnapshot,
    render,
    reweightMaze,
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
      detectInputMode: vi.fn(() => "keyboard"),
      applyInputMode: vi.fn(),
      getTerminalSize: vi.fn(() => ({ length: 20, width: 20 })),
    }))
    vi.doMock("./maze", () => ({
      generateMaze,
      getMazeDimensions,
      isSpaceFound: vi.fn(() => true),
      isWallWeight: vi.fn((value: number) => value >= 1 && value <= 3),
      nextWallWeight: vi.fn((weight: number) =>
        weight === 3 ? 1 : weight + 1,
      ),
      reweightMaze: vi.fn((maze: string[][]) => maze),
    }))
    vi.doMock("./render", () => ({ render }))
    vi.doMock("./storage", () => ({
      clearPersistedRound: vi.fn(),
      loadPersistedSnapshot,
      savePersistedPreferences: vi.fn(),
      savePersistedRoundState: vi.fn(),
    }))
    vi.spyOn(window, "setInterval").mockImplementation(() => 1)

    const { bootstrapGame } = await import("./game")

    bootstrapGame()

    expect(loadPersistedSnapshot).toHaveBeenCalledWith(
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
      detectInputMode: vi.fn(() => "keyboard"),
      applyInputMode: vi.fn(),
      getTerminalSize: vi.fn(() => ({ length: 20, width: 20 })),
    }))
    vi.doMock("./maze", () => ({
      generateMaze: vi.fn(() => createRound()),
      getMazeDimensions: vi.fn(() => ({
        level: 1,
        length: 1,
        width: 1,
      })),
      isSpaceFound: vi.fn(() => true),
      isWallWeight: vi.fn((value: number) => value >= 1 && value <= 3),
      nextWallWeight: vi.fn((weight: number) =>
        weight === 3 ? 1 : weight + 1,
      ),
      reweightMaze: vi.fn((maze: string[][]) => maze),
    }))
    vi.doMock("./render", () => ({ render }))
    vi.doMock("./storage", () => ({
      clearPersistedRound: vi.fn(),
      loadPersistedSnapshot: vi.fn(() => ({
        preferences: { level: 1, wallWeight: 1 },
        round: null,
      })),
      savePersistedPreferences: vi.fn(),
      savePersistedRoundState: vi.fn(),
    }))
    vi.spyOn(window, "setInterval").mockImplementation(() => 1)

    const { bootstrapGame } = await import("./game")

    bootstrapGame()

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
      detectInputMode: vi.fn(() => "keyboard"),
      applyInputMode: vi.fn(),
      getTerminalSize: vi.fn(() => ({ length: 20, width: 20 })),
    }))
    vi.doMock("./maze", () => ({
      generateMaze,
      getMazeDimensions,
      isSpaceFound: vi.fn(() => true),
      isWallWeight: vi.fn((value: number) => value >= 1 && value <= 3),
      nextWallWeight: vi.fn((weight: number) =>
        weight === 3 ? 1 : weight + 1,
      ),
      reweightMaze: vi.fn((maze: string[][]) => maze),
    }))
    vi.doMock("./render", () => ({ render }))
    vi.doMock("./storage", () => ({
      clearPersistedRound: vi.fn(),
      loadPersistedSnapshot,
      savePersistedPreferences: vi.fn(),
      savePersistedRoundState: vi.fn(),
    }))
    vi.spyOn(window, "setInterval").mockImplementation(() => 1)

    const { bootstrapGame } = await import("./game")

    bootstrapGame()
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
      detectInputMode: vi.fn(() => "keyboard"),
      applyInputMode: vi.fn(),
      getTerminalSize: vi.fn(() => ({ length: 20, width: 20 })),
    }))
    vi.doMock("./maze", () => ({
      generateMaze: vi.fn(() => createRound()),
      getMazeDimensions: vi.fn(() => ({ level: 1, length: 1, width: 1 })),
      isSpaceFound: vi.fn(() => true),
      isWallWeight: vi.fn((value: number) => value >= 1 && value <= 3),
      nextWallWeight: vi.fn(() => 2),
      reweightMaze,
    }))
    vi.doMock("./render", () => ({ render }))
    vi.doMock("./storage", () => ({
      clearPersistedRound: vi.fn(),
      loadPersistedSnapshot: vi.fn(() => ({
        preferences: { level: 1, wallWeight: 1 },
        round: null,
      })),
      savePersistedPreferences: vi.fn(),
      savePersistedRoundState: vi.fn(),
    }))
    vi.spyOn(window, "setInterval").mockImplementation(() => 1)

    const { bootstrapGame } = await import("./game")

    bootstrapGame()
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

  it("pauses and resumes a running round through keyboard controls", async () => {
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
    expect(state.playerPosition).toEqual([1, 3])
    expect(state.status).toBe("won")
    expect(state.lastRoundScore).toBe(200)
    expect(harness.savePersistedRoundState).toHaveBeenCalled()
  })


  it("marks the round as lost when the tick callback reaches zero remaining time", async () => {
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

  it("restores a persisted round in paused mode once the viewport fits again", async () => {
    const persistedRound: PersistedRound = {
      version: 1,
      level: 1,
      dims: { length: 2, width: 1 },
      maze: createHorizontalRound().maze,
      playerPosition: [1, 1],
      finalPosition: [1, 3],
      wallWeight: 1,
      status: "running",
      score: 200,
      lastRoundScore: 0,
      remainingMs: 1500,
    }

    const harness = await bootstrapHarness({
      dimensionsResults: [
        { level: 1, length: 2, width: 1 },
        null,
        { level: 1, length: 2, width: 1 },
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
    expect(harness.loadPersistedSnapshot).toHaveBeenCalledTimes(3)
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
})
