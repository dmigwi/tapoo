import type {
  AppConfig,
  NavigationProfile,
  WallWeight,
} from "./types"

declare const __TAPOO_BUILD_YEAR__: number

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

// VERSION_MAJOR is the semantic major version for the browser SPA runtime.
const VERSION_MAJOR = 1

// VERSION_MINOR is the semantic minor version for the browser SPA runtime.
const VERSION_MINOR = 1

// VERSION_PATCH is the semantic patch version for the browser SPA runtime.
const VERSION_PATCH = 0

// APP_VERSION is kept private because only the composed page copyright text is rendered.
const APP_VERSION = `${VERSION_MAJOR}.${VERSION_MINOR}.${VERSION_PATCH}`

// BUILD_YEAR is injected by esbuild for production and falls back only for local test imports.
const BUILD_YEAR =
  typeof __TAPOO_BUILD_YEAR__ === "number"
    ? __TAPOO_BUILD_YEAR__
    : new Date().getFullYear()

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
      compact: "Guide Blue (Player) to Red with touch controls.",
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
    agentAwaitMessage: "No enabled agent API is configured.",
    agentAwaitActionMessage: "Configure an agent. ",
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
    interactiveCoreDecayIntervalPerCellMs: 1_000, // Translates to 1sec
    agentApiCoreDecayIntervalPerCellMs: 30_000,   // Translates to 30sec
    agentApiResponseTimeoutMs: 180_000,           // Translates to 3min
  },
  // Viewport thresholds translate measured DOM space into logical maze room.
  viewport: {
    compactWidth: 540,
    compactHeight: 520,
    minTerminalRows: 20,
    minTerminalColumns: 48,
    terminalHeightInset: 5,
    terminalHeightScale: 4,
    terminalWidthInset: 10,
    terminalWidthScale: 2,
    terminalSampleWidth: 10,
  },
  // Runtime settings back persistence validation and agent-mode bootstrapping.
  runtime: {
    controlModes: {
      agentApi: "agent-api",
      interactive: "interactive",
    },
    storage: {
      version: 2,
      suffixes: {
        gameSetup: "gameSetup",
        winMetrics: "winMetrics",
        agentConfigs: "agentConfigs",
      },
    },
    interactivePlayerName: "Self",
    agentApiMistakePenaltyMoves: 5,
    missingElementErrorTemplate: "missing required element: {id}",
  },
}

// PAGE_COPYRIGHT_TEXT is the fully composed footer text shared by static browser pages.
export const PAGE_COPYRIGHT_TEXT = CONFIG.chrome.pageVersionTemplate
  .replace("{version}", APP_VERSION)
  .replace("{year}", String(BUILD_YEAR))

// WALL_WEIGHTS keeps wall-style iteration ordered and type-safe for traversal helpers.
export const WALL_WEIGHTS = Object.keys(CONFIG.maze.walls)
  .map((weight) => Number(weight))
  .sort((left, right) => left - right) as WallWeight[]

// STORE_ENCODING_PREFIX marks the storage schema version embedded in every encoded payload.
export const STORE_ENCODING_PREFIX = `tapoo:v${CONFIG.runtime.storage.version}:`
export const STORE_BLEND_KEY = ["tapoo:web/vault", "key|spa.persist"].join(`  
  `)
