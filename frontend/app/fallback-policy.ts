// PlaceholderArtErrorPolicy describes stable failures that should replace the terminal view.
type PlaceholderArtErrorPolicy = {
  // messagePrefix matches developer/invariant errors without depending on full stack text.
  messagePrefix: string
  // reason documents why refresh is not expected to resolve this failure.
  reason: string
}

// PLACEHOLDER_ART_ERROR_POLICY gives known fallback failures a precise console explanation.
const PLACEHOLDER_ART_ERROR_POLICY: readonly PlaceholderArtErrorPolicy[] = [
  {
    messagePrefix: "missing config entry:",
    reason: "The page references a CONFIG path that is absent from the shipped bundle.",
  },
  {
    messagePrefix: "missing translatable config entry:",
    reason: "The page references CONFIG text that is missing or has the wrong type.",
  },
  {
    messagePrefix: "missing required element:",
    reason: "The terminal template was removed, corrupted, or manipulated after load.",
  },
  {
    messagePrefix: "agent move dispatch must return feedback",
    reason: "The agent-api control contract was broken by code or developer manipulation.",
  },
]

const unknownFallbackReason =
  "An unexpected runtime Error reached the page shell; showing fallback placeholder."

type DiagnosticLevel = "error" | "info" | "warn"

type DiagnosticEntry = {
  timestamp: string
  level: DiagnosticLevel
  message: string
  details?: unknown
}

// diagnosticBuffer accumulates all log entries for the lifetime of the page session.
const diagnosticBuffer: DiagnosticEntry[] = []

function getLocalTimestamp(): string {
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
  ].join("")
}

// logTapooDiagnostic buffers diagnostic entries for download; console output is omitted
// because all diagnostic data is available via window.tapooDownloadLogs().
export function logTapooDiagnostic(
  level: DiagnosticLevel,
  message: string,
  details?: unknown,
): void {
  const entry: DiagnosticEntry = { timestamp: getLocalTimestamp(), level, message }
  if (details !== undefined) {
    entry.details = details
  }
  diagnosticBuffer.push(entry)
}

// tapooDownloadLogs triggers a JSON download of all buffered diagnostic entries.
// Attach to window in the page entry point so it survives property mangling and tree-shaking.
export function tapooDownloadLogs(): void {
  const blob = new Blob([JSON.stringify(diagnosticBuffer, null, 2)], {
    type: "application/json",
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `tapoo-diagnostic-${getLocalTimestamp()}.json`
  anchor.hidden = true
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 0)
}

// placeholderArtErrorPolicy resolves the exact known reason behind a fallback decision.
function placeholderArtErrorPolicy(error: Error): PlaceholderArtErrorPolicy | null {
  return (
    PLACEHOLDER_ART_ERROR_POLICY.find(({ messagePrefix }) =>
      error.message.startsWith(messagePrefix),
    ) ?? null
  )
}

// logPlaceholderFallback records the original Error so production debugging keeps the stack trace.
function logPlaceholderFallback(error: Error): void {
  const reason = placeholderArtErrorPolicy(error)?.reason ?? unknownFallbackReason
  logTapooDiagnostic("error", reason, error)
}

// showPageView keeps terminal and placeholder visibility mutually exclusive.
function showPageView(view: "terminal" | "placeholder"): void {
  const terminalApp = document.getElementById("terminal-app")
  const placeholder = document.getElementById("placeholder-art")
  const isTerminalVisible = view === "terminal"

  if (terminalApp) {
    terminalApp.hidden = false
    terminalApp.setAttribute("aria-hidden", String(!isTerminalVisible))
  }

  if (placeholder) {
    placeholder.hidden = isTerminalVisible
    placeholder.setAttribute("aria-hidden", String(isTerminalVisible))
  }
}

// showTerminalApp promotes the checked runtime view over the default placeholder.
export function showTerminalApp(): void {
  showPageView("terminal")
}

// showPlaceholderArt swaps the terminal for the generic fallback only after unrecoverable Errors.
export function showPlaceholderArt(error: unknown): void {
  if (!(error instanceof Error)) {
    return
  }

  logPlaceholderFallback(error)
  showPageView("placeholder")
}
