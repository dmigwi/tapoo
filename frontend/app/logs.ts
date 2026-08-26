import { appendTapooLogEntry, clearTapooLog, loadTapooLog } from "./storage"
import type { LogEntry, LogLevel, MazeControlModeName, State } from "./types"
import { APP_VERSION, CONFIG } from "./config"

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

// currentLevel stamps every entry the same way currentTurn does, so a downloaded log can tell
// which maze level a given request belongs to — turn alone can't, since turnCount resets each level.
let currentLevel = 0

// currentGame stamps every entry the same way currentTurn/currentLevel do (from State's
// cumulativeRoundCount) — turn and level alone can't tell a retry of the same level apart from
// continuing it, since both reset to the same values either way; this counter never resets
// mid-session.
let currentGame = 0

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

  // Log full warnings
  if (description.startsWith(CONFIG.runtime.promptWarningPrefix, 0)) {
    return description
  }

  return `${description.slice(0, loggedDescriptionPreviewLength)}...`
}

// fnv1a64Checksum is the one checksum algorithm used consistently for every logged text field — not
// a security control, just cheap proof a prompt/tool description didn't silently change
// mid-experiment. 64-bit for lower collision odds than the 32-bit variant. Hashes UTF-8 bytes (via
// TextEncoder, the same encoding any external tool reproducing this outside the app would use)
// rather than JS's own UTF-16 code units, so a non-ASCII character (a curly quote, an em dash, an
// arrow in a tool description) hashes identically here and in that external tool.
// Implementation reference: https://www.ietf.org/archive/id/draft-eastlake-fnv-22.html
export function fnv1a64Checksum(text: string): string {
  const offsetBasis = 0xcbf29ce484222325n  // 14695981039346656037 - the fixed FNV-1a 64-bit offset from the spec.
  const prime = 0x100000001b3n  // 1,099,511,628,211 - the fixed FNV-1a 64-bit prime from the spec.

  let hash = offsetBasis
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * prime)
  }
  return `0x${hash.toString(16).padStart(16, "0")}`
}

// checksumLoggedDescription computes fnv1a64Checksum for a description/content field, or undefined when
// there's nothing to hash — mirrors trimLoggedDescription's own undefined handling.
export function checksumLoggedDescription(description: string | undefined): string | undefined {
  return description === undefined ? undefined : fnv1a64Checksum(description)
}

// EncodedMazeForLog is fully self-contained: index_chars lists every distinct token the encoded maze
// actually used, in first-seen order, with "\n" always appended last as the row separator. No
// wallWeight or CONFIG lookup is needed to decode it — index_chars[Number(digit)] for every digit in
// structure (including the separator digits) reconstructs the exact original printable maze text.
export type EncodedMazeForLog = {
  index_chars: string[]
  // structure_checksum lets offline consumers verify the compact structure string arrived intact
  // before expanding it with index_chars. Fnva1-64bit checksum hash.
  structure_checksum: string
  // structure's exact length is (2R+1)(2C+1) + 2R for an R x C logical maze (renderCellStep 2: one
  // digit per rendered cell, plus one row-separator digit per row boundary) — for a roughly square
  // maze (R ~ C ~ sqrt(area)), that's well estimated from mazeDimensions.area alone as
  // 4*area + 6*sqrt(area) + 1.
  structure: string
}

// encodeMazeForLog packs a maze grid into one compact, exactly reversible representation instead of
// a nested rows array: each cell becomes the single digit naming its position in index_chars, discovered
// dynamically from this maze's own content rather than assumed from wallWeight/CONFIG.
export function encodeMazeForLog(maze: string[][]): EncodedMazeForLog {
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

// initTapooLogs seeds the in-memory log count from sessionStorage entries that survived a page
// reload for the given mode. Call once at page startup after the control mode is resolved.
export function initTapooLogs(modeName: MazeControlModeName): void {
  logCount = loadTapooLog<unknown>(modeName).length
  notifyLogStateListeners()
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

// logTapooDiagnostic appends one entry to sessionStorage and increments the in-memory count.
// The full payload is never held in memory; only the count is, so large request/response bodies
// accumulated over many turns do not grow the JS heap.
export function logTapooDiagnostic(
  modeName: MazeControlModeName,
  log: LogLevel,
  message: string,
  details?: unknown,
): void {
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
  appendTapooLogEntry(modeName, entry)
  logCount += 1

  notifyLogStateListeners()
}

// tapooResetLogs clears the sessionStorage log snapshot for the given mode and resets the count.
export function tapooResetLogs(modeName: MazeControlModeName): void {
  clearTapooLog(modeName)
  logCount = 0
  currentTurn = 0
  currentLevel = 0
  currentGame = 0

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
  const firstEntryEpochMs = entries.length > 0 ? entries[0].epochMs : Date.now()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `${payload.name}-v${payload.version}-${modeName}-logs-${Math.round(firstEntryEpochMs/1000)}.json`
  anchor.hidden = true
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 0)
}
