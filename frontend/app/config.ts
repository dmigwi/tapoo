import type { AppConfig, WallWeight } from "./types"

export const CONFIG: AppConfig = {
  cellSpan: 2,
  cellPathWidth: 3,
  moveStep: 2,
  scoreMultiplier: 100,
  percentScale: 100,
  refreshInterval: 250,
  mazeLeftPadding: 3,
  seed: 100,
  diff: 10,
  maxLevel: 300,
  minMazeDimension: 5,
  terminalHeightInset: 5,
  terminalHeightScale: 4,
  terminalWidthInset: 10,
  terminalWidthScale: 2,
  navigation:
    "Use the Arrow Keys to navigate the player (in Blue). Press Ctrl+B to change walls thickness.",
  touchNavigation: "Use touch controls to move the Blue player.",
  pauseMessage: "Game paused !!!",
  successMessage:
    "Game over! Congratulations, You won by locating the target on time.",
  successCompactMessage: "Game over! You won.",
  failedMessage:
    "Game over! Ooops!!!, You failed to locate the target on time.",
  failedCompactMessage: "Game over! You lost.",
  quitMessage: "Terminal session closed. Press Restart or Enter to play again.",
  touchQuitMessage: "Session closed.",
  proceedMessage: "Press ESC or Ctrl+C to quit.  Press Ctrl+P to Proceed",
  touchProceedMessage: "Use the buttons below.",
  tooSmallMessage:
    "The viewport is too small for Tapoo. Expand the terminal to continue.",
  tooSmallCompactMessage: "Screen too small. Expand to continue.",
  statusTemplate:
    "Press Space to Pause.   Press Ctrl+B to Change Walls.   Level: {level}   Scores: {score}",
  touchStatusTemplate: "Level: {level}   Scores: {score}",
  highScoreTemplate: "Final Game Level Scores: {score}",
  playerMarker: "▓",
  destinationMarker: "█",
  walls: {
    1: ["|", "---", "-"],
    2: ["╏", "╍╍╍", "╍"],
    3: ["║", "===", "="],
  },
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
