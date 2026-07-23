import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CONFIG } from "./config"
import { isAgentApiMode } from "./status"
import type {
  AgentApiConfig,
  Elements,
  GameRuntime,
  MazeActionControl,
  MazeControlModeName,
  PersistedPreferences,
  PersistedRound,
  RoundState,
  State,
  TraversalHistoryEntry,
} from "./types"

function selfVisit(row: number, col: number): TraversalHistoryEntry {
  return { playerName: "Self", row, col }
}

function enabledAgentConfig(): AgentApiConfig {
  return {
    id: 1,
    playerName: "Blue",
    model: "llama3.2",
    endpoint: new URL("https://agents.example/blue/move"),
    enabled: true,
  }
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

// createTraversalMock keeps mocked traversal behavior aligned with the runtime helper exports.
function createTraversalMock({
  isSpaceFound = () => true,
  nextWallWeight = (weight: number) => (weight === 3 ? 1 : weight + 1),
  reweightMaze = (maze: string[][]) => maze,
}: {
  isSpaceFound?: (cell: string) => boolean
  nextWallWeight?: (weight: number) => number
  reweightMaze?: (maze: string[][]) => string[][]
} = {}) {
  const cellCoordinateFromGridPoint = ({ x, y }: { x: number; y: number }) => ({
    row: Math.floor((y - 1) / CONFIG.maze.cellSpan),
    col: Math.floor((x - 1) / CONFIG.maze.cellSpan),
  })
  const gridPointFromCellCoordinate = ({ row, col }: { row: number; col: number }) => ({
    x: col * CONFIG.maze.cellSpan + 1,
    y: row * CONFIG.maze.cellSpan + 1,
  })
  const mazeCellKey = ({ row, col }: { row: number; col: number }) => `${row}:${col}`
  const traversalHistoryIncludes = (
    traversalHistory: TraversalHistoryEntry[],
    cell: { row: number; col: number },
  ) =>
    traversalHistory.some(
      (visitedCell) => visitedCell.row === cell.row && visitedCell.col === cell.col,
    )
  const cloneCellCoordinate = ({ row, col }: { row: number; col: number }) => ({
    row,
    col,
  })
  const isCellCoordinate = (value: unknown): value is { row: number; col: number } => (
    typeof value === "object" &&
    value !== null &&
    "row" in value &&
    "col" in value &&
    typeof value.row === "number" &&
    typeof value.col === "number" &&
    Number.isInteger(value.row) &&
    Number.isInteger(value.col) &&
    value.row >= 0 &&
    value.col >= 0
  )
  const isTraversalHistoryEntry = (value: unknown): value is TraversalHistoryEntry => (
    isCellCoordinate(value) &&
    "playerName" in value &&
    typeof value.playerName === "string" &&
    value.playerName.length > 0
  )
  const isTraversableGridPoint = (
    data: string[][],
    position: { x: number; y: number },
  ) => data[position.y]?.[position.x] !== undefined && isSpaceFound(data[position.y][position.x])

  return {
    cellCoordinateFromGridPoint: vi.fn(cellCoordinateFromGridPoint),
    createMazeDimensions: vi.fn(({ length, width }: { length: number; width: number }) => ({
      length,
      width,
      area: length * width,
    })),
    cloneMazeDimensions: vi.fn(({ length, width }: { length: number; width: number }) => ({
      length,
      width,
      area: length * width,
    })),
    cloneCellCoordinate: vi.fn(cloneCellCoordinate),
    cloneMazeRows: vi.fn((mazeRows: string[][]) => mazeRows.map((row) => [...row])),
    cloneRenderGridPoint: vi.fn(({ x, y }: { x: number; y: number }) => ({ x, y })),
    cloneTraversalHistory: vi.fn((history: TraversalHistoryEntry[]) =>
      history.map(({ playerName, row, col }) => ({ playerName, row, col })),
    ),
    gridPointFromCellCoordinate: vi.fn(gridPointFromCellCoordinate),
    isMoveAction: vi.fn((action: { type: string }) =>
      ["MoveLeft", "MoveRight", "MoveUp", "MoveDown"].includes(action.type),
    ),
    isSpaceFound: vi.fn(isSpaceFound),
    isValidPersistedRound: vi.fn((snapshot: PersistedRound) => {
      if (
        snapshot.level < 1 ||
        snapshot.mazeDimensions.area !== snapshot.mazeDimensions.length * snapshot.mazeDimensions.width ||
        !isTraversableGridPoint(snapshot.maze, snapshot.playerPosition) ||
        !isTraversableGridPoint(snapshot.maze, snapshot.finalPosition) ||
        !isCellCoordinate(snapshot.startCell) ||
        snapshot.traversalHistory.length === 0
      ) {
        return false
      }

      const firstVisitedCell = snapshot.traversalHistory[0]
      if (
        !isTraversalHistoryEntry(firstVisitedCell) ||
        mazeCellKey(firstVisitedCell) !== mazeCellKey(snapshot.startCell)
      ) {
        return false
      }

      const visitedCellKeys = new Set<string>()
      return snapshot.traversalHistory.every((visitedCell) => {
        if (!isTraversalHistoryEntry(visitedCell)) {
          return false
        }

        const visitedCellKey = mazeCellKey(visitedCell)
        if (visitedCellKeys.has(visitedCellKey)) {
          return false
        }

        visitedCellKeys.add(visitedCellKey)
        return isTraversableGridPoint(snapshot.maze, gridPointFromCellCoordinate(visitedCell))
      })
    }),
    isWallWeight: vi.fn((value: number) => value >= 1 && value <= 3),
    mazeCellKey: vi.fn(mazeCellKey),
    nextWallWeight: vi.fn(nextWallWeight),
    resolvePlayerMove: vi.fn((state: State, action: string) => {
      if (
        state.status !== "running" ||
        !state.maze ||
        !state.mazeDimensions ||
        !state.playerPosition
      ) {
        return { canMove: false }
      }

      const deltas: Record<string, readonly [number, number]> = {
        MoveLeft: [0, -1],
        MoveRight: [0, 1],
        MoveUp: [-1, 0],
        MoveDown: [1, 0],
      }
      const [rowDelta, columnDelta] = deltas[action]
      const nextY = state.playerPosition.y + rowDelta * CONFIG.maze.moveStep
      const nextX = state.playerPosition.x + columnDelta * CONFIG.maze.moveStep
      const probeY = state.playerPosition.y + rowDelta
      const probeX = state.playerPosition.x + columnDelta

      if (nextY <= 0 || nextY > state.mazeDimensions.width * CONFIG.maze.cellSpan) {
        return { canMove: false }
      }

      if (nextX <= 0 || nextX > state.mazeDimensions.length * CONFIG.maze.cellSpan) {
        return { canMove: false }
      }

      if (!isSpaceFound(state.maze[probeY][probeX])) {
        return { canMove: false }
      }

      const nextCell = cellCoordinateFromGridPoint({ x: nextX, y: nextY })

      return {
        canMove: true,
        nextCell,
        nextGridPoint: { x: nextX, y: nextY },
        visitedBefore: traversalHistoryIncludes(state.traversalHistory, nextCell),
      }
    }),
    reweightMaze: vi.fn(reweightMaze),
    traversalHistoryEntry: vi.fn((cell: { row: number; col: number }, playerName: string) => ({
      ...cell,
      playerName,
    })),
    traversalHistoryIncludes: vi.fn(traversalHistoryIncludes),
    startCellFromTraversalHistory: vi.fn((history: TraversalHistoryEntry[]) => {
      const [startCell] = history
      return startCell ? cloneCellCoordinate(startCell) : null
    }),
  }
}

// createPersistedWonRound simulates a stored win that can proceed into the next level.
function createPersistedWonRound(): PersistedRound {
  return {
    level: 3,
    mazeDimensions: { length: 1, width: 1, area: 1 },
    maze: [
      ["|", "---", "|"],
      ["|", "   ", "|"],
      ["|", "---", "|"],
    ],
    playerPosition: { x: 1, y: 1 },
    startCell: { row: 0, col: 0 },
    traversalHistory: [selfVisit(0, 0)],
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
  area?: number
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
  saveGameProgress: ReturnType<typeof vi.fn>
  saveActiveRoundSnapshot: ReturnType<typeof vi.fn>
}

// bootstrapHarness wires a mocked runtime so high-level browser game flows stay testable.
async function bootstrapHarness({
  agentConfigs = [],
  dimensionsResults = [{ level: 1, length: 1, width: 1 }],
  isSpaceFound = () => true,
  persistedSnapshots = [
    { preferences: { level: 1, wallWeight: 1 }, round: null },
  ],
  reweightedMaze,
  round = createRound(),
  mode = CONFIG.runtime.controlModes.interactive,
  terminalSizes = [{ length: 20, width: 20 }],
}: {
  agentConfigs?: AgentApiConfig[]
  dimensionsResults?: DimensionsResult[]
  isSpaceFound?: (cell: string) => boolean
  persistedSnapshots?: Array<{
    preferences: PersistedPreferences
    round: PersistedRound | null
  }>
  reweightedMaze?: string[][]
  round?: RoundState
  mode?: MazeControlModeName
  terminalSizes?: Array<{ length: number; width: number }>
} = {}): Promise<GameHarness> {
  const elements = createElements()
  const render = vi.fn<(elements: Elements, state: State) => void>()
  const saveGameProgress = vi.fn()
  const saveActiveRoundSnapshot = vi.fn()
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
    return result ? { ...result, area: result.area ?? result.length * result.width } : null
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
  vi.doMock("./traversal", () => createTraversalMock({ isSpaceFound, reweightMaze }))
  vi.doMock("./render", () => ({ render }))
  vi.doMock("./storage", () => ({
    clearPersistedSnapshot,
    clearPersistedRound,
    clearStaleStorageVersions: vi.fn(),
    disableAgentApiConfigForNetworkError: vi.fn(),
    loadPersistedAgentApiConfigs: vi.fn(() => agentConfigs),
    loadPersistedSnapshot,
    saveGameProgress,
    saveActiveRoundSnapshot,
    loadTapooLog: vi.fn(() => []),
    saveTapooLog: vi.fn(),
    clearTapooLog: vi.fn(),
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
    isAgentApiMode(mode) ? createAgentMode(elements) : createInteractiveMode(elements)
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
    saveGameProgress,
    saveActiveRoundSnapshot,
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
    vi.useRealTimers()
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
    vi.doMock("./traversal", () => createTraversalMock())
    vi.doMock("./render", () => ({ render }))
    vi.doMock("./storage", () => ({
      clearPersistedSnapshot: vi.fn(),
      clearPersistedRound: vi.fn(),
      clearStaleStorageVersions: vi.fn(),
      disableAgentApiConfigForNetworkError: vi.fn(),
      loadPersistedAgentApiConfigs: vi.fn(() => []),
      loadPersistedSnapshot,
      saveGameProgress: vi.fn(),
      saveActiveRoundSnapshot: vi.fn(),
      loadTapooLog: vi.fn(() => []),
      saveTapooLog: vi.fn(),
      appendTapooLogEntry: vi.fn(),
      clearTapooLog: vi.fn(),
    }))
    vi.spyOn(window, "setInterval").mockImplementation(() => 1)

    const { createInteractiveMode } = await import("./control/interactive")
    const { bootstrapGame } = await import("./game")

    bootstrapGame(createInteractiveMode(elements), elements)

    expect(loadPersistedSnapshot).toHaveBeenCalledWith(
      CONFIG.runtime.controlModes.interactive,
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
    expect(state.traversalHistory).toEqual([selfVisit(0, 0)])
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
    vi.doMock("./traversal", () => createTraversalMock())
    vi.doMock("./render", () => ({ render }))
    vi.doMock("./storage", () => ({
      clearPersistedSnapshot: vi.fn(),
      clearPersistedRound: vi.fn(),
      clearStaleStorageVersions: vi.fn(),
      disableAgentApiConfigForNetworkError: vi.fn(),
      loadPersistedAgentApiConfigs: vi.fn(() => []),
      loadPersistedSnapshot: vi.fn(() => ({
        preferences: { level: 1, wallWeight: 1 },
        round: null,
      })),
      saveGameProgress: vi.fn(),
      saveActiveRoundSnapshot: vi.fn(),
      loadTapooLog: vi.fn(() => []),
      saveTapooLog: vi.fn(),
      appendTapooLogEntry: vi.fn(),
      clearTapooLog: vi.fn(),
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

  it("proceeds to the next level after a restored win when Enter is pressed", async () => {
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
    vi.doMock("./traversal", () => createTraversalMock())
    vi.doMock("./render", () => ({ render }))
    vi.doMock("./storage", () => ({
      clearPersistedSnapshot: vi.fn(),
      clearPersistedRound: vi.fn(),
      clearStaleStorageVersions: vi.fn(),
      disableAgentApiConfigForNetworkError: vi.fn(),
      loadPersistedAgentApiConfigs: vi.fn(() => []),
      loadPersistedSnapshot,
      saveGameProgress: vi.fn(),
      saveActiveRoundSnapshot: vi.fn(),
      loadTapooLog: vi.fn(() => []),
      saveTapooLog: vi.fn(),
      appendTapooLogEntry: vi.fn(),
      clearTapooLog: vi.fn(),
    }))
    vi.spyOn(window, "setInterval").mockImplementation(() => 1)

    const { createInteractiveMode } = await import("./control/interactive")
    const { bootstrapGame } = await import("./game")

    bootstrapGame(createInteractiveMode(elements), elements)
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
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
    vi.doMock("./traversal", () =>
      createTraversalMock({ nextWallWeight: () => 2, reweightMaze }),
    )
    vi.doMock("./render", () => ({ render }))
    vi.doMock("./storage", () => ({
      clearPersistedSnapshot: vi.fn(),
      clearPersistedRound: vi.fn(),
      clearStaleStorageVersions: vi.fn(),
      disableAgentApiConfigForNetworkError: vi.fn(),
      loadPersistedAgentApiConfigs: vi.fn(() => []),
      loadPersistedSnapshot: vi.fn(() => ({
        preferences: { level: 1, wallWeight: 1 },
        round: null,
      })),
      saveGameProgress: vi.fn(),
      saveActiveRoundSnapshot: vi.fn(),
      loadTapooLog: vi.fn(() => []),
      saveTapooLog: vi.fn(),
      appendTapooLogEntry: vi.fn(),
      clearTapooLog: vi.fn(),
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
            lastAttemptRetentionUnits: 710000,
            bestWinRetentionUnits: 880000,
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
    expect(state.lastAttemptRetentionUnits).toBeNull()
    expect(state.bestWinRetentionUnits).toBeNull()
    expect(state.lastRoundScore).toBe(0)
    expect(state.winSummary).toBe("")
  })

  it("restarts agent-api game progress without deleting configured agents", async () => {
    const harness = await bootstrapHarness({
      agentConfigs: [enabledAgentConfig()],
      dimensionsResults: [{ level: 1, length: 2, width: 1 }],
      mode: CONFIG.runtime.controlModes.agentApi,
      round: createHorizontalRound(),
    })

    const actionResult = harness.runtime.dispatch(
      { type: "MoveRight" },
      { model: "llama3.2", wantFeedback: true, playerName: "Blue" },
    )
    expect(harness.mode.readLastActionResult()).toEqual(actionResult)

    harness.elements.controls[0].click()

    expect(harness.clearPersistedSnapshot).toHaveBeenCalledTimes(1)
    expect(harness.mode.readLastActionResult()).toBeNull()

    const state = latestRenderedState(harness.render)
    expect(state.controlMode).toBe(CONFIG.runtime.controlModes.agentApi)
    expect(state.level).toBe(1)
    expect(state.status).toBe("running")
    expect(state.scoreDecayUnits).toBe(0)
    expect(state.agentRequestCount).toBe(0)
    expect(state.traversalHistory).toEqual([selfVisit(0, 0)])
  })

  it("moves agent-api games into await-agent immediately when no agents are enabled", async () => {
    const harness = await bootstrapHarness({
      mode: CONFIG.runtime.controlModes.agentApi,
    })

    const state = latestRenderedState(harness.render)
    expect(state.controlMode).toBe(CONFIG.runtime.controlModes.agentApi)
    expect(state.status).toBe("await-agent")
    expect(state.canResume).toBe(false)
  })

  it("pauses and resumes a running round through interactive controls", async () => {
    const harness = await bootstrapHarness()

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true }),
    )

    let state = latestRenderedState(harness.render)
    expect(state.status).toBe("paused")
    expect(state.canResume).toBe(true)
    expect(harness.saveGameProgress).toHaveBeenCalled()
    expect(harness.saveActiveRoundSnapshot).toHaveBeenCalled()

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
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
      selfVisit(0, 0),
      selfVisit(0, 1),
    ])
    expect(state.status).toBe("won")
    expect(state.lastRoundScore).toBe(200)
    expect(state.lastAttemptRetentionUnits).toBe(1_000_000)
    expect(state.bestWinRetentionUnits).toBe(1_000_000)
    expect(state.winSummary).toBe("New scores retention record")
    expect(harness.saveActiveRoundSnapshot).toHaveBeenCalled()
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
            lastAttemptRetentionUnits: 0,
            bestWinRetentionUnits: 1_000_000,
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
    expect(state.lastAttemptRetentionUnits).toBe(600000)
    expect(state.bestWinRetentionUnits).toBe(1_000_000)
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

    harness.runtime.dispatch({ type: "MoveRight" }, { playerName: "Self" })
    harness.runtime.dispatch({ type: "MoveLeft" }, { playerName: "Self" })

    const state = latestRenderedState(harness.render)
    expect(state.playerPosition).toEqual({ x: 1, y: 1 })
    expect(state.traversalHistory).toEqual([
      selfVisit(0, 0),
      selfVisit(0, 1),
    ])
  })


  it("marks the round as lost when the refresh callback depletes the score", async () => {
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

    clock.elapsedValue = 2000
    clock.remainingValue = 0

    harness.intervalCallback()

    const state = latestRenderedState(harness.render)
    expect(state.status).toBe("lost")
    expect(state.lastRoundScore).toBe(0)
    expect(state.lastAttemptRetentionUnits).toBe(0)
    expect(state.winSummary).toBe("")
    expect(harness.saveActiveRoundSnapshot).toHaveBeenCalled()
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

  it("redraws the current level when an alternate maze shape still fits after resize", async () => {
    const harness = await bootstrapHarness({
      dimensionsResults: [
        { level: 1, length: 4, width: 1 },
        { level: 1, length: 1, width: 4 },
      ],
      round: createHorizontalRound(),
      terminalSizes: [
        { length: 20, width: 20 },
        { length: 1, width: 20 },
        { length: 1, width: 20 },
      ],
    })

    window.dispatchEvent(new Event("resize"))

    const state = latestRenderedState(harness.render)
    expect(state.status).toBe("running")
    expect(state.level).toBe(1)
    expect(state.mazeDimensions).toEqual({ length: 1, width: 4, area: 4 })
    expect(state.traversalHistory).toEqual([selfVisit(0, 0)])
    expect(harness.generateMaze).toHaveBeenCalledTimes(2)
    expect(harness.generateMaze).toHaveBeenLastCalledWith(
      { level: 1, length: 1, width: 4, area: 4 },
      1,
    )
  })

  it("keeps the too-small flow when both maze axes exceed the resized viewport", async () => {
    const harness = await bootstrapHarness({
      dimensionsResults: [{ level: 1, length: 4, width: 4 }],
      terminalSizes: [
        { length: 20, width: 20 },
        { length: 1, width: 1 },
      ],
    })

    window.dispatchEvent(new Event("resize"))

    const state = latestRenderedState(harness.render)
    expect(state.status).toBe("too-small")
    expect(harness.getMazeDimensions).toHaveBeenCalledTimes(1)
    expect(harness.generateMaze).toHaveBeenCalledTimes(1)
  })

  it("restores a persisted round in paused mode once the viewport fits again", async () => {
    const persistedRound: PersistedRound = {
      level: 1,
      mazeDimensions: { length: 2, width: 1, area: 2 },
      maze: createHorizontalRound().maze,
      playerPosition: { x: 1, y: 1 },
      startCell: { row: 0, col: 0 },
      traversalHistory: [selfVisit(0, 0)],
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
    expect(state.traversalHistory).toEqual([selfVisit(0, 0)])
    expect(harness.loadPersistedSnapshot).toHaveBeenCalledTimes(3)
  })

  it("rejects malformed persisted traversal history and falls back to a fresh round", async () => {
    const invalidPersistedRound: PersistedRound = {
      level: 2,
      mazeDimensions: { length: 2, width: 1, area: 2 },
      maze: createHorizontalRound().maze,
      playerPosition: { x: 3, y: 1 },
      startCell: { row: 0, col: 0 },
      traversalHistory: [selfVisit(0, 0), selfVisit(0, 0)],
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
    expect(state.traversalHistory).toEqual([selfVisit(0, 0)])
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
    expect(harness.saveActiveRoundSnapshot).toHaveBeenCalled()

    harness.elements.app.click()
    const focusSpy = Reflect.get(harness.elements.app, "focus") as ReturnType<
      typeof vi.fn
    >
    expect(focusSpy).toHaveBeenCalled()
  })

  it("keeps traversal input out of local keyboard handling in agent-api mode", async () => {
    const harness = await bootstrapHarness({
      agentConfigs: [enabledAgentConfig()],
      dimensionsResults: [
        { level: 1, length: 2, width: 1 },
        { level: 2, length: 2, width: 1 },
      ],
      mode: CONFIG.runtime.controlModes.agentApi,
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
    expect(state.controlMode).toBe(CONFIG.runtime.controlModes.agentApi)
    expect(harness.mode.readLastActionResult()).toBeNull()

    const actionResult = harness.runtime.dispatch(
      { type: "MoveRight" },
      { model: "llama3.2", wantFeedback: true, playerName: "Blue" },
    )

    state = latestRenderedState(harness.render)
    expect(state.status).toBe("won")
    expect(state.playerPosition).toEqual({ x: 3, y: 1 })
    expect(actionResult).toEqual(expect.objectContaining({
      lastMoveStatus: "reached-target",
      visitedBefore: false,
      lastSubmittedMoves: ["0:MoveRight"],
      lastAppliedMoveIndex: 0,
    }))
    expect(harness.mode.readLastActionResult()).toEqual(actionResult)

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
      }),
    )

    state = latestRenderedState(harness.render)
    expect(state.status).toBe("running")
    expect(state.level).toBe(2)
    expect(state.playerPosition).toEqual({ x: 1, y: 1 })
    expect(harness.mode.readLastActionResult()).toBeNull()
  })

  it("keeps pause, proceed, and wall cycling human-driven in agent-api mode", async () => {
    const harness = await bootstrapHarness({
      agentConfigs: [enabledAgentConfig()],
      mode: CONFIG.runtime.controlModes.agentApi,
    })

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true }),
    )
    let state = latestRenderedState(harness.render)
    expect(state.status).toBe("paused")
    expect(harness.mode.readLastActionResult()).toBeNull()

    harness.elements.touchButtons[0].click()
    state = latestRenderedState(harness.render)
    expect(state.wallWeight).toBe(2)
    expect(harness.mode.readLastActionResult()).toBeNull()

    harness.elements.touchButtons[2].click()
    state = latestRenderedState(harness.render)
    expect(state.status).toBe("running")
    expect(harness.mode.readLastActionResult()).toBeNull()
  })
})
