// Protocol helpers for the agent-api wire format: request sizing, response parsing, tool-call
// argument/result marshalling, and the log previews applied to outbound payloads. Kept apart from
// config.ts, which validates the agent records a human configures rather than anything on the wire.
import { checksumLoggedDescription, trimLoggedDescription } from "../logs"
import { isMoveAction } from "../traversal"
import type {
  AgentChatMessage,
  AgentToolDefinition,
  MazeAction,
  MoveAction,
} from "../types"

type AgentPredictionPayload = { moves?: unknown }

// endpointLabel keeps diagnostics readable while avoiding noisy query strings.
export function endpointLabel(endpoint: URL): string {
  return `${endpoint.origin}${endpoint.pathname}`
}

// parseExtraHeaders turns an agent's raw "Key: Value" textarea input into a headers object. Each
// line is one header; a line with no ":" or an empty key is skipped rather than throwing, since
// this runs on every request and a stray blank line or typo shouldn't fail the whole turn. Only
// the first ":" splits key from value, so a value that itself contains one (e.g. a URL) survives.
export function parseExtraHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) {
    return {}
  }

  const headers: Record<string, string> = {}
  for (const line of raw.split("\n")) {
    const separatorIndex = line.indexOf(":")
    if (separatorIndex === -1) {
      continue
    }

    const key = line.slice(0, separatorIndex).trim()
    const value = line.slice(separatorIndex + 1).trim()
    if (key) {
      headers[key] = value
    }
  }

  return headers
}

// stripMarkdownFence removes optional ```json or ``` wrappers that models add despite instructions.
function stripMarkdownFence(content: string): string {
  return content.replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/s, "$1").trim()
}

// extractFencedJson finds a fenced JSON block even when prose surrounds it.
function extractFencedJson(content: string): string | null {
  const match = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/s)
  return match ? match[1].trim() : null
}

// extractEmbeddedJson uses the final object-looking segment when a model prefixes reasoning.
function extractEmbeddedJson(content: string): string | null {
  const start = content.lastIndexOf("{")
  return start === -1 ? null : content.slice(start).trim()
}

// parseAgentPrediction extracts the single supported prediction payload from final model content.
export function parseAgentPrediction(content: string | undefined): MoveAction[] | null {
  if (!content) {
    return null
  }

  const isPredictedMove = (move: unknown): move is MoveAction => {
    return typeof move === "string" && isMoveAction({ type: move } as MazeAction)
  }

  const candidates = [stripMarkdownFence(content), extractFencedJson(content), extractEmbeddedJson(content)]
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      const { moves } = JSON.parse(candidate) as AgentPredictionPayload
      if (Array.isArray(moves) && moves.length > 0 && moves.every(isPredictedMove)) {
        return [...moves]
      }
    } catch {
      // Try the next extraction strategy.
    }
  }

  return null
}

// normalizeToolArguments accepts object arguments and provider variants that encode them as JSON.
export function normalizeToolArguments(args: unknown): unknown {
  if (typeof args !== "string") {
    return args ?? {}
  }

  try {
    return JSON.parse(args) as unknown
  } catch {
    return args
  }
}

// serializeToolResult keeps all tool responses in the string form expected by chat APIs.
export function serializeToolResult(result: unknown): string {
  return typeof result === "string" ? result : JSON.stringify(result)
}

