import type { GameClock } from "./clock"

// Shared runtime types live here so rendering, control, storage, and generation stay aligned.
export type GameStatus =
  "boot" | "running" | "paused" | "won" | "lost" | "too-small"

// CellCoordinate represents one logical cell position using zero-based row and column indexes.
export type CellCoordinate = {
  row: number
  col: number
}

// RenderGridPoint represents one drawn maze-grid point using positive x/y coordinates.
export type RenderGridPoint = {
  x: number
  y: number
}

// WallWeight selects one of the supported visual wall styles.
export type WallWeight = 1 | 2 | 3

// BaseDimensions captures a maze size without tying it to a specific level.
export type BaseDimensions = {
  length: number
  width: number
}

// LevelDimensions couples a generated maze size back to its source level.
export type LevelDimensions = BaseDimensions & {
  level: number
}

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

// MoveAction is the semantic movement vocabulary shared by all control modes.
export type MoveAction = "MoveUp" | "MoveDown" | "MoveLeft" | "MoveRight"

// SessionAction groups non-movement actions that affect the active game session.
export type SessionAction = "pause" | "proceed" | "cycle-walls" | "restart"

// Direction extends MoveAction with the neutral "none" state used during generation.
export type Direction = "none" | MoveAction

export type MazeControlModeName = "interactive" | "agent-api"

// MazeAction describes one abstract game action issued to the runtime.
export type MazeAction =
  | { type: MoveAction }
  | { type: SessionAction }

// MazeActionState reports only the last issued command plus the next response expected from the agent.
export type MazeAgentExpectedResponseType = "MoveAction"

// CommandStatus keeps command outcome states short, explicit, and easy for agents to branch on.
export type CommandStatus =
  | "invalid"
  | "applied"
  | "reached-target"

// MazeActionState reports only the last issued command plus the next response expected from the agent.
export type MazeActionState = {
  lastCommand: MazeAction
  lastCommandStatus: CommandStatus
  lastCommandMessage: string
  instruction: string
  expectedResponseType: MazeAgentExpectedResponseType
  visitedBefore?: boolean
}

// MazeAgentContext exposes the latest traversal state that an external agent uses to choose the next move.
export type MazeAgentContext = {
  currentCell: CellCoordinate | null
  destinationCell: CellCoordinate | null
  level: number
  score: number
  status: GameStatus
  traversalHistory: CellCoordinate[]
}

// MazeActionDispatchOptions lets each dispatched command opt into feedback when it needs it.
export type MazeActionDispatchOptions = {
  wantFeedback?: boolean
}

export type MazeActionDispatch = (
  action: MazeAction,
  options?: MazeActionDispatchOptions,
) => MazeActionState | null

// MazeActionControl defines the production contract that each browser action-control mode implements.
export interface MazeActionControl {
  name: MazeControlModeName
  bindActionDispatch: (
    dispatch: MazeActionDispatch,
    readAgentContext: () => MazeAgentContext,
  ) => void
  readLastActionState: () => MazeActionState | null
  recordActionState: (actionState: MazeActionState) => void
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

export type PersistedGameStatus = "running" | "paused" | "won" | "lost"

// PersistedRound captures the active or finished round state restored across reloads.
export type PersistedRound = {
  version: 1
  level: number
  dims: BaseDimensions
  maze: string[][]
  startCell: CellCoordinate
  traversalHistory: CellCoordinate[]
  playerPosition: RenderGridPoint
  finalPosition: RenderGridPoint
  wallWeight: WallWeight
  status: PersistedGameStatus
  score: number
  lastRoundScore: number
  remainingMs: number
  winSummary?: string
}

// PersistedPreferences stores the long-lived browser preferences between rounds.
export type PersistedPreferences = {
  level: number
  wallWeight: WallWeight
  lastAttemptRetention?: number | null
  bestWinRetention?: number | null
}

// PersistedSnapshot bundles long-lived preferences with the short-lived round snapshot.
export type PersistedSnapshot = {
  preferences: PersistedPreferences
  round: PersistedRound | null
}

// RoundState is the maze-generation result consumed by the game runtime.
export type RoundState = {
  maze: string[][]
  startPosition: RenderGridPoint
  finalPosition: RenderGridPoint
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

// State is the browser runtime's single source of truth for one session.
export type State = {
  controlMode: MazeControlModeName
  level: number
  dims: BaseDimensions | null
  maze: string[][] | null
  playerPosition: RenderGridPoint | null
  traversalHistory: CellCoordinate[]
  finalPosition: RenderGridPoint | null
  status: GameStatus
  score: number
  lastRoundScore: number
  lastAttemptRetention: number | null
  bestWinRetention: number | null
  winSummary: string
  canResume: boolean
  wallWeight: WallWeight
  clock: GameClock | null
}

// GameRuntime exposes the active mode plus a direct dispatch hook for tests and integrations.
export type GameRuntime = {
  mode: MazeControlModeName
  dispatch: MazeActionDispatch
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
      resetProgressLabel: string
    }
    agents: {
      documentTitle: string
      description: string
      pageLabel: string
      backToGameLabel: string
      resetProgressLabel: string
    }
  }
  messages: {
    navigation: {
      default: string
      compact: string
      touch: string
      touchCompact: string
    }
    pauseMessage: string
    successMessage: string
    successCompactMessage: string
    failedMessage: string
    failedCompactMessage: string
    proceedMessage: string
    touchProceedMessage: string
    tooSmallMessage: string
    tooSmallActionMessage: string
    statusTemplate: string
    touchStatusTemplate: string
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
  }
  controls: {
    touch: {
      wallsLabel: string
      pauseLabel: string
      proceedLabel: string
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
    agentMovePollSlackFactor: number
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
    roundStorageVersion: 1
    defaultAgentMoveEndpoint: string
    missingElementErrorTemplate: string
  }
}
