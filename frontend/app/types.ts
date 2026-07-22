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

// BaseDimensions captures raw length and width, including viewport or terminal room.
export type BaseDimensions = {
  length: number
  width: number
}

// MazeDimensions captures a concrete maze shape and its logical cell area.
export type MazeDimensions = BaseDimensions & {
  area: number
}

// LevelDimensions couples a generated maze size back to its source level.
export type LevelDimensions = MazeDimensions & {
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
  mazeDimensions: MazeDimensions
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

// PersistedGameSetup stores the progress fields usually loaded together before a round starts.
export type PersistedGameSetup = {
  level: number
  wallWeight: WallWeight
}

// PersistedWinMetrics stores the completed-round metrics that survive level progression.
export type PersistedWinMetrics = {
  lastAttemptRetentionUnits: number | null
  bestWinRetentionUnits: number | null
  lastWinRequestCount: number | null
  bestWinRequestCount: number | null
}

// PersistedPreferences combines setup with optional metrics because old/missing storage can lack either bucket.
export type PersistedPreferences = PersistedGameSetup & Partial<PersistedWinMetrics>

// PersistedSnapshot bundles long-lived preferences with the short-lived round snapshot.
export type PersistedSnapshot = {
  preferences: PersistedPreferences
  round: PersistedRound | null
}

// AgentExpectedResponseSchema documents the one supported prediction payload using JSON Schema.
export type AgentExpectedResponseSchema = {
  type: "object"
  additionalProperties: false
  required: ["moves"]
  properties: {
    moves: {
      type: "array"
      minItems: 1
      items: {
        type: "string"
        enum: MoveAction[]
      }
    }
  }
}

// AgentSubmittedMovesSchema documents the replay records Tapoo returns after processing moves.
export type AgentSubmittedMovesSchema = {
  type: "array"
  description: string
  items: {
    type: "string"
    pattern: string
    examples: string[]
  }
}

// AgentApiConfig stores one HTTP-controlled agent that can join the shared agent-api maze.
export type AgentApiConfig = {
  id: number
  playerName: string
  model: string
  endpoint: URL
  enabled: boolean
  disabledReason?: "network-error"
  lastErrorAt?: number
}

// AgentSeat represents one fixed roster slot; null means the seat is empty.
export type AgentSeat = {
  id: number
  agent: AgentApiConfig | null
}

// MazeActionResult stores only the previous command/replay outcome; live maze facts stay in State.
export type MazeActionResult = {
  lastPlayerName?: string
  replayStartIndex?: 0
  lastSubmittedMovesSchema?: AgentSubmittedMovesSchema
  lastSubmittedMoves?: string[]
  lastMoveStatus?: MoveStatus
  lastAppliedMoveIndex?: number | null
  visitedBefore?: boolean
  chargedMovesCount?: number
}

// MazeActionDispatchOptions lets each dispatched command opt into feedback when it needs it.
export type MazeActionDispatchOptions = {
  model?: string
  wantFeedback?: boolean
  playerName: string
}

export type MazeActionDispatch = (
  action: MazeAction,
  options: MazeActionDispatchOptions,
) => MazeActionResult | null

// MazeActionControl defines the production contract that each browser action-control mode implements.
export interface MazeActionControl {
  name: MazeControlModeName
  bindActionDispatch: (
    dispatch: MazeActionDispatch,
    readState: () => State,
    commitAgentTurn: (chargedMovesCount: number) => void,
  ) => void
  readLastActionResult: () => MazeActionResult | null
  recordActionResult: (actionResult: MazeActionResult) => void
  clearActionResult: () => void
}

// State is the browser runtime's single source of truth for one session.
export type State = {
  controlMode: MazeControlModeName
  level: number
  status: GameStatus
  canResume: boolean

  maze: string[][] | null
  mazeDimensions: MazeDimensions | null
  playerPosition: RenderGridPoint | null
  finalPosition: RenderGridPoint | null
  traversalHistory: TraversalHistoryEntry[]
  wallWeight: WallWeight

  score: number
  lastRoundScore: number
  lastAttemptRetentionUnits: number | null
  bestWinRetentionUnits: number | null
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

// TerminalElements are required on every playable page.
export type TerminalElements = {
  app: HTMLElement
  body: HTMLElement
  screen: HTMLElement
  measure: HTMLElement
  controls: HTMLButtonElement[]
  touchControls: HTMLElement
  touchButtons: HTMLButtonElement[]
}

// AgentElements are only used by the agent-api page overlays and seat roster.
export type AgentElements = {
  agentSeatRoster?: HTMLElement
  agentConfigForm?: HTMLFormElement
  agentConfigTitle?: HTMLElement
  agentConfigPlayerName?: HTMLInputElement
  agentConfigModel?: HTMLInputElement
  agentConfigEndpoint?: HTMLInputElement
  agentConfigEnabled?: HTMLInputElement
  agentConfigEnabledLabel?: HTMLElement
  agentConfigClose?: HTMLButtonElement
  agentConfigStatus?: HTMLElement
  agentDeleteDialog?: HTMLElement
  agentDeleteTitle?: HTMLElement
  agentDeleteTarget?: HTMLElement
  agentDeleteEnabled?: HTMLInputElement
  agentDeleteEnabledLabel?: HTMLElement
  agentDeleteApply?: HTMLButtonElement
  agentDeleteConfirm?: HTMLInputElement
  agentDeleteClose?: HTMLButtonElement
}

// Elements combines shared terminal handles with optional agent-api controls.
export type Elements = TerminalElements & AgentElements

// DisplayMsg stores copy variants selected by viewport room, not by input hardware.
export type DisplayMsg = {
  wide: string
  compact: string
}

// SummaryComparisonTemplates groups the best-record variants shared by win summaries.
export type SummaryComparisonTemplates = {
  newRecord: string
  matchedBest: string
  behindBest: string
}

// AppConfig gathers translatable copy and shared runtime constants.
export type AppConfig = {
  chrome: {
    appName: string
    appSubtitle: string
    pageVersionTemplate: string
    contactLabel: string
    privacyLabel: string
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
    privacy: {
      documentTitle: string
      description: string
      pageLabel: string
    }
  }
  messages: {
    navigation: {
      interactive: DisplayMsg
      agentApi: DisplayMsg
    }
    pauseMessage: string
    success: DisplayMsg
    failed: DisplayMsg
    proceed: DisplayMsg
    agentAwaitMessage: string
    agentAwaitAction: DisplayMsg
    tooSmallMessage: string
    tooSmallActionMessage: string
    runningStatus: DisplayMsg
    highScoreTemplate: string
    winSummary: {
      noPrevious: SummaryComparisonTemplates
      fasterPrevious: SummaryComparisonTemplates
      slowerPrevious: SummaryComparisonTemplates
      matchedPrevious: SummaryComparisonTemplates
    }
    agentWinSummary: {
      noPrevious: SummaryComparisonTemplates
      fewerPrevious: SummaryComparisonTemplates
      morePrevious: SummaryComparisonTemplates
      matchedPrevious: SummaryComparisonTemplates
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
  agentConfig: {
    title: string
    newAgentLabel: string
    agentEnabledLabel: string
    agentDisabledLabel: string
    maxSeats: number
    playerNameMinLength: number
    playerNameMaxLength: number
    playerNameLabel: string
    playerNamePlaceholder: string
    duplicatePlayerNameMessage: string
    playerNameLengthMessage: string
    modelLabel: string
    modelPlaceholder: string
    endpointLabel: string
    endpointPlaceholder: string
    submitLabel: string
    invalidMessage: string
    invalidEndpointMessage: string
    editTitle: string
    addSeatLabelTemplate: string
    manageSeatLabelTemplate: string
    activeSeatLabelTemplate: string
    deleteMessageTemplate: string
    updateConfirmLabel: string
  }
  maze: {
    playerMarker: string
    destinationMarker: string
    walls: Record<WallWeight, [string, string, string]>
    cellSpan: number
    cellPathWidth: number
    moveStep: number
    leftPadding: number
    minMazeSideCells: number
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
    retentionFullScaleUnits: number
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
