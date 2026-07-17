import type { GameClock } from "./clock"

// PersistedGameStatus lists only round states that are safe to restore from browser storage.
export type PersistedGameStatus =
  | "running"
  | "paused"
  | "won"
  | "lost"
  | "await-agent"

// Shared runtime types live here so rendering, control, storage, and generation stay aligned.
export type GameStatus = PersistedGameStatus | "boot" | "too-small"

// CellCoordinate represents one logical cell position using zero-based row and column indexes.
export type CellCoordinate = {
  row: number
  col: number
}

// TraversalHistoryEntry records one chronological logical-cell visit for the named player.
export type TraversalHistoryEntry = CellCoordinate & {
  playerName: string
}

// RenderGridPoint represents one drawn maze-grid point using positive x/y coordinates.
export type RenderGridPoint = {
  x: number
  y: number
}

// BaseDimensions captures a maze size without tying it to a specific level.
export type BaseDimensions = {
  length: number
  width: number
}

// LevelDimensions couples a generated maze size back to its source level.
export type LevelDimensions = BaseDimensions & {
  level: number
}

// WallWeight selects one of the supported visual wall styles.
export type WallWeight = 1 | 2 | 3

// MoveAction is the semantic movement vocabulary shared by all control modes.
export type MoveAction = "MoveUp" | "MoveDown" | "MoveLeft" | "MoveRight"

// SessionAction groups non-movement actions that affect the active game session.
export type SessionAction =
  | "pause"
  | "proceed"
  | "restart"
  | "cycle-walls"
  | "await-agent"

// Direction extends MoveAction with the neutral "none" state used during generation.
export type Direction = "none" | MoveAction

export type MazeControlModeName = "interactive" | "agent-api"

// MazeAction describes one abstract game action issued to the runtime.
export type MazeAction =
  | { type: MoveAction }
  | { type: SessionAction }

// MoveStatus keeps single-move and batch-replay outcomes in one shared vocabulary.
export type MoveStatus =
  | "applied"
  | "invalid-move"
  | "network-error"
  | "reached-target"
  | "malformed-response"

// WinSummaryPreviousComparison describes how the current win compares to the last completed attempt.
export type WinSummaryPreviousComparison = "none" | "faster" | "slower" | "matched"

// WinSummaryBestComparison describes how the current win compares to the best stored win.
export type WinSummaryBestComparison = "new-record" | "matched-best" | "behind-best"

// AgentRequestPreviousComparison compares the current agent-api win request count to the last win.
export type AgentRequestPreviousComparison = "none" | "fewer" | "more" | "matched"

// AgentRequestBestComparison compares the current agent-api win request count to the best win.
export type AgentRequestBestComparison = "new-record" | "matched-best" | "behind-best"

// CellAddress records the render-grid coordinates around a logical maze cell.
export type CellAddress = {
  __bottomCenter: RenderGridPoint
  __bottomLeft: RenderGridPoint
  __bottomRight: RenderGridPoint
  __middleCenter: RenderGridPoint
  __middleLeft: RenderGridPoint
  __middleRight: RenderGridPoint
  __topCenter: RenderGridPoint
  __topLeft: RenderGridPoint
  __topRight: RenderGridPoint
}

// CellNeighbors stores the neighboring cell numbers around one logical cell.
export type CellNeighbors = {
  __bottom: number
  __left: number
  __right: number
  __top: number
}

// NavigationProfile shapes corridor and turning behavior during maze generation.
export type NavigationProfile = {
  __softCorridorLimit: number
  __hardCorridorLimit: number
  __preferTurnPercent: number
}

// PathStep tracks one generation step and its corridor history.
export type PathStep = {
  __cellNo: number
  __moveDirection: Direction
  __corridorLength: number
}

// RoundState is the maze-generation result consumed by the game runtime.
export type RoundState = {
  maze: string[][]
  startPosition: RenderGridPoint
  finalPosition: RenderGridPoint
}

