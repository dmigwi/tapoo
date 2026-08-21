import { describe, expect, it } from "vitest"

import { caseSequenceHash, compareHashSequences } from "../../parity-harness/bench-compare.mjs"

describe("compareHashSequences", () => {
  it("matches when every case's hash sequence is identical", () => {
    const goHashesByCase = new Map([
      ["area70_10x7", ["0xaaa", "0xbbb", "0xccc"]],
      ["area100_10x10", ["0x111", "0x222"]],
    ])
    const frontendHashesByCase = new Map([
      ["area70_10x7", ["0xaaa", "0xbbb", "0xccc"]],
      ["area100_10x10", ["0x111", "0x222"]],
    ])

    const result = compareHashSequences(goHashesByCase, frontendHashesByCase)

    expect(result.matched).toBe(true)
    expect(result.firstMismatch).toBeNull()
    expect(result.mismatchByCase.size).toBe(0)
    expect(result.unmatchedCases).toEqual([])
  })

  // This is the proof the check is actually sensitive to a slight deviation, not just to gross
  // mismatches: every sample in every case is identical except a single hash in the middle of one
  // case's sequence. A check that only ever separates wildly-different runs could pass here even
  // with a bug that's far too lenient — this is what rules that out.
  it("fails on a single differing sample in one case, out of many identical ones", () => {
    const goHashesByCase = new Map([
      ["area70_10x7", ["0xaaa", "0xbbb", "0xccc"]],
      ["area100_10x10", ["0x111", "0x222", "0x333"]],
      ["area400_20x20", ["0xd1", "0xd2", "0xd3"]],
    ])
    const frontendHashesByCase = new Map([
      ["area70_10x7", ["0xaaa", "0xbbb", "0xccc"]],
      // Only sample #1 ("0x222") differs — everything else, in every case, matches exactly.
      ["area100_10x10", ["0x111", "0xDIFFERENT", "0x333"]],
      ["area400_20x20", ["0xd1", "0xd2", "0xd3"]],
    ])

    const result = compareHashSequences(goHashesByCase, frontendHashesByCase)

    expect(result.matched).toBe(false)
    expect(result.firstMismatch).toEqual({
      case: "area100_10x10",
      index: 1,
      goHash: "0x222",
      frontendHash: "0xDIFFERENT",
    })
    // Only the one case with the deviation is flagged — the two untouched cases are proof the check
    // does not over-fire across the whole run just because one case had a problem.
    expect([...result.mismatchByCase.keys()]).toEqual(["area100_10x10"])
    expect(result.mismatchByCase.get("area100_10x10")).toEqual({ mismatches: 1, total: 3 })
  })

  it("flags a case present in only one side as unmatched rather than silently skipping it", () => {
    const goHashesByCase = new Map([
      ["area70_10x7", ["0xaaa"]],
      ["area100_10x10", ["0x111"]],
    ])
    const frontendHashesByCase = new Map([["area70_10x7", ["0xaaa"]]])

    const result = compareHashSequences(goHashesByCase, frontendHashesByCase)

    expect(result.matched).toBe(false)
    expect(result.unmatchedCases).toEqual(["area100_10x10 — missing from TypeScript"])
  })
})

describe("caseSequenceHash", () => {
  it("returns a 0x-prefixed 16-hex-digit hash, deterministically for the same sequence", () => {
    const hashes = ["0xaaa", "0xbbb", "0xccc"]

    const first = caseSequenceHash(hashes)
    const second = caseSequenceHash(hashes)

    expect(first).toBe(second)
    expect(first).toMatch(/^0x[0-9a-f]{16}$/)
  })

  // Same sensitivity proof as compareHashSequences above, but for the compact per-case value that
  // actually gets displayed in the report tables: a one-sample difference must still change it.
  it("differs when a single sample in the sequence changes", () => {
    const original = ["0xaaa", "0xbbb", "0xccc"]
    const oneSampleChanged = ["0xaaa", "0xDIFFERENT", "0xccc"]

    expect(caseSequenceHash(oneSampleChanged)).not.toBe(caseSequenceHash(original))
  })
})
