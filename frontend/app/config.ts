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
const VERSION_MAJOR = 2

// VERSION_MINOR is the semantic minor version for the browser SPA runtime.
const VERSION_MINOR = 1

// VERSION_PATCH is the semantic patch version for the browser SPA runtime.
const VERSION_PATCH = 0

// APP_VERSION is kept private because only the composed page copyright text is rendered.
export const APP_VERSION = `${VERSION_MAJOR}.${VERSION_MINOR}.${VERSION_PATCH}`

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
    privacyLabel: "Privacy",
  },
  // Per-page labels and metadata consumed by static page chrome.
  pages: {
    game: {
      documentTitle: "Tapoo Maze Runner | Game",
      description:
        "Tapoo maze runner hide and seek game rendered as a browser-based terminal experience.",
      pageLabel: "Game",
      aiAgentsLabel: "AI Agents",
    },
    agents: {
      documentTitle: "Tapoo Maze Runner | AI Agents",
      description:
        "Tapoo maze runner played by an HTTP-driven agent with human session controls.",
      pageLabel: "AI Agents",
      backToGameLabel: "Back To Game",
    },
    privacy: {
      documentTitle: "Tapoo Maze Runner | Privacy",
      description:
        "Privacy details for Tapoo browser storage and optional AI Agent API gameplay context.",
      pageLabel: "Privacy",
    },
  },
  // Runtime text shown inside the terminal view and overlay states.
  messages: {
    // Navigation hints are view-specific so keyboard bindings never leak into compact touch views.
    navigation: {
      interactive: {
        wide:
          "Use Arrow Keys to guide Blue to Red. Ctrl+B walls, Space/Esc pauses, Enter proceeds.",
        compact: "Use touch buttons to guide Blue to Red.",
      },
      agentApi: {
        wide:
          "Agent APIs guide Blue to Red. Ctrl+B walls, Space/Esc pauses, Enter proceeds.",
        compact: "Agent APIs guide Blue to Red. Use touch buttons for session controls.",
      },
    },
    pauseMessage: "Game paused !!!",
    success: {
      wide:
        "Game over! Congratulations, You won by locating the target on time.",
      compact: "Game over! You won.",
    },
    failed: {
      wide:
        "Game over! Ooops!!!, You failed to locate the target on time.",
      compact: "Game over! You lost.",
    },
    proceed: {
      wide: "Press Enter to Proceed. Ctrl+Alt+R resets progress.",
      compact: "Use the buttons below.",
    },
    agentAwaitMessage: "No enabled agent API is configured.",
    agentAwaitAction: {
      wide:
        "Use the agent seats dock on the right edge of the screen to add/manage an agent, then press Enter to proceed.",
      compact:
        "Use the screen-edge seats dock to add/manage an agent, then tap Proceed.",
    },
    tooSmallMessage: "Level {level} needs more screen room!",
    tooSmallActionMessage: "Make more screen room, or use Reset Progress.",
    runningStatus: {
      wide:
        "Press Space/Esc to Pause.   Press Ctrl+B to Change Walls.   Level: {level}   Scores: {score}",
      compact: "Level: {level}   Scores: {score}",
    },
    highScoreTemplate:
      "Final Level {level} Scores:  {score} ({percent}% retention)",
    // Win-summary variants are selected from scoring.ts after comparing retention metrics.
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
      resetProgressLabel: "Reset Progress",
    },
  },
  // Agent configuration copy is only used by the agent-api overlay form.
  agentConfig: {
    title: "New Agent",
    newAgentLabel: "New Agent",
    agentEnabledLabel: "Agent is enabled.",
    agentDisabledLabel: "Agent is disabled.",
    maxSeats: 5,
    maxModelDisplayLength: 18,
    playerNameMinLength: 3,
    playerNameMaxLength: 8,
    playerNameLabel: "Player Name",
    playerNamePlaceholder: "Kora",
    modelLabel: "Model",
    modelPlaceholder: "llama3.2",
    endpointLabel: "Endpoint",
    submitLabel: "Add Agent",
    endpointPlaceholder: "http://localhost:11434/api/chat",
    invalidMessage: "Fill in Player Name, Model and Endpoint.",
    invalidEndpointMessage:
      "Endpoint must be an http:// or https:// URL, or host:port.",
    duplicatePlayerNameMessage: "This player name is already configured.",
    playerNameLengthMessage: "Player Name must be 3-8 characters.",
    editTitle: "Edit Agent",
    addSeatLabelTemplate: "Add agent to seat {seat}",
    manageSeatLabelTemplate: "Manage {agent} ({model}) in seat {seat}",
    activeSeatLabelTemplate: "Player {agent} is playing in seat {seat}",
    deleteMessageTemplate: "Delete now?",
    updateConfirmLabel: "Apply Changes",
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
    minMazeSideCells: 5,
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
    retentionFullScaleUnits: 1_000_000, // Represents 100% scores retention without using floating-point percentages.
    agentPenaltyDecayUnits: 2, // Penalty for any agent mistake (invalid move or malformed error).
    agentBaseDecayUnits: 1,    // Constant decay for a turn that applied any valid moves.
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
      version: 4,
      suffixes: {
        gameSetup: "gameSetup",
        winMetrics: "winMetrics",
        agentConfigs: "agentConfigs",
        tapooLog: "tapooLog",
      },
    },
    interactivePlayerName: "Self",
    modelConfig: {
      contextWindowFloor: 2500,       // Floor above Ollama's 2048 default; avoids 500 errors on long histories
      contextWindowAreaMultiplier: 5, // Tokens-per-cell scaling factor; grows context with maze area
      temperature: 0.5,               // Lower than 0.8 default; favors format-compliant over creative replies
      numPredict: 3000,               // Caps total output (thinking + content); thinking models consume ~1000-2000 tokens before emitting the JSON
    },
  },
}

// AGENT_MOVES_PER_TURN_CAP is the p95 of actual corridor run lengths measured across all levels.
export const AGENT_MOVES_PER_TURN_CAP = 4  // simulation: p50=1, p75=2, p90=3, p95=4

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
