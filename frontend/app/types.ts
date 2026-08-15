import type { GameClock } from "./clock"

// PersistedGameStatus lists only round states that are safe to restore from browser storage.
export type PersistedGameStatus =
  | "running"
  | "paused"
  | "won"
  | "lost"
  | "await-agent"

// Shared runtime types live here so rendering, control, storage, and generation stay aligned.
export type GameStatus = PersistedGameStatus | "boot" | "too-small"

// CellCoordinate represents one logical cell position using zero-based row and column indexes.
// It stays independent from RenderGridPoint because the two spaces scale differently: a single
// logical cell spans multiple rendered grid points (walls plus path), so converting between them
// requires an explicit multiply/divide by the cell span rather than a field rename.
export type CellCoordinate = {
  row: number
  col: number
}

// TraversalHistoryEntry records one chronological logical-cell visit for the named player.
export type TraversalHistoryEntry = CellCoordinate & {
  playerName: string
  openMoves: MoveAction[]
}

// RenderGridPoint represents one drawn maze-grid point using positive x/y coordinates.
// It stays independent from CellCoordinate because it addresses the rendered maze grid (walls
// and paths included), not logical cells; see CellCoordinate for why the two must not be merged.
export type RenderGridPoint = {
  x: number
  y: number
}

// BaseDimensions captures raw numCols and numRows, including viewport or terminal room.
export type BaseDimensions = {
  numCols: number
  numRows: number
}

// MazeDimensions captures a concrete maze shape and its logical cell area.
export type MazeDimensions = BaseDimensions & {
  area: number
}

// LevelDimensions couples a generated maze size back to its source level.
export type LevelDimensions = MazeDimensions & {
  level: number
}

// WallWeight selects one of the supported visual wall styles.
export type WallWeight = 1 | 2 | 3

// MoveAction is the semantic movement vocabulary shared by all control modes.
export type MoveAction = "MoveUp" | "MoveDown" | "MoveLeft" | "MoveRight"

// SessionAction groups non-movement actions that affect the active game session.
export type SessionAction =
  | "pause"
  | "proceed"
  | "restart"
  | "cycle-walls"
  | "await-agent"

// Direction extends MoveAction with the neutral "none" state used during generation.
export type Direction = "none" | MoveAction

export type MazeControlModeName = "interactive" | "agent-api"

// MazeAction describes one abstract game action issued to the runtime.
export type MazeAction =
  | { type: MoveAction }
  | { type: SessionAction }

// MoveStatus is the granular outcome of the single last move actually dispatched this turn — it
// tells the story of that one move, not the batch as a whole. See PredictionOutcomeStatus for the
// collective summary of everything a multi-move prediction attempted.
export type MoveStatus =
  | "applied"
  | "invalid-move"
  | "network-error"
  | "reached-target"
  | "malformed-response"
  | "token-limit-exhaustion"

// PredictionOutcomeStatus summarizes an entire submitted prediction as one story, distinct from
// MoveStatus's single-move granularity: all-applied (all submitted moves applied and at least one
// entered a new cell, or the target was reached), partially-applied (at least one move entered a new
// cell before an invalid move), repeat-cell-visits (the applied portion only revisited cells),
// invalid-prediction (the first submitted move was invalid), or empty-prediction (there was no usable
// prediction to replay).
export type PredictionOutcomeStatus =
  | "all-applied"        // all moves applied with new-cell progress, or the target was reached
  | "partially-applied"  // moves made new-cell progress before replay stopped at an invalid move
  | "repeat-cell-visits" // all or partially applied moves revisited cells, so traversal history did not grow
  | "invalid-prediction" // a real prediction replayed, but the first submitted move was already invalid
  | "empty-prediction"   // malformed-response, token-limit-exhaustion, or network-error meant no replay

// WinSummaryPreviousComparison describes how the current win compares to the last completed attempt.
export type WinSummaryPreviousComparison = "none" | "faster" | "slower" | "matched"

// WinSummaryBestComparison describes how the current win compares to the best stored win.
export type WinSummaryBestComparison = "new-record" | "matched-best" | "behind-best"

// AgentSpeedPreviousComparison compares the current agent-api win traversal speed to the last win.
export type AgentSpeedPreviousComparison = "none" | "faster" | "slower" | "matched"

