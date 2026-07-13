import type { GameClock } from "./clock"

// Shared runtime types live here so rendering, control, storage, and generation stay aligned.
export type GameStatus =
  "boot" | "running" | "paused" | "won" | "lost" | "too-small"

// Position represents one row and column inside the rendered maze grid.
export type Position = [number, number]

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
  __bottomCenter: Position
  __bottomLeft: Position
  __bottomRight: Position
  __middleCenter: Position
  __middleLeft: Position
  __middleRight: Position
  __topCenter: Position
  __topLeft: Position
  __topRight: Position
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

// Direction extends MoveAction with the neutral "none" state used during generation.
export type Direction = "none" | MoveAction

export type MazeControlModeName = "interactive" | "agent-api"

// MazeControlCommand describes one abstract control operation issued to the runtime.
export type MazeControlCommand =
  | { type: "move"; move: MoveAction }
  | { type: "pause" }
  | { type: "proceed" }
  | { type: "cycle-walls" }
  | { type: "restart" }

// MazeControlFeedback reports the runtime result of one command back to agents.
export type MazeControlFeedback = {
  command: MazeControlCommand["type"]
  level: number
  message: string
  ok: boolean
  score: number
  status: GameStatus
  wallWeight: WallWeight
}

export type MazeControlDispatch = (command: MazeControlCommand) => void

// MazeControlMode defines the contract that each browser control mode implements.
export type MazeControlMode = {
  attach: (dispatch: MazeControlDispatch) => void
  detach: () => void
  expectsCommandFeedback: () => boolean
  getLastCommandFeedback: () => MazeControlFeedback | null
  name: MazeControlModeName
  receiveCommandFeedback: (feedback: MazeControlFeedback) => void
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
  playerPosition: Position
  finalPosition: Position
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
  startPosition: Position
  finalPosition: Position
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
  playerPosition: Position | null
  finalPosition: Position | null
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
  dispatch: MazeControlDispatch
}

// AppConfig gathers translatable copy and shared runtime constants.
export type AppConfig = {
  // Shared page chrome.
  appName: string
  appSubtitle: string
  pageVersionTemplate: string
  contactLabel: string

  // Game page chrome.
  gameDocumentTitle: string
  gameDescription: string
  gamePageLabel: string
  aiAgentsLabel: string
  resetProgressLabel: string

  // AI Agents page chrome.
  agentsDocumentTitle: string
  agentsDescription: string
  agentsPageLabel: string
  backToGameLabel: string

  // Gameplay text.
  navigation: string
  navigationCompact: string
  touchNavigation: string
  touchNavigationCompact: string
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
  winNoPrevNewRecord: string
  winNoPrevMatchedBest: string
  winNoPrevBehindBest: string
  winFasterPrevNewRecord: string
  winFasterPrevMatchedBest: string
  winFasterPrevBehindBest: string
  winSlowerPrevNewRecord: string
  winSlowerPrevMatchedBest: string
  winSlowerPrevBehindBest: string
  winMatchedPrevNewRecord: string
  winMatchedPrevBest: string
  winMatchedPrevBehindBest: string

  // Touch-control labels.
  wallsTouchLabel: string
  pauseTouchLabel: string
  proceedTouchLabel: string

  // Maze rendering.
  playerMarker: string
  destinationMarker: string
  walls: Record<WallWeight, [string, string, string]>

  // Runtime and layout settings.
  cellSpan: number
  cellPathWidth: number
  moveStep: number
  scoreMultiplier: number
  percentScale: number
  retentionScale: number
  refreshInterval: number
  navigationFriendlyMaxArea: number
  navigationHardestArea: number
  navigationFriendlyProfile: NavigationProfile
  navigationHardestProfile: NavigationProfile
  mazeLeftPadding: number
  seed: number
  diff: number
  minMazeDimension: number
  missingElementErrorTemplate: string
  compactViewportWidth: number
  compactViewportHeight: number
  terminalHeightInset: number
  terminalHeightScale: number
  terminalWidthInset: number
  terminalWidthScale: number
}
