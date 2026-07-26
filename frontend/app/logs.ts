import { appendTapooLogEntry, clearTapooLog, loadTapooLog } from "./storage"
import type { LogEntry, LogLevel, MazeControlModeName } from "./types"

type LogStateListener = (logCount: number) => void

const logStateListeners = new Set<LogStateListener>()

// logCount tracks how many entries are stored without holding the full payloads in memory.
// Seeded by initTapooLogs once the page mode is known; zero until then.
let logCount = 0

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

// getDownloadTimestamp keeps downloaded filenames shorter while log entries retain timezone data.
function getDownloadTimestamp(): string {
  const [localDate, localTime] = localTimestampParts()
  return `${localDate}${localTime}`
}

// initTapooLogs seeds the in-memory log count from sessionStorage entries that survived a page
// reload for the given mode. Call once at page startup after the control mode is resolved.
export function initTapooLogs(modeName: MazeControlModeName): void {
  logCount = loadTapooLog<unknown>(modeName).length
  notifyLogStateListeners()
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
  const entry: LogEntry = { timestamp: Date.now() / 1000, time: getLocalTimestamp(), type, payload: message }
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
  const blob = new Blob([JSON.stringify(entries, null, 2)], {
    type: "application/json",
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `tapoo-${modeName}-logs-${getDownloadTimestamp()}.json`
  anchor.hidden = true
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 0)
}