// AgentSpeedBestComparison compares the current agent-api win traversal speed to the best win.
export type AgentSpeedBestComparison = "new-record" | "matched-best" | "behind-best"

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

// NavigationProfile shapes corridor length and branching behavior during maze generation.
export type NavigationProfile = {
  // __maxCorridorLength caps how many cells a straight run can span before being forced to bend.
  __maxCorridorLength: number
  // __leastNeighborsBias (0-100) is the percent chance, at any decision point with more than
  // one unvisited neighbor, of preferring the candidate with the fewest unvisited neighbors of
  // its own — this is what actually controls junction density. 100 minimizes branching (long,
  // predictable corridors, bounded by __maxCorridorLength); 0 restores fully random neighbor
  // selection (the original branching rate, ~10% junctions regardless of area).
  //
  // Junction density also controls how much of the maze the solution path covers, since
  // generateMaze always connects start to the single farthest cell from it (see its comment).
  // A tree's longest path is a bigger share of its cells the less it branches — near 100 the
  // maze is almost one long corridor, so the path can cover 90-100% of all cells; near 0, more
  // cells get spent on short junction side-branches instead, so the path covers less of the
  // maze. In other words: higher values make the route straighter and easier to predict from
  // any single glance, but the player has to walk more of the maze's cells to reach the goal;
  // lower values make the route harder to read at a glance, but it can be a shorter walk.
  __leastNeighborsBias: number
}

// PathStep tracks one generation step and its corridor history.
export type PathStep = {
  __cellNo: number
  __moveDirection: Direction
  __corridorLength: number
}

// RoundState is the maze-generation result consumed by the game runtime.
export type RoundState = {
  maze: string[][]
  startPosition: RenderGridPoint
  finalPosition: RenderGridPoint
}

// PersistedRound captures the active or finished round state restored across reloads.
export type PersistedRound = {
  level: number
  mazeDimensions: MazeDimensions
  maze: string[][]
  startCell: CellCoordinate
  traversalHistory: TraversalHistoryEntry[]
  startPosition: RenderGridPoint
  playerPosition: RenderGridPoint
  finalPosition: RenderGridPoint
  wallWeight: WallWeight
  status: PersistedGameStatus
  score: number
  lastRoundScore: number
  remainingMs: number
  winSummary?: string
  scoreDecayUnits?: number
  turnCount?: number
  cumulativeRoundCount?: number
}

// PersistedGameSetup stores the progress fields usually loaded together before a round starts.
export type PersistedGameSetup = {
  level: number
  wallWeight: WallWeight
}

// PersistedWinMetrics stores the completed-round metrics that survive level progression.
export type PersistedWinMetrics = {
  lastAttemptRetentionUnits: number | null
  bestWinRetentionUnits: number | null
  lastWinTraversalSpeedUnits: number | null
  bestWinTraversalSpeedUnits: number | null
}

// PersistedPreferences combines setup with optional metrics because old/missing storage can lack either bucket.
export type PersistedPreferences = PersistedGameSetup & Partial<PersistedWinMetrics>

// PersistedSnapshot bundles long-lived preferences with the short-lived round snapshot.
export type PersistedSnapshot = {
  preferences: PersistedPreferences
  round: PersistedRound | null
}

// AgentExpectedResponseSchema documents the one supported prediction payload using JSON Schema.
export type AgentExpectedResponseSchema = {
  type: "object"
  description?: string
  additionalProperties: false
  required: ["moves"]
  properties: {
    moves: {
      type: "array"
      minItems: 1
      items: {
        type: "string"
        enum: MoveAction[]
      }
    }
  }
}

// AgentSubmittedMovesSchema documents all submitted-move entries Tapoo returns after a turn.
export type AgentSubmittedMovesSchema = {
  type: "array"
  description: string
  items: {
    type: "string"
    pattern: string
    examples: string[]
  }
}

// AgentMessageRole lists the provider-neutral chat roles Tapoo needs for prediction requests.
export type AgentMessageRole = "assistant" | "tool" | "user" | "system"

// AgentToolDefinition mirrors the provider tool schema Tapoo sends with each chat request.
export type AgentToolDefinition = {
  type: "function"
  function: {
    name: string
    description: string
    parameters: {
      type: "object"
      properties: Record<string, unknown>
      required: string[]
    }
  }
}

export type AgentToolResult =
  | null
  | boolean
  | number
  | string
  | Record<string, unknown>
  | unknown[]

