import { logTapooDiagnostic } from "./logs"
import type { MazeControlModeName } from "./types"

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

// placeholderArtErrorPolicy resolves the exact known reason behind a fallback decision.
function placeholderArtErrorPolicy(error: Error): PlaceholderArtErrorPolicy | null {
  return (
    PLACEHOLDER_ART_ERROR_POLICY.find(({ messagePrefix }) =>
      error.message.startsWith(messagePrefix),
    ) ?? null
  )
}

// logPlaceholderFallback records the original Error so production debugging keeps the stack trace.
function logPlaceholderFallback(modeName: MazeControlModeName, error: Error): void {
  const reason = placeholderArtErrorPolicy(error)?.reason ?? unknownFallbackReason
  logTapooDiagnostic(modeName, "error", reason, error)
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

// prepareTerminalAppForBootstrap makes the checked terminal visible before bootstrap focuses it.
export function prepareTerminalAppForBootstrap(): void {
  showPageView("terminal")
}

// showPlaceholderArt swaps the terminal for the generic fallback only after unrecoverable Errors.
export function showPlaceholderArt(modeName: MazeControlModeName, error: unknown): void {
  if (!(error instanceof Error)) {
    return
  }

  logPlaceholderFallback(modeName, error)
  showPageView("placeholder")
}
