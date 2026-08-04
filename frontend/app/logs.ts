import { appendTapooLogEntry, clearTapooLog, loadTapooLog } from "./storage"
import type { LogEntry, LogLevel, MazeControlModeName } from "./types"
import { APP_VERSION } from "./config"

type LogStateListener = (logCount: number) => void

const logStateListeners = new Set<LogStateListener>()

// loggedDescriptionPreviewLength caps how much of a known long/repeated description field
// survives into the log when the full text isn't needed.
const loggedDescriptionPreviewLength = 25

// logCount tracks how many entries are stored without holding the full payloads in memory.
// Seeded by initTapooLogs once the page mode is known; zero until then.
let logCount = 0

// currentTurn stamps every entry written while one agent turn resolves. A turn issues several
// provider requests before its prediction lands, and nothing else in an entry identifies which
// turn produced it, so this is what makes per-turn grouping possible in a downloaded log.
let currentTurn = 0

// notifyLogStateListeners keeps UI controls aligned with the current log count.
function notifyLogStateListeners(): void {
  logStateListeners.forEach((listener) => {
    listener(logCount)
  })
}

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

  return `${description.slice(0, loggedDescriptionPreviewLength)}...`
}

// initTapooLogs seeds the in-memory log count from sessionStorage entries that survived a page
// reload for the given mode. Call once at page startup after the control mode is resolved.
export function initTapooLogs(modeName: MazeControlModeName): void {
  logCount = loadTapooLog<unknown>(modeName).length
  notifyLogStateListeners()
}

// setTapooLogTurn marks which agent turn subsequent entries belong to. Called once as each turn
// begins, so every request, response, and diagnostic it produces carries the same turn number.
export function setTapooLogTurn(turn: number): void {
  currentTurn = turn
}

// logTapooDiagnostic appends one entry to sessionStorage and increments the in-memory count.
// The full payload is never held in memory; only the count is, so large request/response bodies
// accumulated over many turns do not grow the JS heap.
export function logTapooDiagnostic(
  modeName: MazeControlModeName,
  type: LogLevel,
  message: string,
  details?: unknown,
): void {
  const entry: LogEntry = {
    timestamp: Date.now() / 1000,
    time: getLocalTimestamp(),
    turn: currentTurn,
    type,
    payload: message,
  }
  if (details !== undefined) {
    entry.details = details
  }
  appendTapooLogEntry(modeName, entry)
  logCount += 1

  notifyLogStateListeners()
}

// tapooResetLogs clears the sessionStorage log snapshot for the given mode and resets the count.
export function tapooResetLogs(modeName: MazeControlModeName): void {
  clearTapooLog(modeName)
  logCount = 0
  currentTurn = 0
  
  notifyLogStateListeners()
}

// tapooLogCount reports whether reset controls have anything meaningful to clear.
export function tapooLogCount(): number {
  return logCount
}

// subscribeTapooLogs notifies UI surfaces whenever the log count changes.
export function subscribeTapooLogs(listener: LogStateListener): () => void {
  logStateListeners.add(listener)
  listener(logCount)

  return () => {
    logStateListeners.delete(listener)
  }
}

// tapooDownloadLogs reads the full log payload from sessionStorage on demand and triggers a
// JSON file download. Reading only at download time means memory usage stays flat during gameplay.
// Attach to window in the page entry point so it survives property mangling and tree-shaking.
export function tapooDownloadLogs(modeName: MazeControlModeName): void {
  const entries = loadTapooLog<LogEntry>(modeName)
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
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `${payload.name}-v${payload.version}-${modeName}-logs-${Date.now()}.json`
  anchor.hidden = true
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 0)
}
