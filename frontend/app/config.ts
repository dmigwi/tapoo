import type {
  AppConfig,
  NavigationProfile,
  WallWeight,
} from "./types"

declare const __TAPOO_BUILD_YEAR__: number

// NAVIGATION_FRIENDLY_PROFILE defines the easiest, least-branching settings for small mazes.
const NAVIGATION_FRIENDLY_PROFILE: NavigationProfile = {
  __maxCorridorLength: 10,
  __leastNeighborsBias: 100,
}

// NAVIGATION_HARDEST_PROFILE defines the tightest, most-branching supported profile.
const NAVIGATION_HARDEST_PROFILE: NavigationProfile = {
  __maxCorridorLength: 3,
  __leastNeighborsBias: 0,
}

// VERSION_MAJOR is the semantic major version for the browser SPA runtime.
const VERSION_MAJOR = 2

// VERSION_MINOR is the semantic minor version for the browser SPA runtime.
const VERSION_MINOR = 3

// VERSION_PATCH is the semantic patch version for the browser SPA runtime.
const VERSION_PATCH = 4

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
    prompts: {
      documentTitle: "Tapoo Maze Runner | Agent Prompts",
      description:
        "The exact system prompt, user message, tool definitions and response format Tapoo sends to a configured AI agent.",
      pageLabel: "Agent Prompts",
      backToAgentsLabel: "Back To AI Agents",
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
        compact: "Agents guide Blue to Red. Touch buttons control sessions.",
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
        "Use the right-edge agent seats dock to add/manage an agent, then press Enter to proceed.",
      compact: "Use edge seats to add/manage agents. Tap Proceed.",
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
      noPrevious: "New scores retention record",
      fasterPrevious: {
        newRecord: "{delta} faster than previous (new record)",
        matchedBest: "{delta} faster than previous (matched as best)",
        behindBest: "{delta} faster than previous ({bestDelta} behind best)",
      },
      slowerPrevious: {
        newRecord: "{delta} slower than previous (new record)",
        matchedBest: "{delta} slower than previous (matched as best)",
        behindBest: "{delta} slower than previous ({bestDelta} behind best)",
      },
      matchedPrevious: {
        newRecord: "Matched previous (new record)",
        matchedBest: "Matched previous (matched best)",
        behindBest: "Matched previous ({bestDelta} behind best)",
      },
    },
    agentWinSummary: {
      noPrevious: "new traversal speed record",
      fasterPrevious: {
        newRecord: "{delta} faster than previous (new record)",
        matchedBest: "{delta} faster than previous (matched as best)",
        behindBest: "{delta} faster than previous ({bestDelta} behind best)",
      },
      slowerPrevious: {
        newRecord: "{delta} slower than previous (new record)",
        matchedBest: "{delta} slower than previous (matched as best)",
        behindBest: "{delta} slower than previous ({bestDelta} behind best)",
      },
      matchedPrevious: {
        newRecord: "matched previous traversal speed (new record)",
        matchedBest: "matched previous traversal speed (matched as best)",
        behindBest: "matched previous traversal speed ({bestDelta} behind best)",
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
    maxSeats: 6,
    maxModelDisplayLength: 18,
    playerNameMinLength: 3,
    playerNameMaxLength: 8,
    playerNameLabel: "Player Name",
    playerNamePlaceholder: "Kora",
    modelLabel: "Model",
    modelPlaceholder: "llama3.2",
    apiLabel: "API",
    requiredFieldNote: "* Required",
    extraHeadersLabel: "Extra Headers",
    extraHeadersTooltip: 
      "Custom HTTP headers sent with every request to this agent's endpoint, e.g. anthropic-version or X-Wait-For-Model.",
    endpointLabel: "Endpoint",
    addHeaderLabel:"Add header",
    removeHeaderLabel: "Remove header",
    extraHeadersKeyPlaceholders: {
      ollama: "X-Custom-Header",
      openai: "X-Wait-For-Model",
      anthropic: "anthropic-version",
    },
    extraHeadersValuePlaceholders: {
      ollama: "value",
      openai: "true",
      anthropic: "2023-06-01",
    },
    // Ollama is listed first and is the markup's preselected <option>, so its endpoint placeholder
    // is also what the endpoint field is hydrated with on load (data-config-value in
    // terminal-section.html reads endpointPlaceholders.ollama specifically).
    providerLabels: {
      ollama: "Ollama",
      openai: "OpenAI",
      anthropic: "Anthropic",
    },
    endpointPlaceholders: {
      ollama: "http://localhost:11434/api/chat",
      openai: "http://localhost:8000/v1/chat/completions",
      anthropic: "http://localhost:8000/v1/messages",
    },
    // Same stored field, different real-world name: Anthropic calls it an API key, everyone else
    // speaking this shape calls it a bearer token. The credential itself and how it becomes a header
    // are unaffected by which label is showing.
    credentialLabels: {
      ollama: "Bearer Token",
      openai: "Bearer Token",
      anthropic: "API Key",
    },
    credentialRotationTooltip: "Once set, rotate this token/key periodically for better security!",
    reasoningEffortLabel: "Reasoning Effort",
    reasoningEffortTooltip:
      "How much internal reasoning the model does before replying. Confirm your model's own usage " +
      "guidance before choosing a level — options depend on the API: Ollama only distinguishes " +
      "on/off, Anthropic always reasons at some level.",
    // Ollama: think is a boolean, so "none" maps to false and every other level maps to true —
    // "max" is offered rather than "low"/"medium"/"high" since Ollama exposes no finer control.
    // Anthropic has no off switch: enabling extended thinking always spends some budget_tokens.
    reasoningEffortOptions: {
      ollama: ["none", "max"],
      openai: ["none", "low", "medium", "high", "max"],
      anthropic: ["low", "medium", "high", "max"],
    },
    // Defaults to each provider's own minimum rather than "max": reasoning support and quality vary
    // by model, not just by provider — e.g. Kimi K3 handles "max" well, Gemma 4 does not — so a user
    // should opt into a heavier level deliberately, based on their specific model's documented
    // guidance, rather than the form silently assuming heavy reasoning is safe for every model.
    // Anthropic has no "none" (see reasoningEffortOptions above), so its minimum is "low".
    reasoningEffortDefaults: {
      ollama: "none",
      openai: "none",
      anthropic: "low",
    },
    reasoningEffortLabels: {
      none: "None",
      low: "Low",
      medium: "Medium",
      high: "High",
      max: "Max",
    },
    echoBackReasoningLabel: "Echo Back Reasoning",
    echoBackReasoningTooltip:
      "Whether the model's reasoning content is echoed back on the next request. Confirm your " +
      "model's own multi-turn usage guidance before enabling — some reasoning models (e.g. Kimi K3) " +
      "require it echoed back every turn or they lose their analysis, others (e.g. Gemma) require it " +
      "withheld. Off by default; has no effect for Anthropic agents, which can't replay reasoning " +
      "content without its original signature.",
    echoBackReasoningOnLabel: "Reasoning will be sent back.",
    echoBackReasoningOffLabel: "Reasoning will not be sent back.",
    submitLabel: "Add Agent",
    invalidMessage: "Fill in Player Name, Model and Endpoint.",
    invalidApiMessage: "This agent's API provider is not properly configured.",
    invalidEndpointMessage:
      "Endpoint must be a full http:// or https:// URL (or host:port) including the request path.",
    invalidAnthropicCredentialsMessage: "Anthropic requires an API Key.",
    invalidExtraHeadersMessage: "One of the extra header names isn't a valid HTTP header name.",
    duplicatePlayerNameMessage: "This player name is already configured.",
    playerNameLengthMessage: "Player Name must be 3-8 characters.",
    editTitle: "Edit Agent",
    addSeatLabelTemplate: "Add agent to seat {seat}",
    manageSeatLabelTemplate: "{agent} ({model}) in seat {seat}",
    activeSeatLabelTemplate: "Player {agent} is playing in seat {seat}",
    deleteMessageTemplate: "Delete now?",
    updateConfirmLabel: "Apply Changes",
  },
  // Prompt preview copy, used only by the agent-api prompt overlay.
  promptPreview: {
    openLabel: "View Prompts",
    title: "Agent Request Prompts",
    intro:
      "Every agent request carries the messages and tool definitions below, rendered from the same builders the game itself"+
      " calls so they cannot drift apart. Tool results are omitted because they change with the live maze.",
    playerNoteTemplate:
      "Shown for placeholder player '{player}'; each configured agent sees its own name in place of it.",
    systemHeading: "System message",
    userHeading: "User message",
    toolsHeading: "Tool definitions",
    schemaHeading: "Required response format",
  },
  // Maze glyphs and geometry shared by generation, traversal, and rendering.
  maze: {
    playerMarker: "▓",
    visitedCellMarker: "░",
    destinationMarker: "█",
    walls: {
      1: ["|", "---", "-"],
      2: ["╏", "╍╍╍", "╍"],
      3: ["║", "===", "="],
    },
    wallOpening: {
      horizontal: 3, // Replaces a horizontal wall segment like "---" with 3 spaces.
      vertical: 1, // Replaces a vertical wall segment like "|" with 1 space.
    },
    renderCellStep: 2, // Distance in rendered-grid units between neighboring logical cell centers.
    leftPadding: 3, // Visual spaces added before each rendered maze row.
    minMazeSideCells: 5, // Smallest allowed logical cells per maze side.
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
    agentBaseDecayUnits: 1,               // Constant decay for a turn that applied any valid moves.
    agentPartialInvalidPenaltyDecayUnits: 1, // Added on top of the base charge when at least one move applied before an invalid move (total 2).
    agentZeroProgressPenaltyDecayUnits: 2,   // Flat charge when the very first submitted move was already invalid — no progress made.
    agentMalformedPenaltyDecayUnits: 3,      // Flat charge for a malformed/protocol-violation response — costlier than any gameplay mistake.
    traversalSpeedScaleUnits: 100, // Scales the traversal speed ratio as its display precision.
  },
  // Timing values drive refresh cadence, score decay, and the slower agent-api pacing.
  timing: {
    refreshInterval: 250,
    scoreDecayRate: 100,
    // Also sizes agent-api mode's clock, which only exists there to drive the destination blink
    // animation (see restoreClock's comment in game.ts) — agent-api score decay comes from
    // scoreDecayUnits, not this figure.
    interactiveDecayIntervalPerCellMs: 1_000, // Translates to 1sec
    // The real wall-clock delay between agent turns, throttling how often a new turn's first
    // request goes out. Set well above the old 30s decay-budget figure this replaced, to
    // pace-throttle turn volume (e.g. Hugging Face rate limits) independently of the scoring math.
    agentApiTurnPollIntervalMs: 60_000,           // Translates to 1min
    // A turn issues several provider requests in a row while servicing tool calls (see the
    // request-count derivation in agent/request.ts), with no gap between them otherwise — this is
    // the delay applied before each request after the first within one turn, so a provider's rate
    // limit sees paced traffic even from a single busy turn, not just paced turn starts.
    agentApiRequestPollIntervalMs: 5_000,           // Translates to 5sec
    // Per provider request, not per turn: a turn issues several rounds, so a whole turn can take a
    // multiple of this (see the request-count derivation in agent/request.ts). Per-request by
    // design — a provider that stops responding is caught on the first round regardless.
    agentApiResponseTimeoutMs: 300_000,           // Translates to 5min
    // Kept short deliberately: this backs the one-shot connection-error retry (see
    // requestAgentPredictionWithRetry in control/agent-api.ts) for transient connection drops/
    // resets, which either clear almost immediately or not at all — a long backoff would just make
    // the agent sit idle for a failure mode a second attempt is unlikely to fix anyway.
    agentApiConnectionErrorRetryDelayMs: 60_000,      // Translates to 1min
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
      version: 4.5,
      suffixes: {
        gameSetup: "gameSetup",
        winMetrics: "winMetrics",
        agentConfigs: "agentConfigs",
        tapooLog: "tapooLog",
      },
    },
    interactivePlayerName: "Self",
    // Ollama's num_ctx, temperature and num_predict (see requestChatTurn in agent/request.ts),
    // tuned for parseable moves over good prose.
    modelConfig: {
      // Ollama's num_ctx, sent as a fixed value on every request rather than scaled by maze area:
      // filteredTraversalHistory is capped by manhattanDistance regardless of maze size, and
      // messages is rebuilt fresh every turn rather than accumulated across a round, so per-turn
      // payload size does not grow with the maze. Ollama's own default is too small for the
      // prompt anyway, and it answers 500 rather than truncating.
      contextWindowFloor: 3000,
      // Model-facing local context radius — how far back into traversal history get_maze_structure
      // looks. Deliberately independent of suggestedMovesPerTurnRange below: one bounds what the
      // model can see, the other suggests how many moves to batch per turn, and scaling batch size
      // off the maze-area-derived navigation profile (the old behavior) coupled two unrelated
      // concerns for no real benefit.
      manhattanDistance: 4, // Simulation corridor-run distribution: p50=1, p75=2, p90=3, p95=4.
      // A static range rather than a single number that shrank with maze area: observed batching
      // accuracy drops off sharply past the 2nd predicted move, so min is the safer, lower-confidence
      // batch size (p50) and max is the more aggressive, higher-confidence one (p95) — the model
      // picks within the range based on its own confidence for the cells ahead, not a fixed count.
      suggestedMovesPerTurnRange: { min: 2, max: 4 },
      // Under Ollama's default: an unparseable reply is charged malformed-response, so format
      // compliance beats creativity.
      temperature: 0.5,
      // Shared by num_predict (Ollama, think: true) and OpenAI-compatible reasoning_effort models —
      // both count thinking tokens against this same cap rather than a separate budget (Ollama's own
      // thinking response field and usage.completion_tokens/reasoning_tokens respectively), so this
      // must stay sized well above what a compliant reply needs plus a full reasoning pass, not just
      // the reply alone.
      numPredict: 10000,
    },
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