// PersistedRound captures the active or finished round state restored across reloads.
export type PersistedRound = {
  level: number
  mazeDimensions: BaseDimensions
  maze: string[][]
  startCell: CellCoordinate
  traversalHistory: TraversalHistoryEntry[]
  playerPosition: RenderGridPoint
  finalPosition: RenderGridPoint
  wallWeight: WallWeight
  status: PersistedGameStatus
  score: number
  lastRoundScore: number
  remainingMs: number
  winSummary?: string
  scoreDecayUnits?: number
  agentRequestCount?: number
}

// PersistedPreferences stores the long-lived browser preferences between rounds.
export type PersistedPreferences = {
  level: number
  wallWeight: WallWeight
  lastAttemptRetention?: number | null
  bestWinRetention?: number | null
  lastWinRequestCount?: number | null
  bestWinRequestCount?: number | null
}

// PersistedSnapshot bundles long-lived preferences with the short-lived round snapshot.
export type PersistedSnapshot = {
  preferences: PersistedPreferences
  round: PersistedRound | null
}

// AgentExpectedResponseFormat documents the one supported prediction payload shape.
export type AgentExpectedResponseFormat = {
  validPredictionFormat: {
    moves: MoveAction[]
  }
}

// AgentApiConfig stores one HTTP-controlled agent that can join the shared agent-api maze.
export type AgentApiConfig = {
  id: string
  playerName: string
  model: string
  endpoint: string
  enabled: boolean
  disabledReason?: "network-error"
  lastErrorAt?: number
}

// MazeActionState is the flattened agent-api payload that combines live maze context with replay results.
export type MazeActionState = {
  level: number
  status: GameStatus
  score: number
  model: string
  stream: false
  format: "json"
  playerName: string
  currentCell: CellCoordinate | null
  destinationCell: CellCoordinate | null
  traversalHistory: TraversalHistoryEntry[]

  prompt: string
  allowedMoves: MoveAction[]
  recommendedAvgPredictionLimit: number
  expectedResponseFormat: AgentExpectedResponseFormat

  submittedMovesPattern: string
  submittedMovesIndexBase: 0
  submittedMoves: string[]
  lastMoveStatus: MoveStatus | null
  lastValidMoveIndex: number | null
  visitedBefore?: boolean
  decayedMovesCount: number
}

// MazeActionDispatchOptions lets each dispatched command opt into feedback when it needs it.
export type MazeActionDispatchOptions = {
  wantFeedback?: boolean
  playerName: string
}

export type MazeActionDispatch = (
  action: MazeAction,
  options: MazeActionDispatchOptions,
) => MazeActionState | null

// MazeActionControl defines the production contract that each browser action-control mode implements.
export interface MazeActionControl {
  name: MazeControlModeName
  bindActionDispatch: (
    dispatch: MazeActionDispatch,
    readActionState: () => MazeActionState,
    commitAgentTurn: (decayedMovesCount: number) => MazeActionState,
  ) => void
  readLastActionState: () => MazeActionState | null
  recordActionState: (actionState: MazeActionState) => void
  clearActionState: () => void
}

// State is the browser runtime's single source of truth for one session.
export type State = {
  controlMode: MazeControlModeName
  level: number
  status: GameStatus
  canResume: boolean

  maze: string[][] | null
  mazeDimensions: BaseDimensions | null
  playerPosition: RenderGridPoint | null
  finalPosition: RenderGridPoint | null
  traversalHistory: TraversalHistoryEntry[]
  wallWeight: WallWeight

  score: number
  lastRoundScore: number
  lastAttemptRetention: number | null
  bestWinRetention: number | null
  lastWinRequestCount: number | null
  bestWinRequestCount: number | null
  winSummary: string
  scoreDecayUnits: number
  agentRequestCount: number

  clock: GameClock | null
}

// GameRuntime exposes the active mode plus a direct dispatch hook for tests and integrations.
export type GameRuntime = {
  mode: MazeControlModeName
  dispatch: MazeActionDispatch
  persistSnapshot: () => void
}

