import { APP_VERSION, CONFIG } from "./config"
import { isAgentApiMode, isRunningStatus } from "./status"
import {
  appendTapooLogStoreEntry,
  appendTapooLogStoreFallbackEntrySynchronously,
  clearCurrentAndStaleTapooLogStoreEntries,
  initTapooLogStore,
  loadCurrentTapooLogStoreEntries,
  refreshCurrentTapooLogStoreLease,
} from "./storage-logs"
import type { EncodedMaze, LogEntry, LogLevel, MazeControlModeName, State } from "./types"

type LogStateListener = (logCount: number) => void

const logStateListeners = new Set<LogStateListener>()
const tapooLogModeName = CONFIG.runtime.controlModes.agentApi
const loggedDescriptionPreviewLength = 25

// --- Log State ---

// logCount tracks how many entries are stored without holding the full payloads in memory.
// Seeded by initTapooLogs once the agent-api log stream opens; zero until then.
let logCount = 0
let staleLogSessionCount = 0
let heartbeatTimer: number | null = null
// True while a lease refresh started by the heartbeat is still open. Ticks that arrive meanwhile are
// dropped rather than queued - see the interval body for why two in flight is worse than none.
let heartbeatRefreshPending = false
let writeQueue: Promise<void> = Promise.resolve()

// currentTurn stamps every entry written while one agent turn resolves. A turn issues several
// provider requests before its prediction lands, and nothing else in an entry identifies which
// turn produced it, so this is what makes per-turn grouping possible in a downloaded log.
let currentTurn = 0

// currentLevel stamps every entry the same way currentTurn does, so a downloaded log can tell
// which maze level a given request belongs to - turn alone can't, since turnCount resets each level.
let currentLevel = 0

// currentGame stamps every entry the same way currentTurn/currentLevel do (from State's
// cumulativeRoundCount) - turn and level alone can't tell a retry of the same level apart from
// continuing it, since both reset to the same values either way; this counter never resets
// mid-session.
let currentGame = 0

// --- Timestamps ---

// localTimestampParts returns filename-safe local time pieces shared by log entries and downloads.
function localTimestampParts(): [string, string, string] {
  const date = new Date()
  const pad = (value: number): string => String(value).padStart(2, "0")
  const offsetMinutes = -date.getTimezoneOffset()
  const offsetSign = offsetMinutes >= 0 ? "+" : "-"
  const absoluteOffsetMinutes = Math.abs(offsetMinutes)
  const offsetHours = pad(Math.floor(absoluteOffsetMinutes / 60))
  const offsetRemainderMinutes = pad(absoluteOffsetMinutes % 60)

  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `T${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`,
    `${offsetSign}${offsetHours}-${offsetRemainderMinutes}`,
  ]
}

// getLocalTimestamp formats local timezone debugging time in a filename-safe form.
function getLocalTimestamp(): string {
  return localTimestampParts().join("")
}

// --- Counters And Heartbeat ---

// clearTapooLogHeartbeat stops lease refreshes once this tab has no current-session logs to protect.
function clearTapooLogHeartbeat(): void {
  if (heartbeatTimer === null) {
    return
  }

  window.clearInterval(heartbeatTimer)
  heartbeatTimer = null
}

// updateLogState is the single in-memory counter write path after any log-store read/write/reset.
// The UI buttons only know these counters, not IndexedDB/sessionStorage internals. Keeping this as
// the only counter publisher prevents callers from updating counts while forgetting to refresh UI
// controls or stop a now-useless heartbeat after logs are cleared.
function updateLogState(currentCount: number, staleCount: number): void {
  logCount = currentCount
  staleLogSessionCount = staleCount
  if (logCount === 0) {
    clearTapooLogHeartbeat()
  }

  logStateListeners.forEach((listener) => listener(logCount))
}