// AgentToolHandlers contains local Tapoo functions that satisfy model-requested tool calls.
export type AgentToolHandlers = Record<
  string,
  (args: unknown) => AgentToolResult | Promise<AgentToolResult>
>

// AgentToolCall is intentionally permissive because providers vary slightly in tool-call shape.
export type AgentToolCall = {
  id?: string
  type?: "function"
  function?: {
    index?: number
    name?: string
    arguments?: unknown
  }
}

// AgentChatMessage is the minimal chat message shape needed by the prediction request loop.
// reasoning is populated by every provider adapter (each from its own wire field name — Ollama's
// thinking, the openai adapter's reasoning_content), so request.ts never needs to know which one
// is active. Whether it gets echoed back verbatim on the next assistant message is the per-agent
// AgentApiConfig.echoBackReasoning flag's call, not automatic — model guidance conflicts: some
// reasoning models (e.g. Kimi K3) require it echoed back across a turn's tool-calling rounds or
// they lose context of analysis they already did, while others (e.g. Gemma) require it withheld.
// tokens_used is internal response metadata normalized by provider adapters — completion tokens
// only (Ollama's eval_count, OpenAI's usage.completion_tokens, Anthropic's usage.output_tokens),
// not prompt tokens. Deliberately scoped that way: it's the only figure comparable against
// CONFIG.runtime.modelConfig.numPredict (a completion-only cap sent as Ollama's num_predict /
// OpenAI's max_tokens / Anthropic's max_tokens) — a large accumulated prompt would push a
// prompt-inclusive total past numPredict on its own, so that total could never be used for the
// token-limit-exhaustion threshold check. Request serializers must remove it before sending an
// accumulated assistant message back to a model.
export type AgentChatMessage = {
  role: AgentMessageRole
  content?: string
  reasoning?: string
  tokens_used?: number
  tool_call_id?: string
  tool_name?: string
  tool_calls?: AgentToolCall[]
}

// network-error and connection-error both mean "the provider/infrastructure is at fault, not the
// model" and get identical game treatment (agent disabled, no penalty — see recordAgentNetworkError
// in control/agent-api.ts) — they're split apart only so a caller can tell them apart for retry
// eligibility. connection-error is narrow and deliberate: it is the one case request.ts's bare
// catch{} produces, meaning the connection itself failed (a reset, a dropped socket, a DNS hiccup)
// before any HTTP response arrived at all — exactly the transient case a one-shot retry can fix.
// token-limit-exhaustion identifies a model response that reached the configured token threshold
// without producing any prediction; request.ts gives it one corrective warning opportunity.
// network-error covers everything else in the bucket: a non-OK HTTP status (the provider did
// respond, just with an error — retrying a 429 immediately can make rate-limiting worse), a 200 OK
// response missing the expected message shape, a Tapoo-side tool-handler bug, or an unrecognized
// provider — none of which a blind retry is likely to fix, so none of them should be retried.
export type AgentPredictionFailureReason =
  | "caller-abort"
  | "malformed-response"
  | "token-limit-exhaustion"
  | "network-error"
  | "connection-error"

export type AgentPredictionDiagnostic = {
  message: string
  details?: Record<string, unknown>
}

export type AgentPredictionFailure = {
  ok: false
  reason: AgentPredictionFailureReason
  diagnostic?: AgentPredictionDiagnostic
}

// AgentPredictionResult is the only prediction outcome surface exposed to agent-api controls.
export type AgentPredictionResult =
  | { ok: true; moves: MoveAction[] }
  | AgentPredictionFailure

// AgentPredictionRequest lets the caller stop polling without learning HTTP/tool-call details.
export type AgentPredictionRequest = {
  abort: () => void
  isAborted: () => boolean
  promise: Promise<AgentPredictionResult>
}

// AgentApiProvider selects which wire format an agent's endpoint speaks. Always present on a live
// config — normalizeAgentApiConfig (storage.ts) defaults a persisted record lacking it to "ollama"
// rather than rejecting the record, so this being required here never risks dropping an old agent.
export type AgentApiProvider = "ollama" | "openai" | "anthropic"

