import { describe, expect, it } from "vitest"

import {
  endpointLabel,
  normalizeToolArguments,
  parseAgentPrediction,
  parseExtraHeaders,
  previewLoggedMessage,
  previewLoggedTool,
  serializeToolResult,
} from "./protocol"
import { checksumLoggedDescription } from "../logs"
import type { AgentChatMessage, AgentToolDefinition } from "../types"

// Agent-config tests keep form validation separate from the larger agent control mode.
describe("agent protocol", () => {
  it("formats endpoint labels without query strings", () => {
    expect(endpointLabel(new URL("https://agents.example/move?token=secret"))).toBe(
      "https://agents.example/move",
    )
  })

  it("parses multi-line \"Key: Value\" text into a headers object", () => {
    expect(parseExtraHeaders("anthropic-version: 2023-06-01\nX-Wait-For-Model: true")).toEqual({
      "anthropic-version": "2023-06-01",
      "X-Wait-For-Model": "true",
    })
  })

  it("treats undefined or empty input as no headers", () => {
    expect(parseExtraHeaders(undefined)).toEqual({})
    expect(parseExtraHeaders("")).toEqual({})
  })

  it("skips blank lines and lines without a colon, rather than throwing", () => {
    expect(parseExtraHeaders("X-A: 1\n\nnot-a-header\nX-B: 2")).toEqual({
      "X-A": "1",
      "X-B": "2",
    })
  })

  it("splits only on the first colon, so a value containing one survives intact", () => {
    expect(parseExtraHeaders("X-Endpoint: https://example.com/path")).toEqual({
      "X-Endpoint": "https://example.com/path",
    })
  })

  it.each([
    ["bare json", "{\"moves\":[\"MoveRight\"]}", ["MoveRight"]],
    ["json fence", "```json\n{\"moves\":[\"MoveDown\"]}\n```", ["MoveDown"]],
    ["plain fence", "```\n{\"moves\":[\"MoveLeft\",\"MoveUp\"]}\n```", ["MoveLeft", "MoveUp"]],
    [
      "prose prefix with embedded json fence",
      [
        "Based on the current state:",
        "```json",
        "{\"moves\":[\"MoveLeft\",\"MoveDown\"]}",
        "```",
      ].join("\n"),
      ["MoveLeft", "MoveDown"],
    ],
    [
      "prose prefix with inline json",
      [
        "I should generally move toward the destination.",
        "{\"moves\":[\"MoveLeft\",\"MoveLeft\",\"MoveDown\"]}",
      ].join("\n"),
      ["MoveLeft", "MoveLeft", "MoveDown"],
    ],
  ])("parses valid predictions wrapped as %s", (_caseName, content, moves) => {
    expect(parseAgentPrediction(content)).toEqual(moves)
  })

  it.each([
    ["empty content", undefined],
    ["invalid json", "not-json"],
    ["missing moves", "{}"],
    ["empty moves", "{\"moves\":[]}"],
    ["unsupported move", "{\"moves\":[\"MoveSideways\"]}"],
  ])("rejects malformed predictions (%s)", (_caseName, content) => {
    expect(parseAgentPrediction(content)).toBeNull()
  })

  it("normalizes provider tool arguments and serializes tool results", () => {
    expect(normalizeToolArguments("{\"row\":1}")).toEqual({ row: 1 })
    expect(normalizeToolArguments("not-json")).toBe("not-json")
    expect(normalizeToolArguments(undefined)).toEqual({})
    expect(serializeToolResult({ ok: true })).toBe("{\"ok\":true}")
    expect(serializeToolResult("already serialized")).toBe("already serialized")
  })

  // Both forms in full, so what the compaction does is readable here rather than assembled from
  // object literals. Left is one real get_maze_structure result; right is what the log keeps.
  //
  // Dropped because a reader recomputes them:
  //   level                  - already stamped on every log entry
  //   destinationCell        - fixed per level, logged once by logAgentLevelStarted
  //   historyWindowRadius    - likewise
  //   cellType               - exit count gives dead-end/corridor/junction; target-cell is a
  //                            compare against destinationCell; start-cell is in the level entry
  //   each move's row/col    - the entry's own cell plus that move's delta
  //
  // Kept because nothing else records them: which cell, who first reached it, and each exit's
  // visitStatus - the one genuinely observed value in the whole payload.
  it("compacts a logged tool result to the fields a reader cannot recompute", () => {
    const original =
      "{\"level\":54,\"currentCell\":{\"row\":16,\"col\":0},\"destinationCell\":{\"row\":18,\"col\":21},\"historyWindowRadius\":4,\"filteredTraversalHistory\":[{\"playerName\":\"Self\",\"cell\":{\"row\":17,\"col\":0},\"cellType\":\"start-cell\",\"openMoves\":{\"MoveUp\":{\"row\":16,\"col\":0,\"visitStatus\":\"explored\"}}},{\"playerName\":\"Bumi\",\"cell\":{\"row\":16,\"col\":0},\"cellType\":\"corridor\",\"openMoves\":{\"MoveUp\":{\"row\":15,\"col\":0,\"visitStatus\":\"unvisited\"},\"MoveDown\":{\"row\":17,\"col\":0,\"visitStatus\":\"backtracking\"}}}]}"
    const originalChecksum = "0x44b258c3b72f4437"

    const compacted =
      "{\"currentCell\":[16,0],\"filteredTraversalHistory\":[{\"playerName\":\"Self\",\"cell\":[17,0],\"openMoves\":[[\"MoveUp\",\"explored\"]]},{\"playerName\":\"Bumi\",\"cell\":[16,0],\"openMoves\":[[\"MoveUp\",\"unvisited\"],[\"MoveDown\",\"backtracking\"]]}]}"

    const logged = previewLoggedMessage(
      { role: "tool", tool_call_id: "call_1", tool_name: "get_maze_structure", content: original },
      false,
    )

    expect(logged.content).toBe(compacted)
    // Checksummed against what was actually sent, since the logged form is lossy on its face.
    expect(logged.content_checksum).toBe(originalChecksum)
    // 472 -> 224 chars on this two-entry sample. The saving is what the change is for: this result
    // is re-sent on every follow-up request of a turn, against a sessionStorage budget shared with
    // the round snapshot, and a log that outgrew it used to take the session's record with it.
    expect(original).toHaveLength(472)
    expect(compacted).toHaveLength(224)
  })

  // The property the whole scheme rests on: the compaction is reversible from the logged line alone.
  // Each dropped coordinate is the entry's own cell plus the move's delta, so nothing outside the
  // log is needed - no maze, no replay. The checksum is taken from the original, so a reconstruction
  // can be proved byte-identical rather than merely plausible. This test performs that round trip.
  it("logs a tool result that can be expanded back to the original and verified by its checksum", () => {
    const original = JSON.stringify({
      level: 54,
      currentCell: { row: 16, col: 0 },
      destinationCell: { row: 18, col: 21 },
      historyWindowRadius: 4,
      filteredTraversalHistory: [
        {
          playerName: "Self",
          cell: { row: 17, col: 0 },
          cellType: "start-cell",
          openMoves: { MoveUp: { row: 16, col: 0, visitStatus: "explored" } },
        },
        {
          playerName: "Bumi",
          cell: { row: 16, col: 0 },
          cellType: "corridor",
          openMoves: {
            MoveUp: { row: 15, col: 0, visitStatus: "unvisited" },
            MoveDown: { row: 17, col: 0, visitStatus: "backtracking" },
          },
        },
      ],
    })

    const logged = previewLoggedMessage(
      { role: "tool", tool_call_id: "call_1", tool_name: "get_maze_structure", content: original },
      false,
    )

    // The reader's side: rebuild each neighbour from the entry's cell and the move direction.
    const deltas: Record<string, [number, number]> = {
      MoveUp: [-1, 0], MoveDown: [1, 0], MoveLeft: [0, -1], MoveRight: [0, 1],
    }
    const compacted = JSON.parse(logged.content ?? "") as {
      currentCell: [number, number]
      filteredTraversalHistory: {
        playerName: string
        cell: [number, number]
        openMoves: [string, string][]
      }[]
    }
    const pair = ([row, col]: [number, number]) => ({ row, col })
    // The per-level constants come from the level-start log entry, which records them once beside
    // the encoded maze; the reader supplies them here the same way.
    const expanded = {
      level: 54,
      currentCell: pair(compacted.currentCell),
      destinationCell: { row: 18, col: 21 },
      historyWindowRadius: 4,
      filteredTraversalHistory: compacted.filteredTraversalHistory.map((entry, index) => ({
        playerName: entry.playerName,
        cell: pair(entry.cell),
        // cellType is recomputed, not stored: the exit count gives dead-end/corridor/junction, and
        // target-cell is a compare against destinationCell, still in the payload. start-cell is the
        // one value needing the level's start position, which the level-start maze entry records -
        // stood in for here by the first entry, which is where this fixture's start cell sits.
        cellType: index === 0 ? "start-cell" : ["dead-end", "corridor"][entry.openMoves.length - 1],
        openMoves: Object.fromEntries(
          entry.openMoves.map(([move, visitStatus]) => {
            const [rowDelta, colDelta] = deltas[move]
            return [move, { row: entry.cell[0] + rowDelta, col: entry.cell[1] + colDelta, visitStatus }]
          }),
        ),
      })),
    }

    expect(JSON.stringify(expanded)).toBe(original)
    expect(checksumLoggedDescription(JSON.stringify(expanded))).toBe(logged.content_checksum)
  })

  // Anything not shaped like a maze-structure result is left exactly as it arrived rather than
  // guessed at - a tool result that cannot be parsed is still evidence.
  it("leaves an unparseable or differently shaped tool result untouched", () => {
    for (const content of ["not json at all", "{\"openMoves\":\"unexpected\"}", ""]) {
      const message = { role: "tool" as const, tool_call_id: "c", tool_name: "t", content }
      expect(previewLoggedMessage(message, false)).toEqual(message)
    }
  })

  it("previews static request diagnostics while keeping request-specific messages intact", () => {
    const staticMessage: AgentChatMessage = {
      role: "system",
      content: "This prompt is intentionally long enough to preview.",
    }
    const assistantMessage: AgentChatMessage = {
      role: "assistant",
      content: "This content stays complete.",
    }

    const expectedChecksum = checksumLoggedDescription(staticMessage.content)

    expect(previewLoggedMessage(staticMessage, false)).toEqual({
      ...staticMessage,
      content_checksum: expectedChecksum,
      content: `${staticMessage.content?.slice(0, 25)}...`,
    })
    expect(previewLoggedMessage(staticMessage, true)).toEqual({
      ...staticMessage,
      content_checksum: expectedChecksum,
    })
    expect(previewLoggedMessage(assistantMessage, false)).toEqual(assistantMessage)
  })

  it("previews tool descriptions while preserving tool names", () => {
    const tool: AgentToolDefinition = {
      type: "function",
      function: {
        name: "get_status",
        description: "This description is intentionally long enough to preview.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    }

    const expectedChecksum = checksumLoggedDescription(tool.function.description)

    expect(previewLoggedTool(tool, false)).toEqual({
      name: "get_status",
      description_checksum: expectedChecksum,
      description: `${tool.function.description.slice(0, 25)}...`,
    })
    expect(previewLoggedTool(tool, true)).toEqual({
      name: "get_status",
      description_checksum: expectedChecksum,
      description: tool.function.description,
    })
  })
})
