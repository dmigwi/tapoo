import type { AppConfig, WallWeight } from "./types";

export const CONFIG: AppConfig = {
  cellSpan: 2,
  cellPathWidth: 3,
  moveStep: 2,
  scoreMultiplier: 100,
  percentScale: 100,
  refreshInterval: 50,
  mazeLeftPadding: 3,
  seed: 100,
  diff: 10,
  maxLevel: 300,
  minMazeDimension: 5,
  terminalHeightInset: 5,
  terminalHeightScale: 4,
  terminalWidthInset: 10,
  terminalWidthScale: 2,
  intro: "You are playing the Maze runner, hide and seek game (Tapoo).",
  website: "Visit https://www.linkedin.com/in/migwi-ndungu/ to contact the developer.",
  websiteURL: "https://www.linkedin.com/in/migwi-ndungu/",
  navigation: "Use the Arrow Keys to navigate the player (in Blue). Press Ctrl+B to change walls thickness.",
  pauseMessage: "Game paused !!!",
  successMessage: "Game over! Congratulations, You won by locating the target on time.",
  failedMessage: "Game over! Ooops!!!, You failed to locate the target on time.",
  quitMessage: "Terminal session closed. Press Restart or Enter to play again.",
  proceedMessage: "Press ESC or Ctrl+C to quit.  Press Ctrl+P to Proceed",
  tooSmallMessage: "The viewport is too small for Tapoo. Expand the terminal to continue.",
  statusTemplate: "Press Space to Pause.   Press Ctrl+B to Change Walls.   Level: {level}   Scores: {score}",
  highScoreTemplate: "Final Game Level Scores: {score}",
  playerMarker: "▓",
  destinationMarker: "█",
  walls: {
    1: ["|", "---", "-"],
    2: ["╏", "╍╍╍", "╍"],
    3: ["║", "===", "="],
  },
};

export const WALL_WEIGHTS = Object.keys(CONFIG.walls)
  .map((weight) => Number(weight))
  .sort((left, right) => left - right) as WallWeight[];

export const WALL_WEIGHT_STORAGE_KEY = "tapoo.wallWeight";
export const LEVEL_STORAGE_KEY = "tapoo.level";
export const ROUND_STORAGE_KEY = "tapoo.round";
export const ROUND_STORAGE_VERSION = 1;
export const TERMINAL_SAMPLE_WIDTH = 10;
export const MIN_TERMINAL_ROWS = 20;
export const MIN_TERMINAL_COLUMNS = 48;