// AgentReasoningEffort is a shared vocabulary across all three providers, even though each
// provider only recognizes a subset of it (agentConfig.reasoningEffortOptions, config.ts) and maps
// it onto a completely different wire mechanism: Ollama's boolean think, OpenAI-compatible's
// qualitative reasoning_effort string, Anthropic's numeric thinking.budget_tokens. Anthropic has no
// "none" — it always reasons at some level once thinking is enabled.
export type AgentReasoningEffort = "none" | "low" | "medium" | "high" | "max"

// AgentApiConfig stores one HTTP-controlled agent that can join the shared agent-api maze.
export type AgentApiConfig = {
  id: number
  playerName: string
  model: string
  endpoint: URL
  api: AgentApiProvider
  // reasoningEffort picks how hard the model reasons before replying, filtered to the options its
  // provider actually supports (agentConfig.reasoningEffortOptions). Optional here purely to avoid
  // forcing every existing AgentApiConfig test fixture to specify it — normalizeAgentApiConfig
  // (storage.ts) always coerces a persisted record to a concrete, provider-valid value, the same way
  // it already does for api, so a genuinely absent value should never reach a provider adapter.
  reasoningEffort?: AgentReasoningEffort
  // credential is one stored value behind two labels: "Bearer Token" for ollama/openai, "API Key"
  // for anthropic. The header it becomes is decided by the provider adapter, not by this field.
  credential?: string
  // extraHeaders is raw multi-line "Key: Value" user input, provider-agnostic — appended directly
  // onto every request this agent sends. Covers cases a dedicated field would need re-shipping to
  // support: anthropic-version (Anthropic's API evolves independently of Tapoo), X-Wait-For-Model
  // (Hugging Face's router, to dodge cold-start read timeouts), or anything else a given endpoint
  // needs. Parsed once by parseExtraHeaders (agent/protocol.ts) before reaching a provider adapter.
  extraHeaders?: string
  // echoBackReasoning controls whether a provider-returned reasoning is echoed back on
  // the next request's assistant message. Off by default because model guidance conflicts: some
  // reasoning models (e.g. Kimi K3) require it echoed back verbatim across a turn's tool-calling
  // rounds or they lose the analysis they already did, while others (e.g. Gemma) explicitly
  // require it withheld from multi-turn context. See the on-form tooltip that asks the user to
  // confirm their model's own guidance before turning this on.
  echoBackReasoning?: boolean
  enabled: boolean
  disabledReason?: "network-error"
  lastErrorAt?: number
  // gameLevel and cumulativeRoundCount identify the round where the counters below were last synced.
  // levelTurnCount must match State.turnCount for that round; a mismatch means the stored agent view
  // is contradictory and the agent-api runtime resets before asking any model for another prediction.
  // Level alone can't tell a retry of the same level apart from continuing it, hence cumulativeRoundCount.
  gameLevel?: number
  cumulativeRoundCount?: number
  // levelTurnCount mirrors State.turnCount (every seat gets the same value on every commit) purely
  // as the staleness signal above — it is not a per-agent count and must not be read as one.
  levelTurnCount?: number
  // turnCount is this agent's own tally of turns it has personally taken this round, incremented
  // only when this agent is the one who just played. decayUnitsCharged is this agent's own share of
  // the round's score decay, and is what its traversal speed is measured against. state.scoreDecayUnits
  // cannot serve here: it is shared by every seat, so it attributes no spend to any individual agent.
  turnCount?: number
  decayUnitsCharged?: number
}

// AgentSeat represents one fixed roster slot; null means the seat is empty.
export type AgentSeat = {
  id: number
  agent: AgentApiConfig | null
}

// MazeActionResult stores only the previous command/replay outcome; live maze facts stay in State.
export type MazeActionResult = {
  lastPlayerName?: string
  lastReplayStartIndex?: 0
  lastSubmittedMovesSchema?: AgentSubmittedMovesSchema
  lastSubmittedMoves?: string[]
  lastMoveStatus?: MoveStatus
  // predictionStatus only ever gets set by the agent-api batch-replay path — a single interactive
  // move dispatch (control.ts's buildReplayState) has no "collective prediction" to summarize, so
  // it leaves this field alone entirely rather than setting a degenerate one-move value for it.
  predictionStatus?: PredictionOutcomeStatus
  lastAppliedMoveIndex?: number | null
  visitedBefore?: boolean
  chargedMovesCount?: number
}

// MazeActionDispatchOptions lets each dispatched command opt into feedback when it needs it.
export type MazeActionDispatchOptions = {
  wantFeedback?: boolean
  playerName: string
}