// syncTapooLogHeartbeat keeps non-empty stopped agent-api sessions fresh enough to avoid stale
// cleanup. Active running rounds renew their lease through successful log writes instead, so the
// interval is reserved for logs that would otherwise sit unchanged while the game is paused,
// awaiting configuration, won/lost, or otherwise not running.
export function syncTapooLogHeartbeat(
  state: Pick<State, "controlMode" | "status">,
): void {
  const activeRoundRunning = isAgentApiMode(state.controlMode) && isRunningStatus(state.status)

  if (activeRoundRunning || logCount === 0) {
    clearTapooLogHeartbeat()
    return
  }

  if (heartbeatTimer !== null) {
    return
  }

  heartbeatTimer = window.setInterval(() => {
    if (logCount === 0) {
      clearTapooLogHeartbeat()
      return
    }

    // One refresh at a time. A tick landing while the previous one is still open - a database
    // blocked by another tab, a slow disk, a backgrounded tab firing late - is dropped instead of
    // queued: two renewals in flight are two read-modify-writes racing on the same lease row, and
    // the later write can carry a createdAt it read before the earlier one landed. Dropping costs
    // nothing, because the next tick renews the same lease with a fresher timestamp anyway, and the
    // TTL is six heartbeats wide.
    if (heartbeatRefreshPending) {
      return
    }

    heartbeatRefreshPending = true
    void refreshCurrentTapooLogStoreLease(tapooLogModeName)
      .then((logStoreState) => {
        updateLogState(logStoreState.currentLogCount, logStoreState.staleLogSessionCount)
      })
      .catch(() => {
        // A rejected refresh must not reach window.onunhandledrejection, which swaps the whole game
        // for the placeholder art - losing a round in progress to a housekeeping task the next tick
        // would simply have retried. A store that keeps failing is already reported through the
        // append path, which degrades the backend the UI reads.
      })
      .finally(() => { heartbeatRefreshPending = false })
  }, CONFIG.runtime.storage.log.heartbeatIntervalMs)
}

// subscribeTapooLogs notifies UI surfaces whenever the log count changes.
export function subscribeTapooLogs(listener: LogStateListener): () => void {
  logStateListeners.add(listener)
  listener(logCount)

  return () => {
    logStateListeners.delete(listener)
  }
}

// tapooLogCount reports whether download controls have anything meaningful to export.
export function tapooLogCount(): number {
  return logCount
}

// tapooResettableLogCount includes stale same-mode sessions because reset is the one user-triggered
// cleanup path for them; download stays current-session only and should use tapooLogCount.
export function tapooResettableLogCount(): number {
  return logCount + staleLogSessionCount
}

// --- Log Lifecycle ---

async function flushTapooLogWrites(): Promise<void> {
  await writeQueue
}

// initTapooLogs must run at least once before heartbeat syncing: it presets logCount from the
// current tab's agent-api log stream, which is how an interactive page later knows whether it has
// existing agent-api records to keep fresh. Interactive pages still never create or write
// interactive-mode log records.
export async function initTapooLogs(): Promise<void> {
  const logStoreState = await initTapooLogStore(tapooLogModeName)
  updateLogState(logStoreState.currentLogCount, logStoreState.staleLogSessionCount)
}

// setTapooLogContext marks which turn, level, and game subsequent entries belong to, reading all
// three off one state snapshot in a single call. Called once as each turn begins, so every
// request, response, and diagnostic it produces carries the same values. Takes a Pick rather than
// the whole State so this module only ever depends on the fields it actually stamps entries with.
export function setTapooLogContext(
  state: Pick<State, "turnCount" | "level" | "cumulativeRoundCount">,
): void {
  currentTurn = state.turnCount
  currentLevel = state.level
  currentGame = state.cumulativeRoundCount
}

// logTapooRecordEntry queues one Tapoo Logs record: gameplay milestones, agent request/response
// payloads, diagnostics, and profiler evidence all use the same timestamped stream. Callers never
// await it so gameplay/request paths do not stall on IndexedDB; download/reset flush the queue
// before reading.
export function logTapooRecordEntry(
  modeName: MazeControlModeName,
  log: LogLevel,
  message: string,
  details?: unknown,
): void {
  if (!isAgentApiMode(modeName)) {
    return
  }

  const entry: LogEntry = {
    epochMs: Date.now(),
    time: getLocalTimestamp(),
    level: currentLevel,
    turn: currentTurn,
    game: currentGame,
    log,
    payload: message,
  }
  if (details !== undefined) {
    entry.details = details
  }

  const fallbackState = appendTapooLogStoreFallbackEntrySynchronously(modeName, entry)
  if (fallbackState) {
    updateLogState(fallbackState.currentLogCount, fallbackState.staleLogSessionCount)
    return
  }

  writeQueue = writeQueue
    .then(() => appendTapooLogStoreEntry(modeName, entry))
    .then((logStoreState) => {
      updateLogState(logStoreState.currentLogCount, logStoreState.staleLogSessionCount)
    })
    .catch(() => {
      // A failed log write must not break future writes. The next entry starts a fresh queue link.
    })
}

