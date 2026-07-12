import type { AppConfig, WallWeight } from "./types"

export const CONFIG: AppConfig = {
  // Shared page chrome.
  appName: "Tapoo",
  appSubtitle: "maze runner (hide & seek)",
  appControlsAriaLabel: "Application controls",
  moreActionsAriaLabel: "More actions",
  footerAriaLabel: "Copyright",
  pageVersionTemplate: "v{version} © {year} Tapoo",
  contactLabel: "Contact",
  contactAriaLabel: "Contact the author",

  // Game page chrome.
  gameDocumentTitle: "Tapoo Maze Runner | Game",
  gameDescription:
    "Tapoo maze runner hide and seek game rendered as a browser-based terminal experience.",
  gamePageLabel: "Game",
  aiAgentsLabel: "AI Agents",
  aiAgentsPageAriaLabel: "AI Agents page",
  resetProgressLabel: "Reset Progress",
  resetProgressAriaLabel: "Caution reset progress",
  terminalAriaLabel: "Tapoo browser terminal",
  touchControlsAriaLabel: "Touch game controls",

  // AI Agents page chrome.
  agentsDocumentTitle: "Tapoo Maze Runner | AI Agents",
  agentsDescription: "Tapoo maze runner AI agents page temporarily unavailable.",
  agentsPageLabel: "AI Agents",
  agentsPageAriaLabel: "AI Agents page temporarily unavailable",
  backToGameLabel: "Back To Game",
  backToGameAriaLabel: "Back to game",

  // Gameplay text.
  navigation:
    "Use Arrow Keys to guide Blue (Player) to Red. Ctrl+B changes walls.",
  navigationCompact: "Guide Blue (Player) to Red. Ctrl+B changes walls.",
  touchNavigation: "Use touch controls to guide Blue (Player) to Red.",
  touchNavigationCompact: "Guide Blue to Red with touch controls.",
  pauseMessage: "Game paused !!!",
  successMessage:
    "Game over! Congratulations, You won by locating the target on time.",
  successCompactMessage: "Game over! You won.",
  failedMessage:
    "Game over! Ooops!!!, You failed to locate the target on time.",
  failedCompactMessage: "Game over! You lost.",
  proceedMessage: "Press Enter or Ctrl+P to Proceed",
  touchProceedMessage: "Use the buttons below.",
  tooSmallMessage: "This maze needs more screen room!",
  tooSmallActionMessage: "Make more screen room, or use Reset Progress.",
  statusTemplate:
    "Press Space to Pause.   Press Ctrl+B to Change Walls.   Level: {level}   Scores: {score}",
  touchStatusTemplate: "Level: {level}   Scores: {score}",
  highScoreTemplate: "Final Level {level} Scores:  {score}",

  // Touch-control labels.
  wallsTouchLabel: "Walls",
  pauseTouchLabel: "Pause",
  proceedTouchLabel: "Proceed",
  touchMoveUpAriaLabel: "Move up",
  touchMoveLeftAriaLabel: "Move left",
  touchMoveRightAriaLabel: "Move right",
  touchMoveDownAriaLabel: "Move down",

  // Maze rendering.
  playerMarker: "▓",
  destinationMarker: "█",
  walls: {
    1: ["|", "---", "-"],
    2: ["╏", "╍╍╍", "╍"],
    3: ["║", "===", "="],
  },

  // Runtime and layout settings.
  cellSpan: 2,
  cellPathWidth: 3,
  moveStep: 2,
  scoreMultiplier: 100,
  percentScale: 100,
  refreshInterval: 250,
  mazeLeftPadding: 3,
  seed: 100,
  diff: 10,
  minMazeDimension: 5,
  missingElementErrorTemplate: "missing required element: {id}",
  compactViewportWidth: 540,
  compactViewportHeight: 520,
  terminalHeightInset: 5,
  terminalHeightScale: 4,
  terminalWidthInset: 10,
  terminalWidthScale: 2,
}

export const WALL_WEIGHTS = Object.keys(CONFIG.walls)
  .map((weight) => Number(weight))
  .sort((left, right) => left - right) as WallWeight[]

export const WALL_WEIGHT_STORAGE_KEY = "tapoo.wallWeight"
export const LEVEL_STORAGE_KEY = "tapoo.level"
export const ROUND_STORAGE_KEY = "tapoo.round"
export const ROUND_STORAGE_VERSION = 1
export const TERMINAL_SAMPLE_WIDTH = 10
export const MIN_TERMINAL_ROWS = 20
export const MIN_TERMINAL_COLUMNS = 48
export const STORE_ENCODING_PREFIX = "tapoo:v2:"
export const STORE_BLEND_KEY = ["tapoo:web/vault", "key|spa.persist"].join(`  
  `)