export type MazeActionDispatch = (
  action: MazeAction,
  options: MazeActionDispatchOptions,
) => MazeActionResult | null

// AgentPlayerStatus describes who is currently playing and how fast they're traversing, for display.
export type AgentPlayerStatus = {
  playerName: string
  uniqueCellsVisited: number
  decayUnitsCharged: number
}

// MazeActionControl defines the production contract that each browser action-control mode implements.
export interface MazeActionControl {
  name: MazeControlModeName
  bindActionDispatch: (
    dispatch: MazeActionDispatch,
    readState: () => State,
    commitTurn: (chargedMovesCount?: number) => void,
  ) => void
  readLastActionResult: () => MazeActionResult | null
  recordActionResult: (actionResult: MazeActionResult) => void
  clearActionResult: () => void
  readCurrentPlayer?: () => string | null
}

// State is the browser runtime's single source of truth for one session.
export type State = {
  controlMode: MazeControlModeName
  level: number
  status: GameStatus

  maze: string[][] | null
  mazeDimensions: MazeDimensions | null
  startPosition: RenderGridPoint | null
  playerPosition: RenderGridPoint | null
  finalPosition: RenderGridPoint | null
  traversalHistory: TraversalHistoryEntry[]
  wallWeight: WallWeight

  score: number
  lastRoundScore: number // Final score of the last completed attempt; losses are completed attempts too.
  lastAttemptRetentionUnits: number | null
  bestWinRetentionUnits: number | null
  lastWinTraversalSpeedUnits: number | null
  bestWinTraversalSpeedUnits: number | null
  winSummary: string
  scoreDecayUnits: number
  turnCount: number
  cumulativeRoundCount: number // Rounds played since the last reset; each level start and retry counts once.

  clock: GameClock | null
}

// GameRuntime exposes the active mode plus a direct dispatch hook for tests and integrations.
export type GameRuntime = {
  mode: MazeControlModeName
  dispatch: MazeActionDispatch
  persistSnapshot: () => void
}

// ScreenLine is the renderer's normalized line model before HTML generation.
export type ScreenLine = {
  kind: "text" | "maze"
  text: string
  className: string
}

// TerminalElements are required on every playable page.
export type TerminalElements = {
  app: HTMLElement
  body: HTMLElement
  screen: HTMLElement
  measure: HTMLElement
  controls: HTMLButtonElement[]
  touchControls: HTMLElement
  touchButtons: HTMLButtonElement[]
}

// AgentElements are only used by the agent-api page overlays and seat roster.
export type AgentElements = {
  agentSeatsBody?: HTMLElement
  tapooLogsReset?: HTMLButtonElement
  tapooLogsDownload?: HTMLButtonElement
  agentSeatRoster?: HTMLElement
  agentConfigForm?: HTMLFormElement
  agentConfigTitle?: HTMLElement
  agentConfigPlayerName?: HTMLInputElement
  agentConfigModel?: HTMLInputElement
  agentConfigApi?: HTMLSelectElement
  agentConfigEndpoint?: HTMLInputElement
  agentConfigCredential?: HTMLInputElement
  agentConfigCredentialLabel?: HTMLElement
  agentConfigCredentialRequired?: HTMLElement
  agentConfigExtraHeadersRows?: HTMLElement
  agentConfigExtraHeadersAdd?: HTMLButtonElement
  agentConfigReasoningEffort?: HTMLSelectElement
  agentConfigEchoBackReasoning?: HTMLInputElement
  agentConfigEchoBackReasoningLabel?: HTMLElement
  agentConfigEnabled?: HTMLInputElement
  agentConfigEnabledLabel?: HTMLElement
  agentConfigClose?: HTMLButtonElement
  agentConfigStatus?: HTMLElement
  agentManageDialog?: HTMLElement
  agentManageTitle?: HTMLElement
  agentDeleteTarget?: HTMLElement
  agentManageEnabled?: HTMLInputElement
  agentManageEnabledLabel?: HTMLElement
  agentManageReasoningEffort?: HTMLSelectElement
  agentManageEchoBackReasoning?: HTMLInputElement
  agentManageEchoBackReasoningLabel?: HTMLElement
  agentManageApply?: HTMLButtonElement
  agentDeleteConfirm?: HTMLInputElement
  agentManageClose?: HTMLButtonElement
}

