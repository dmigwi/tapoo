import type { GameClock } from "./clock"

export type GameStatus =
  "boot" | "running" | "paused" | "won" | "lost" | "too-small"

export type Position = [number, number]

export type WallWeight = 1 | 2 | 3

export type BaseDimensions = {
  length: number
  width: number
}

export type LevelDimensions = BaseDimensions & {
  level: number
}

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

export type CellNeighbors = {
  __bottom: number
  __left: number
  __right: number
  __top: number
}

export type MoveAction = "MoveUp" | "MoveDown" | "MoveLeft" | "MoveRight"

export type Direction = "none" | MoveAction

export type NavigationProfile = {
  __softCorridorLimit: number
  __hardCorridorLimit: number
  __preferTurnPercent: number
}

export type PathStep = {
  __cellNo: number
  __moveDirection: Direction
  __corridorLength: number
}

export type PersistedGameStatus = "running" | "paused" | "won" | "lost"

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
}

export type PersistedPreferences = {
  level: number
  wallWeight: WallWeight
}

export type PersistedSnapshot = {
  preferences: PersistedPreferences
  round: PersistedRound | null
}

export type RoundState = {
  maze: string[][]
  startPosition: Position
  finalPosition: Position
}

export type ScreenLine = {
  kind: "text" | "maze"
  text: string
  className: string
}

export type Elements = {
  app: HTMLElement
  body: HTMLElement
  screen: HTMLElement
  measure: HTMLElement
  controls: HTMLButtonElement[]
  touchControls: HTMLElement
  touchButtons: HTMLButtonElement[]
}

export type State = {
  level: number
  dims: BaseDimensions | null
  maze: string[][] | null
  playerPosition: Position | null
  finalPosition: Position | null
  status: GameStatus
  score: number
  lastRoundScore: number
  canResume: boolean
  wallWeight: WallWeight
  clock: GameClock | null
}

export type AppConfig = {
  // Shared page chrome.
  appName: string
  appSubtitle: string
  appControlsAriaLabel: string
  moreActionsAriaLabel: string
  footerAriaLabel: string
  pageVersionTemplate: string
  contactLabel: string
  contactAriaLabel: string

  // Game page chrome.
  gameDocumentTitle: string
  gameDescription: string
  gamePageLabel: string
  aiAgentsLabel: string
  aiAgentsPageAriaLabel: string
  resetProgressLabel: string
  resetProgressAriaLabel: string
  terminalAriaLabel: string
  touchControlsAriaLabel: string

  // AI Agents page chrome.
  agentsDocumentTitle: string
  agentsDescription: string
  agentsPageLabel: string
  agentsPageAriaLabel: string
  backToGameLabel: string
  backToGameAriaLabel: string

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

  // Touch-control labels.
  wallsTouchLabel: string
  pauseTouchLabel: string
  proceedTouchLabel: string
  touchMoveUpAriaLabel: string
  touchMoveLeftAriaLabel: string
  touchMoveRightAriaLabel: string
  touchMoveDownAriaLabel: string

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
