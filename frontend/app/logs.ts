type LogLevel = "error" | "info" | "warn"

type LogEntry = {
  timestamp: string
  level: LogLevel
  message: string
  details?: unknown
}

type LogStateListener = (logCount: number) => void

// logBuffer keeps Tapoo runtime/debug entries in memory for the current page session.
const logBuffer: LogEntry[] = []
const logStateListeners = new Set<LogStateListener>()

// notifyLogStateListeners keeps UI controls aligned with the in-memory log buffer.
function notifyLogStateListeners(): void {
  logStateListeners.forEach((listener) => {
    listener(logBuffer.length)
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

// logTapooDiagnostic buffers entries for later download without touching browser storage.
export function logTapooDiagnostic(
  level: LogLevel,
  message: string,
  details?: unknown,
): void {
  const entry: LogEntry = { timestamp: getLocalTimestamp(), level, message }
  if (details !== undefined) {
    entry.details = details
  }
  logBuffer.push(entry)
  notifyLogStateListeners()
}

// tapooResetLogs clears only the in-memory Tapoo log buffer for the active page session.
export function tapooResetLogs(): void {
  logBuffer.length = 0
  notifyLogStateListeners()
}

// tapooLogCount reports whether reset controls have anything meaningful to clear.
export function tapooLogCount(): number {
  return logBuffer.length
}

// subscribeTapooLogs notifies UI surfaces whenever log availability changes.
export function subscribeTapooLogs(listener: LogStateListener): () => void {
  logStateListeners.add(listener)
  listener(logBuffer.length)

  return () => {
    logStateListeners.delete(listener)
  }
}

// tapooDownloadLogs triggers a JSON download of all buffered Tapoo log entries.
// Attach to window in the page entry point so it survives property mangling and tree-shaking.
export function tapooDownloadLogs(): void {
  const blob = new Blob([JSON.stringify(logBuffer, null, 2)], {
    type: "application/json",
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `tapoo-logs-${getDownloadTimestamp()}.json`
  anchor.hidden = true
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 0)
}