// compactLoggedToolResult rewrites a get_maze_structure result into the smallest form that still
// reconstructs the original exactly. get_maze_structure is by far the largest thing a turn logs -
// ~8 KB at the 41-entry maximum the historyWindowRadius allows - and the accumulated tool results
// are re-sent on every follow-up request in a turn, so the same history lands in the log two or
// three times over. sessionStorage is capped by the browser and shared with the round snapshot, so a
// log that outgrows it used to take the session's record down with it.
//
// Three changes, each reversing by arithmetic or by counting rather than by inference:
//   - openMoves becomes [[move, visitStatus], ...]. Each neighbour's row/col is the entry's own cell
//     plus that move's delta, so the coordinates are recomputed rather than stored. An array of
//     pairs rather than an object keeps the ordering explicit and reads the same in any language.
//   - every cell becomes [row, col]. Notation only; nothing is dropped.
//   - cellType goes. dead-end/corridor/junction is the openMoves count, and target-cell is a compare
//     against destinationCell, which is still in the payload. start-cell alone needs the level's
//     start position, which the level-start maze entry already records.
//
// The model still receives the expanded form: it is given the coordinates precisely so it does not
// have to do this arithmetic. This is the logged copy alone, and previewLoggedMessage checksums the
// original so any reconstruction can be proved byte-identical rather than merely plausible.
//
// Anything unparseable, or shaped differently from what is expected, is returned untouched rather
// than guessed at - a tool result that cannot be read is still evidence of what was sent.
type LoggedMazeStructure = {
  currentCell?: { row: number; col: number }
  filteredTraversalHistory?: {
    playerName?: string
    cell?: { row: number; col: number }
    openMoves?: Record<string, { visitStatus?: string }>
  }[]
}

function compactCell(cell: { row: number; col: number } | undefined): [number, number] | undefined {
  return cell ? [cell.row, cell.col] : undefined
}

function compactLoggedToolResult(content: string | undefined): string | undefined {
  if (!content || !content.includes("\"filteredTraversalHistory\"")) {
    return content
  }

  try {
    const parsed = JSON.parse(content) as LoggedMazeStructure
    if (!Array.isArray(parsed.filteredTraversalHistory)) {
      return content
    }

    // Built explicitly rather than spread: level, destinationCell and historyWindowRadius are fixed
    // for a level, so they are logged once by logAgentLevelStarted instead of on every request of
    // every turn - and level is on every log entry anyway. Constructing the object by hand means a
    // new field has to be considered here rather than riding along unnoticed.
    return JSON.stringify({
      currentCell: compactCell(parsed.currentCell),
      // cellType is dropped by rebuilding the entry from the fields that stay, rather than by
      // deleting it: an added field then has to be considered here instead of riding along unseen.
      filteredTraversalHistory: parsed.filteredTraversalHistory.map((entry) => ({
        playerName: entry.playerName,
        cell: compactCell(entry.cell),
        openMoves: Object.entries(entry.openMoves ?? {}).map(([move, neighbor]) => [move, neighbor?.visitStatus]),
      })),
    })
  } catch {
    return content
  }
}

// previewLoggedMessage trims only static prompt messages; request-specific context stays intact. The
// checksum is computed from the original, untrimmed content, so it stays stable across both the
// keepFull and preview cases and lets a downloaded log prove the content didn't drift mid-experiment
// or between games.
//
// Tool results are compacted rather than trimmed - see compactLoggedToolResult. They are the largest
// thing a turn writes, but they are also the record of what the model was actually shown, so the
// entries stay and only the fields a replay can regenerate are dropped.
export function previewLoggedMessage(
  message: AgentChatMessage,
  keepFull: boolean,
): AgentChatMessage & { content_checksum?: string } {
  if (message.role === "tool") {
    const compacted = compactLoggedToolResult(message.content)
    if (compacted === message.content) {
      return message
    }

    // Checksummed against the original: the compact form is lossy on paper, so the log still has to
    // be able to prove what was sent.
    return {
      ...message,
      content_checksum: checksumLoggedDescription(message.content),
      content: compacted,
    }
  }

  if (message.role !== "system" && message.role !== "user") {
    return message
  }

  return {
    ...message,
    content_checksum: checksumLoggedDescription(message.content),
    content: trimLoggedDescription(message.content, keepFull),
  }
}

// previewLoggedTool trims repeated tool descriptions while preserving short tool names. Same checksum
// rationale as previewLoggedMessage above.
export function previewLoggedTool(
  tool: object,
  keepFull: boolean,
): { name: string; description_checksum?: string; description: string | undefined } {
  const { function: fn } = tool as AgentToolDefinition
  return {
    name: fn.name,
    description_checksum: checksumLoggedDescription(fn.description),
    description: trimLoggedDescription(fn.description, keepFull),
  }
}