// ScreenLine is the renderer's normalized line model before HTML generation.
export type ScreenLine = {
  kind: "text" | "maze"
  text: string
  className: string
}

// Elements collects the DOM handles that power the browser terminal.
export type Elements = {
  app: HTMLElement
  body: HTMLElement
  screen: HTMLElement
  measure: HTMLElement
  controls: HTMLButtonElement[]
  touchControls: HTMLElement
  touchButtons: HTMLButtonElement[]
}

// AppConfig gathers translatable copy and shared runtime constants.
export type AppConfig = {
  chrome: {
    appName: string
    appSubtitle: string
    pageVersionTemplate: string
    contactLabel: string
  }
  pages: {
    game: {
      documentTitle: string
      description: string
      pageLabel: string
      aiAgentsLabel: string
    }
    agents: {
      documentTitle: string
      description: string
      pageLabel: string
      backToGameLabel: string
    }
  }
  messages: {
    navigation: {
      keyboard: string
      touch: string
    }
    pauseMessage: string
    successMessage: string
    successCompactMessage: string
    failedMessage: string
    failedCompactMessage: string
    proceed: {
      keyboard: string
      touch: string
    }
    agentAwaitMessage: string
    agentAwaitActionMessage: string
    tooSmallMessage: string
    tooSmallActionMessage: string
    runningStatus: {
      keyboard: string
      touch: string
    }
    highScoreTemplate: string
    winSummary: {
      noPrevious: {
        newRecord: string
        matchedBest: string
        behindBest: string
      }
      fasterPrevious: {
        newRecord: string
        matchedBest: string
        behindBest: string
      }
      slowerPrevious: {
        newRecord: string
        matchedBest: string
        behindBest: string
      }
      matchedPrevious: {
        newRecord: string
        matchedBest: string
        behindBest: string
      }
    }
    agentWinSummary: {
      noPrevious: {
        newRecord: string
        matchedBest: string
        behindBest: string
      }
      fewerPrevious: {
        newRecord: string
        matchedBest: string
        behindBest: string
      }
      morePrevious: {
        newRecord: string
        matchedBest: string
        behindBest: string
      }
      matchedPrevious: {
        newRecord: string
        matchedBest: string
        behindBest: string
      }
    }
  }
  controls: {
    touch: {
      wallsLabel: string
      pauseLabel: string
      proceedLabel: string
      resetProgressLabel: string
    }
  }
  maze: {
    playerMarker: string
    destinationMarker: string
    walls: Record<WallWeight, [string, string, string]>
    cellSpan: number
    cellPathWidth: number
    moveStep: number
    leftPadding: number
    minDimension: number
  }
  generation: {
    seed: number
    diff: number
    navigation: {
      friendlyMaxArea: number
      hardestArea: number
      friendlyProfile: NavigationProfile
      hardestProfile: NavigationProfile
    }
  }
  scoring: {
    budgetMultiplier: number
    percentScale: number
    retentionScale: number
  }
  timing: {
    refreshInterval: number
    scoreDecayRate: number
    interactiveCoreDecayIntervalPerCellMs: number
    agentApiCoreDecayIntervalPerCellMs: number
    agentApiResponseTimeoutMs: number
  }
  viewport: {
    compactWidth: number
    compactHeight: number
    terminalSampleWidth: number
    minTerminalRows: number
    minTerminalColumns: number
    terminalHeightInset: number
    terminalHeightScale: number
    terminalWidthInset: number
    terminalWidthScale: number
  }
  runtime: {
    controlModes: {
      interactive: MazeControlModeName
      agentApi: MazeControlModeName
    }
    storage: {
      version: number
      suffixes: {
        agentConfigs: string
        gameSetup: string
        winMetrics: string
      }
    }
    agentApiMistakePenaltyMoves: number
    interactivePlayerName: string
  }
}
