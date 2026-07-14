import type {
  AppConfig,
  MazeControlModeName,
  NavigationProfile,
  WallWeight,
} from "./types"

// NAVIGATION_FRIENDLY_PROFILE defines the easiest corridor settings for small mazes.
const NAVIGATION_FRIENDLY_PROFILE: NavigationProfile = {
  __softCorridorLimit: 8,
  __hardCorridorLimit: 10,
  __preferTurnPercent: 90,
}

// NAVIGATION_HARDEST_PROFILE defines the tightest supported corridor settings.
const NAVIGATION_HARDEST_PROFILE: NavigationProfile = {
  __softCorridorLimit: 2,
  __hardCorridorLimit: 3,
  __preferTurnPercent: 55,
}

// CONFIG centralizes browser-facing copy together with generation and layout constants.
export const CONFIG: AppConfig = {
  // Shared branding used by both HTML pages and the footer version tag.
  chrome: {
    appName: "Tapoo",
    appSubtitle: "maze runner (hide & seek)",
    pageVersionTemplate: "v{version} © {year} Tapoo",
    contactLabel: "Contact",
  },
  // Per-page labels and metadata consumed by static page chrome.
  pages: {
    game: {
      documentTitle: "Tapoo Maze Runner | Game",
      description:
        "Tapoo maze runner hide and seek game rendered as a browser-based terminal experience.",
      pageLabel: "Game",
      aiAgentsLabel: "AI Agents",
      resetProgressLabel: "Reset Progress",
    },
    agents: {
      documentTitle: "Tapoo Maze Runner | AI Agents",
      description:
        "Tapoo maze runner played by an HTTP-driven agent with human session controls.",
      pageLabel: "AI Agents",
      backToGameLabel: "Back To Game",
      resetProgressLabel: "Reset Progress",
    },
  },
  // Runtime text shown inside the terminal view and overlay states.
  messages: {
    // Navigation hints swap between full and compact wording by viewport size.
    navigation: {
      default:
        "Use Arrow Keys to guide Blue (Player) to Red. Ctrl+B changes walls.",
      compact: "Guide Blue (Player) to Red. Ctrl+B changes walls.",
      touch: "Use touch controls to guide Blue (Player) to Red.",
      touchCompact: "Guide Blue to Red with touch controls.",
    },
    pauseMessage: "Game paused !!!",
    successMessage:
      "Game over! Congratulations, You won by locating the target on time.",
    successCompactMessage: "Game over! You won.",
    failedMessage:
      "Game over! Ooops!!!, You failed to locate the target on time.",
    failedCompactMessage: "Game over! You lost.",
    proceedMessage: "Press Enter or Ctrl+P to Proceed",
    touchProceedMessage: "Use the buttons below.",
    tooSmallMessage: "Level {level} needs more screen room!",
    tooSmallActionMessage: "Make more screen room, or use Reset Progress.",
    statusTemplate:
      "Press Space to Pause.   Press Ctrl+B to Change Walls.   Level: {level}   Scores: {score}",
    touchStatusTemplate: "Level: {level}   Scores: {score}",
    highScoreTemplate:
      "Final Level {level} Scores:  {score} ({percent}% retention)",
    // Win-summary variants are selected from game.ts after comparing retention metrics.
    winSummary: {
      noPrevious: {
        newRecord: "New scores retention record",
        matchedBest: "Matched best scores retention",
        behindBest: "{delta} behind best scores retention",
      },
      fasterPrevious: {
        newRecord: "{delta} faster than previous (new record)",
        matchedBest: "{delta} faster than previous (matched best)",
        behindBest: "{delta} faster than previous ({bestDelta} behind best)",
      },
      slowerPrevious: {
        newRecord: "{delta} slower than previous (new record)",
        matchedBest: "{delta} slower than previous (matched best)",
        behindBest: "{delta} slower than previous ({bestDelta} behind best)",
      },
      matchedPrevious: {
        newRecord: "Matched previous (new record)",
        matchedBest: "Matched previous (matched best)",
        behindBest: "Matched previous ({bestDelta} behind best)",
      },
    },
    agentWinSummary: {
      noPrevious: {
        newRecord: "New lowest request count",
        matchedBest: "Matched best request count",
        behindBest: "{delta} requests behind best",
      },
      fewerPrevious: {
        newRecord: "{delta} fewer requests than previous (new record)",
        matchedBest: "{delta} fewer requests than previous (matched best)",
        behindBest: "{delta} fewer requests than previous ({bestDelta} behind best)",
      },
      morePrevious: {
        newRecord: "{delta} more requests than previous (new record)",
        matchedBest: "{delta} more requests than previous (matched best)",
        behindBest: "{delta} more requests than previous ({bestDelta} behind best)",
      },
      matchedPrevious: {
        newRecord: "Matched previous request count (new record)",
        matchedBest: "Matched previous request count (matched best)",
        behindBest: "Matched previous request count ({bestDelta} behind best)",
      },
    },
  },
  // Touch-control labels used by the browser action pad.
  controls: {
    touch: {
      wallsLabel: "Walls",
      pauseLabel: "Pause",
      proceedLabel: "Proceed",
    },
  },
  // Maze glyphs and geometry shared by generation, traversal, and rendering.
  maze: {
    playerMarker: "▓",
    destinationMarker: "█",
    walls: {
      1: ["|", "---", "-"],
      2: ["╏", "╍╍╍", "╍"],
      3: ["║", "===", "="],
    },
    cellSpan: 2,
    cellPathWidth: 3,
    moveStep: 2,
    leftPadding: 3,
    minDimension: 5,
  },
  // Maze-generation tuning controls level growth and navigation difficulty.
  generation: {
    seed: 60,
    diff: 10,
    navigation: {
      hardestArea: 1600,
      friendlyMaxArea: 130,
      hardestProfile: NAVIGATION_HARDEST_PROFILE,
      friendlyProfile: NAVIGATION_FRIENDLY_PROFILE,
    },
  },
  // Score math controls maximum round score and retained-score percentages.
  scoring: {
    percentScale: 100,
    budgetMultiplier: 100,
    retentionScale: 1_000_000,
  },
  // Timing values drive refresh cadence, score decay, and the slower agent-api pacing.
  timing: {
    refreshInterval: 250,
    scoreDecayRate: 100,
    interactiveCoreDecayIntervalPerCellMs: 1_000, // Translates to 1s
    agentApiCoreDecayIntervalPerCellMs: 3_000,    // Translates to 3s
    agentApiResponseTimeoutMs: 180_000,           // Translates to 3min
    agentApiResponsePenaltyIntervalMs: 30_000,    // Translates to 30s
    // 1.0 matches the agent core per-cell scores decay rate. 1.2 means the agent may get polled 20%
    // slower than that rate while still having a reasonable chance to finish because winning paths
    // are usually shorter than full-maze coverage. Treat ~1.25 as the caution line, ~1.4 as mostly
    // for advanced agents, and ~1.6+ as near-breakpoint territory.
    agentMovePollSlackFactor: 1.2,
  },
  // Viewport thresholds translate measured DOM space into logical maze room.
  viewport: {
    compactWidth: 540,
    compactHeight: 520,
    terminalSampleWidth: 10,
    minTerminalRows: 20,
    minTerminalColumns: 48,
    terminalHeightInset: 5,
    terminalHeightScale: 4,
    terminalWidthInset: 10,
    terminalWidthScale: 2,
  },
  // Runtime settings back persistence validation and agent-mode bootstrapping.
  runtime: {
    roundStorageVersion: 2,
    defaultAgentMoveEndpoint: "/api/agent/move",
    missingElementErrorTemplate: "missing required element: {id}",
    agentApiMistakePenaltyMoves: 5,
  },
}