// Elements combines shared terminal handles with optional agent-api controls.
export type Elements = TerminalElements & AgentElements

// DisplayMsg stores copy variants selected by viewport room, not by input hardware.
export type DisplayMsg = {
  wide: string
  compact: string
}

// SummaryComparisonTemplates groups the best-record variants shared by win summaries.
export type SummaryComparisonTemplates = {
  newRecord: string
  matchedBest: string
  behindBest: string
}

// LogLevel classifies the severity of a Tapoo log entry for filtering and analysis. For an
// agent-api provider response specifically (see request.ts/control/agent-api.ts), the three levels
// map onto AgentPredictionResult like this:
//   info  — a successful request/response round-trip with a validly-formatted output. This covers
//           "Agent request.", "Agent response.", and a round's final "Agent level won/lost." entry
//           — the batch of moves it carried may still include invalid ones (a wall hit stops
//           replay), since that is a maze-navigation outcome, not a wire-format problem.
//   warn  — reason: "malformed-response" or "token-limit-exhaustion". The model's own recoverable
//           mistake (unparseable JSON, a hallucinated tool call, ignoring a duplicate-call warning,
//           or exhausting the token cap without a prediction) — Tapoo charges the fixed mistake
//           penalty after any eligible retry is exhausted and keeps the agent enabled.
//   error — reason: "network-error". The provider/infrastructure itself failed (HTTP failure,
//           timeout, fetch exception) rather than the model producing bad output. No penalty is
//           charged for this — see recordAgentNetworkError — and the agent is disabled instead.
// "error" is also used outside the agent-api response path, for internal invariant violations
// (game.ts) and fallback-policy failures unrelated to any specific agent's response.
export type LogLevel = "error" | "info" | "warn"

// LogEntry is one structured record in the Tapoo log buffer.
// epochMs is Unix time in milliseconds — machine-readable and suitable for sorting or arithmetic.
// time is the same instant expressed in local timezone as a human-readable string, so downloaded
// logs are interpretable without UTC conversion.
// turn is the agent turn being resolved when the entry was written. One turn issues several
// provider requests — one per tool-servicing round, then the prediction — so this is what ties
// those entries back together when a downloaded log is analysed.
// level is the maze level being played when the entry was written, stamped the same way turn is —
// without it, a "Agent request."/"Agent response." pair only carries a turn number, which resets
// every level and gives no way to tell which level a given request actually belongs to.
// game is State's cumulativeRoundCount, stamped the same way turn and level are — level and turn
// alone can't distinguish a retry of the same level from continuing the prior playthrough, since
// both reset to the same values either way; this counter never resets mid-session.
// payload is the human-readable description of what was logged.
// details holds arbitrary context — request payloads, response bodies, error objects — and is
// omitted when there is nothing beyond the payload to record.
export type LogEntry = {
  epochMs: number
  time: string
  turn: number
  level: number
  game: number
  log: LogLevel
  payload: string
  details?: unknown
}

