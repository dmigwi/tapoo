// Pure comparison logic for the maze-branching benchmark report, split out of the parity-harness
// report entrypoint so it can be unit-tested directly without spawning Go/vitest subprocesses.

// caseSequenceHash reduces one case's full per-sample hash list to a single value comparable at a
// glance between the Go and TypeScript tables - the same fnv1a64 algorithm used everywhere else in
// this codebase (frontend/app/logs.ts's fnv1a64Checksum, maze/bench/levels_bench_test.go's
// mazeAdjacencyHash), applied over the concatenation of a case's own sample hashes rather than a
// maze's decoded adjacency. Equal per-case hashes here are exactly as strong a signal as the full
// elementwise sequence comparison compareHashSequences performs - this is just a compact, plottable
// stand-in for the same underlying data, not a separate or weaker check.
export function caseSequenceHash(hashes) {
  const offsetBasis = 0xcbf29ce484222325n // resolves to 14695981039346656037
  const prime = 0x100000001b3n            // resolves to 1099511628211

  let hash = offsetBasis
  for (const byte of Buffer.from(hashes.join(""), "utf8")) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * prime)
  }
  return `0x${hash.toString(16).padStart(16, "0")}`
}

// compareHashSequences is the actual equality check: with a shared seed, Go and TypeScript must
// produce byte-for-byte identical mazes sample for sample, not just similar aggregate statistics -
// equal aggregate means are strong evidence, not proof, since two different maze sets can share
// summary statistics. This is a boolean assertion, not a tolerance-band threshold: a threshold that
// can never fire (the old z-score check, vestigial once the generator was shared - every reported z
// was 0) is worse than no threshold, since it looks like a safeguard while doing nothing.
export function compareHashSequences(goHashesByCase, frontendHashesByCase) {
  const unmatchedCases = []

  for (const caseName of goHashesByCase.keys()) {
    if (!frontendHashesByCase.has(caseName)) {
      unmatchedCases.push(`${caseName} - missing from TypeScript`)
    }
  }
  for (const caseName of frontendHashesByCase.keys()) {
    if (!goHashesByCase.has(caseName)) {
      unmatchedCases.push(`${caseName} - missing from Go`)
    }
  }

  if (unmatchedCases.length > 0) {
    return {
      caseCount: goHashesByCase.size,
      firstMismatch: null,
      matched: false,
      mismatchByCase: new Map(),
      unmatchedCases,
    }
  }

  let firstMismatch = null
  const mismatchByCase = new Map()

  for (const caseName of goHashesByCase.keys()) {
    const goHashes = goHashesByCase.get(caseName)
    const frontendHashes = frontendHashesByCase.get(caseName)
    const total = Math.max(goHashes.length, frontendHashes.length)
    const sampleCount = Math.min(goHashes.length, frontendHashes.length)
    let mismatches = total - sampleCount

    for (let index = 0; index < sampleCount; index += 1) {
      if (goHashes[index] === frontendHashes[index]) {
        continue
      }

      mismatches += 1
      firstMismatch ??= {
        case: caseName,
        frontendHash: frontendHashes[index],
        goHash: goHashes[index],
        index,
      }
    }

    if (mismatches > 0) {
      mismatchByCase.set(caseName, { mismatches, total })
    }
  }

  return {
    caseCount: goHashesByCase.size,
    firstMismatch,
    matched: !firstMismatch,
    mismatchByCase,
    unmatchedCases,
  }
}