// tapooResetLogs clears the current tab-session logs plus stale sessions for the same mode.
export async function tapooResetLogs(modeName: MazeControlModeName): Promise<void> {
  if (!isAgentApiMode(modeName)) {
    currentTurn = 0
    currentLevel = 0
    currentGame = 0
    updateLogState(0, 0)
    return
  }

  await flushTapooLogWrites()
  const logStoreState = await clearCurrentAndStaleTapooLogStoreEntries(modeName)
  currentTurn = 0
  currentLevel = 0
  currentGame = 0
  updateLogState(logStoreState.currentLogCount, logStoreState.staleLogSessionCount)
}

// tapooDownloadLogs reads the current tab-session payload on demand and triggers a JSON file
// download. Reading only at download time means memory usage stays flat during gameplay.
// Attach to window in the page entry point so it survives property mangling and tree-shaking.
export async function tapooDownloadLogs(modeName: MazeControlModeName): Promise<void> {
  if (!isAgentApiMode(modeName)) {
    return
  }

  await flushTapooLogWrites()
  const entries = await loadCurrentTapooLogStoreEntries(modeName)
  const payload = {
    name: "tapoo",
    version: APP_VERSION,
    mode: modeName,
    downloadedAt: getLocalTimestamp(),
    entries,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  })
  const firstEntryEpochMs = entries.length > 0 ? entries[0].epochMs : Date.now()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `${payload.name}-v${payload.version}-${modeName}-logs-${Math.round(firstEntryEpochMs / 1000)}.json`
  anchor.hidden = true
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 0)
}

// --- Logged Text Helpers ---

// trimLoggedDescription is the single place every long, repeated description field goes through
// before being logged. Passing keepFull lets each call site decide once whether this entry needs
// the real text (e.g. the level's first request) or just a short, recognizable preview.
export function trimLoggedDescription(
  description: string | undefined,
  keepFull: boolean,
): string | undefined {
  if (keepFull || !description || description.length <= loggedDescriptionPreviewLength) {
    return description
  }

  // Log full warnings
  if (description.startsWith(CONFIG.runtime.promptWarningPrefix, 0)) {
    return description
  }

  return `${description.slice(0, loggedDescriptionPreviewLength)}...`
}

// fnv1a64Checksum is the one checksum algorithm used consistently for every logged text field - not
// a security control, just cheap proof a prompt/tool description didn't silently change
// mid-experiment. 64-bit for lower collision odds than the 32-bit variant. Hashes UTF-8 bytes (via
// TextEncoder, the same encoding any external tool reproducing this outside the app would use)
// rather than JS's own UTF-16 code units, so a non-ASCII character (a curly quote, an em dash, an
// arrow in a tool description) hashes identically here and in that external tool.
// Implementation reference: https://www.ietf.org/archive/id/draft-eastlake-fnv-22.html
export function fnv1a64Checksum(text: string): string {
  const offsetBasis = 0xcbf29ce484222325n // 14695981039346656037 - the fixed FNV-1a 64-bit offset from the spec.
  const prime = 0x100000001b3n // 1,099,511,628,211 - the fixed FNV-1a 64-bit prime from the spec.

  let hash = offsetBasis
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * prime)
  }
  return `0x${hash.toString(16).padStart(16, "0")}`
}

// checksumLoggedDescription computes fnv1a64Checksum for a description/content field, or undefined
// when there's nothing to hash - mirrors trimLoggedDescription's own undefined handling.
export function checksumLoggedDescription(description: string | undefined): string | undefined {
  return description === undefined ? undefined : fnv1a64Checksum(description)
}

// --- Maze Encoding Helpers ---

// encodeMazeForLog packs a maze grid into one compact, exactly reversible representation instead of
// a nested rows array: each cell becomes the single digit naming its position in index_chars,
// discovered dynamically from this maze's own content rather than assumed from wallWeight/CONFIG.
export function encodeMazeForLog(maze: string[][]): EncodedMaze {
  const index_chars: string[] = []
  const indexByToken = new Map<string, number>()
  const codeFor = (token: string): number => {
    const cached = indexByToken.get(token)
    if (cached !== undefined) {
      return cached
    }

    const index = index_chars.length
    indexByToken.set(token, index)
    index_chars.push(token)
    return index
  }

  const rows = maze.map((row) => row.map(codeFor).join(""))
  const rowSeparator = String(codeFor("\n"))
  const structure = rows.join(rowSeparator)
  return { index_chars, structure_checksum: fnv1a64Checksum(structure), structure }
}