// AppConfig gathers translatable copy and shared runtime constants.
export type AppConfig = {
  chrome: {
    appName: string
    appSubtitle: string
    pageVersionTemplate: string
    contactLabel: string
    privacyLabel: string
  }
  pages: {
    game: {
      documentTitle: string
      description: string
      pageLabel: string
      aiAgentsLabel: string
    }
    agents: {
      documentTitle: string
      description: string
      pageLabel: string
      backToGameLabel: string
    }
    prompts: {
      documentTitle: string
      description: string
      pageLabel: string
      backToAgentsLabel: string
    }
    privacy: {
      documentTitle: string
      description: string
      pageLabel: string
    }
  }
  messages: {
    navigation: {
      interactive: DisplayMsg
      agentApi: DisplayMsg
    }
    pauseMessage: string
    success: DisplayMsg
    failed: DisplayMsg
    proceed: DisplayMsg
    agentAwaitMessage: string
    agentAwaitAction: DisplayMsg
    tooSmallMessage: string
    tooSmallActionMessage: string
    runningStatus: DisplayMsg
    highScoreTemplate: string
    // noPrevious is a single line rather than a comparison group: with no previous record there is
    // no best record either, so the result can only ever be a new record.
    winSummary: {
      noPrevious: string
      fasterPrevious: SummaryComparisonTemplates
      slowerPrevious: SummaryComparisonTemplates
      matchedPrevious: SummaryComparisonTemplates
    }
    agentWinSummary: {
      noPrevious: string
      fasterPrevious: SummaryComparisonTemplates
      slowerPrevious: SummaryComparisonTemplates
      matchedPrevious: SummaryComparisonTemplates
    }
  }
  controls: {
    touch: {
      wallsLabel: string
      pauseLabel: string
      proceedLabel: string
      resetProgressLabel: string
    }
  }
  promptPreview: {
    openLabel: string
    title: string
    intro: string
    playerNoteTemplate: string
    systemHeading: string
    userHeading: string
    toolsHeading: string
    schemaHeading: string
    duplicateToolCallHeading: string
    tokenLimitExhaustionHeading: string
  }
  agentConfig: {
    title: string
    newAgentLabel: string
    agentEnabledLabel: string
    agentDisabledLabel: string
    maxSeats: number
    maxModelDisplayLength: number
    playerNameMinLength: number
    playerNameMaxLength: number
    playerNameLabel: string
    playerNamePlaceholder: string
    duplicatePlayerNameMessage: string
    playerNameLengthMessage: string
    modelLabel: string
    modelPlaceholder: string
    apiLabel: string
    requiredFieldNote: string
    providerLabels: Record<AgentApiProvider, string>
    endpointLabel: string
    endpointPlaceholders: Record<AgentApiProvider, string>
    credentialLabels: Record<AgentApiProvider, string>
    credentialRotationTooltip: string
    extraHeadersLabel: string
    extraHeadersTooltip: string
    addHeaderLabel: string
    removeHeaderLabel: string
    extraHeadersKeyPlaceholders: Record<AgentApiProvider, string>
    extraHeadersValuePlaceholders: Record<AgentApiProvider, string>
    reasoningEffortLabel: string
    reasoningEffortTooltip: string
    reasoningEffortOptions: Record<AgentApiProvider, AgentReasoningEffort[]>
    reasoningEffortDefaults: Record<AgentApiProvider, AgentReasoningEffort>
    reasoningEffortLabels: Record<AgentReasoningEffort, string>
    echoBackReasoningLabel: string
    echoBackReasoningTooltip: string
    echoBackReasoningOnLabel: string
    echoBackReasoningOffLabel: string
    submitLabel: string
    invalidMessage: string
    invalidApiMessage: string
    invalidEndpointMessage: string
    invalidAnthropicCredentialsMessage: string
    invalidExtraHeadersMessage: string
    editTitle: string
    addSeatLabelTemplate: string
    manageSeatLabelTemplate: string
    activeSeatLabelTemplate: string
    deleteMessageTemplate: string
    updateConfirmLabel: string
  }
  maze: {
    playerMarker: string
    visitedCellMarker: string
    destinationMarker: string
    walls: Record<WallWeight, [string, string, string]>
    renderCellStep: number
    wallOpening: {
      horizontal: number
      vertical: number
    }
    leftPadding: number
    minMazeSideCells: number
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
    retentionFullScaleUnits: number
    agentBaseDecayUnits: number
    agentPartialInvalidPenaltyDecayUnits: number
    agentZeroProgressPenaltyDecayUnits: number
    agentMalformedPenaltyDecayUnits: number
    traversalSpeedScaleUnits: number
  }
  timing: {
    persistenceDebounceMs: number
    blinkIntervalMs: number
    scoreDecayRate: number
    interactiveDecayIntervalPerCellMs: number
    agentApiTurnPollIntervalMs: number
    agentApiRequestPollIntervalMs: number
    agentApiResponseTimeoutMs: number
    agentApiConnectionErrorRetryDelayMs: number
  }
  viewport: {
    compactWidth: number
    compactHeight: number
    terminalSampleWidth: number
    terminalHeightInset: number
    terminalHeightScale: number
    terminalWidthInset: number
    terminalWidthScale: number
  }
  runtime: {
    controlModes: {
      interactive: MazeControlModeName
      agentApi: MazeControlModeName
    }
    storage: {
      version: number
      suffixes: {
        agentConfigs: string
        gameSetup: string
        winMetrics: string
        tapooLog: string
      }
    }
    interactivePlayerName: string
    modelConfig: {
      contextWindowFloor: number
      manhattanDistance: number
      suggestedMovesPerTurnRange: { min: number; max: number }
      temperature: number
      numPredict: number
    }
  }
}