// WALL_WEIGHTS keeps wall-style iteration ordered and type-safe for traversal helpers.
export const WALL_WEIGHTS = Object.keys(CONFIG.maze.walls)
  .map((weight) => Number(weight))
  .sort((left, right) => left - right) as WallWeight[]

// coreDecayIntervalPerCellMs returns the per-cell score-decay interval for one browser control mode.
export function coreDecayIntervalPerCellMs(
  modeName: MazeControlModeName,
): number {
  return modeName === "agent-api"
    ? CONFIG.timing.agentApiCoreDecayIntervalPerCellMs
    : CONFIG.timing.interactiveCoreDecayIntervalPerCellMs
}

// These storage keys keep browser persistence stable across refreshes and upgrades.
export const WALL_WEIGHT_STORAGE_KEY = "tapoo.wallWeight"
export const LEVEL_STORAGE_KEY = "tapoo.level"
export const LAST_ATTEMPT_RETENTION_STORAGE_KEY = "tapoo.lastAttemptRetention"
export const BEST_WIN_RETENTION_STORAGE_KEY = "tapoo.bestWinRetention"
export const ROUND_STORAGE_KEY = "tapoo.round"
export const STORE_ENCODING_PREFIX = "tapoo:v2:"
export const STORE_BLEND_KEY = ["tapoo:web/vault", "key|spa.persist"].join(`  
  `)
