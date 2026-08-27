import { describe, it } from "vitest"

import {
  generateMaze,
  generateMazeArea,
  getMazeDimensions,
  getNavigationProfile,
} from "../app/maze"
import type { PRNGGenerator } from "../app/maze"
import { MOVE_DELTAS, createMazeDimensions, openMovesFromCell } from "../app/traversal"
import type { BaseDimensions, LevelDimensions, NavigationProfile } from "../app/types"
import { mazeAdjacencyHash } from "./adjacency"

// createXorshift128Generator is the same algorithm as app/maze.test.ts's createXorshift128Generator
// and maze/maze_test.go's Go port (standard 4-word xorshift128) - duplicated here rather than
// imported from a .test.ts file, so this benchmark generates the exact same reproducible sequence of
// mazes on every run, isolating whatever a before/after comparison measures from run-to-run
// maze-shape noise instead of that noise coming from crypto.getRandomValues on every sample.
function createXorshift128Generator(seed: number): PRNGGenerator {
  let [x, y, z, w] = [seed || 1, 362436069, 521288629, 88675123]

  return (limit: number): number => {
    if (limit <= 0) {
      return 0
    }

    const t = x ^ (x << 11)
    x = y
    y = z
    z = w
    w = (w ^ (w >>> 19)) ^ (t ^ (t >>> 8))
    return (w >>> 0) % limit
  }
}

type BranchingCase = {
  name: string
  numCols: number
  numRows: number
}

type BranchingSample = {
  adjacencyHash: string
  deadEnds: number
  deadEndsPerCell: number
  degree3: number
  degree4: number
  junctions: number
  junctionsPerCell: number
  pathLength: number
  backtrackCells: number
  worstBranch: number
  validStructure: boolean
}

type BranchingSummary = {
  "Case": string
  "Level": number
  // Numeric shape-fit encoding shared with maze/bench; bench-report.mjs renders the label.
  "Preferred": number
  "Bias": number
  "Max corridor": number
  "Junctions/maze": string
  "Deg3/maze": string
  "Deg4/maze": string
  "%Deg4": string
  "Zero-J%": string
  "Dead ends/maze": string
  "Junctions/cell": string
  "p5": string
  "p95": string
  "stddev": string
  "Dead ends/cell": string
  "PathLen": string
  "Path-p5": string
  "Path-p95": string
  "Path%": string
  "Backtrack": string
  "Backtrack-p5": string
  "Backtrack-p95": string
  "WorstBranch": string
  "WorstBranch-p5": string
  "WorstBranch-p95": string
  "Budget": number
  "Headroom": string
  "Conservative": string
  "Runs": number
}

// benchmarkWarmupIterations is capped at the sample count so a small local run is not dominated by
// warm-up, and is otherwise enough calls for V8 to tier up the generation path before timing starts.
const benchmarkWarmupIterations = 20
const benchmarkTimeoutMs = 120_000
const benchmarkJsonMarker = "TAPOO_BENCH_REPORT:"
const benchmarkProcess =
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process
const benchmarkIterations = configuredBenchmarkIterations()
const benchmarkSeed = configuredBenchmarkSeed()
const benchmarkJsonOutput =
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.TAPOO_BENCH_JSON === "1"

function configuredBenchmarkIterations(): number {
  const configuredValue = benchmarkProcess?.env?.TAPOO_BENCH_ITERATIONS
  const iterations = Number(configuredValue)
  if (Number.isInteger(iterations) && iterations > 0) {
    return iterations
  }

  throw new Error(
    `TAPOO_BENCH_ITERATIONS must be provided as a positive integer, got: ${configuredValue}`,
  )
}

// configuredBenchmarkSeed reads the shared cross-language seed parity-harness/bench-report.mjs derives and
// forwards to both ports each run, so the same maze sequence is generated on both sides. Defaults to
// 1 so this benchmark still runs deterministically when invoked directly (vitest run --config
// vitest.bench.config.ts) without going through the parity-harness report entrypoint.
function configuredBenchmarkSeed(): number {
  const configuredValue = benchmarkProcess?.env?.TAPOO_BENCH_SEED
  if (!configuredValue) {
    return 1
  }

  const seed = Number(configuredValue)
  if (Number.isInteger(seed)) {
    return seed
  }

  throw new Error(`TAPOO_BENCH_SEED must be an integer, got: ${configuredValue}`)
}

function branchingShapes(): BranchingCase[] {
  return [
    // Areas carrying several shapes are skew ladders: same area means the same navigation profile,
    // so the whole profile is pinned and only the aspect ratio moves. Any spread within a ladder is
    // grid geometry acting alone. The ladders sit at four points down the bias range (100, 57, 28,
    // 0) because the shape effect is not constant - it is largest where the bias is working hardest
    // to suppress branching, and nearly absent once the bias is off.
    { name: "area70_10x7", numCols: 10, numRows: 7 },
    { name: "area70_7x10", numCols: 7, numRows: 10 },

    { name: "area100_10x10", numCols: 10, numRows: 10 },
    { name: "area100_20x5", numCols: 20, numRows: 5 },
    { name: "area100_25x4", numCols: 25, numRows: 4 },
    { name: "area100_50x2", numCols: 50, numRows: 2 },

    { name: "area130_13x10", numCols: 13, numRows: 10 },

    { name: "area180_18x10", numCols: 18, numRows: 10 },

    { name: "area280_40x7", numCols: 40, numRows: 7 },
    { name: "area280_20x14", numCols: 20, numRows: 14 },

    { name: "area400_20x20", numCols: 20, numRows: 20 },
    { name: "area400_40x10", numCols: 40, numRows: 10 },
    { name: "area400_80x5", numCols: 80, numRows: 5 },
    { name: "area400_100x4", numCols: 100, numRows: 4 },

    { name: "area500_25x20", numCols: 25, numRows: 20 },

    { name: "area600_25x24", numCols: 25, numRows: 24 },
    { name: "area600_30x20", numCols: 30, numRows: 20 },
    { name: "area600_60x10", numCols: 60, numRows: 10 },

    { name: "area750_30x25", numCols: 30, numRows: 25 },

    { name: "area900_30x30", numCols: 30, numRows: 30 },
    { name: "area900_45x20", numCols: 45, numRows: 20 },
    { name: "area900_60x15", numCols: 60, numRows: 15 },
    { name: "area900_90x10", numCols: 90, numRows: 10 },
    { name: "area900_150x6", numCols: 150, numRows: 6 },

    { name: "area1100_44x25", numCols: 44, numRows: 25 },

    { name: "area1260_42x30", numCols: 42, numRows: 30 },

    { name: "area1500_50x30", numCols: 50, numRows: 30 },

    { name: "area1600_40x40", numCols: 40, numRows: 40 },
    { name: "area1600_80x20", numCols: 80, numRows: 20 },
    { name: "area1600_160x10", numCols: 160, numRows: 10 },
    { name: "area1600_400x4", numCols: 400, numRows: 4 },

    // sensitivityCaseName (same literal name as maze/bench/levels_bench_test.go's constant) runs
    // through this exact same sweep with no special handling on this side - it uses the same shared
    // benchmarkSeed as every other case. Go deliberately offsets its own seed for this one name only,
    // so the two sides are expected to generate genuinely different mazes here - proving, with two
    // real, independent generation runs rather than an edited hash, that parity-harness/bench-report.mjs's
    // comparison actually detects real divergence when it occurs.
    { name: "sensitivity_area25_5x5", numCols: 5, numRows: 5 },
  ]
}

// levelForArea finds the game level whose target area matches this case, by asking the production
// function rather than restating seed and diff. A case that stops matching any level means the area
// formula moved, which is worth seeing in the table rather than discovering later.
function levelForArea(area: number): number {
  for (let level = 1; level <= 10_000; level += 1) {
    const target = generateMazeArea(level)
    if (target === area) {
      return level
    }

    if (target > area) {
      break
    }
  }

  return 0
}

// Shape-fit statuses, mirroring the constants of the same names in maze/bench. Numbers rather than
// labels because Go can only report float64 metrics, and one shared encoding means the labels are
// spelled once, in bench-report.mjs's shapeFitLabel, instead of once per port.
const SHAPE_TOO_BIG = -1
const SHAPE_FITS = 0
const SHAPE_IS_SELECTED = 1

// baseViewport mirrors baseViewport in maze/bench: a 16-inch display, 3456x2234 physical px, at
// devicePixelRatio 2 and the page's measured PT Mono metrics (ten characters about 60 CSS px, one
// text row about 11 CSS px), reduced through the terminal's insets and scales to a cell grid. The
// two ports must name the same display or their Preferred columns describe different machines.
const baseViewport = { numCols: 70, numRows: 45 }

// shapeFitStatus asks the production selector what baseViewport would do with this grid's level,
// rather than restating the squarest-fit rule in the report: a third copy of that rule would keep
// agreeing with itself after this one changed. Three outcomes - the level does not fit this
// display, it fits but the selector picks a different shape, or it is the shape the selector picks.
// Orientation counts: accepting a rotation marked both 10x7 and 7x10 as selected for area 70, which
// contradicts the column naming one shape.
//
// Kept branch-for-branch identical to shapeFitStatus in maze/bench, including the order the checks
// run in, so that any disagreement between the two Preferred columns comes from the selectors
// themselves rather than from the two benchmarks asking different questions. The parity run asserts
// they agree per case.
function shapeFitStatus(numCols: number, numRows: number): number {
  const level = levelForArea(numCols * numRows)
  if (level === 0) {
    return SHAPE_FITS
  }

  const selected = getMazeDimensions(level, baseViewport)
  if (!selected) {
    return SHAPE_TOO_BIG
  }

  if (selected.numCols === numCols && selected.numRows === numRows) {
    return SHAPE_IS_SELECTED
  }

  const fits =
    (numCols <= baseViewport.numCols && numRows <= baseViewport.numRows) ||
    (numRows <= baseViewport.numCols && numCols <= baseViewport.numRows)

  return fits ? SHAPE_FITS : SHAPE_TOO_BIG
}

function createLevelDimensions(level: number, dimensions: BaseDimensions): LevelDimensions {
  return { ...createMazeDimensions(dimensions), level }
}

function measureBranching(
  dimensions: LevelDimensions,
  profile: NavigationProfile,
  generator: PRNGGenerator,
): BranchingSample {
  const round = generateMaze(dimensions, 1, profile, generator)
  const { maze } = round
  let deadEnds = 0
  let junctions = 0
  let degree3 = 0
  let degree4 = 0

  for (let row = 0; row < dimensions.numRows; row += 1) {
    for (let col = 0; col < dimensions.numCols; col += 1) {
      const exits = openMovesFromCell(maze, { row, col }).length
      if (exits === 3) {
        junctions += 1
        degree3 += 1
      } else if (exits === 4) {
        junctions += 1
        degree4 += 1
      } else if (exits === 1) {
        deadEnds += 1
      }
    }
  }

  const navigation = measureNavigationBurden(maze, dimensions, round.startPosition, round.finalPosition)
  return {
    adjacencyHash: mazeAdjacencyHash(maze, dimensions),
    deadEnds,
    deadEndsPerCell: deadEnds / dimensions.area,
    degree3,
    degree4,
    junctions,
    junctionsPerCell: junctions / dimensions.area,
    pathLength: navigation.pathLength,
    backtrackCells: navigation.backtrackCells,
    worstBranch: navigation.worstBranch,
    validStructure: validMazeStructure(maze, dimensions),
  }
}

function summarize(values: number[]): { high: number; low: number; mean: number; stddev: number } {
  if (values.length === 0) {
    return { high: 0, low: 0, mean: 0, stddev: 0 }
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance =
    values.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) /
    values.length
  const sorted = [...values].sort((left, right) => left - right)

  return {
    high: sorted[Math.floor(values.length * 0.95)],
    low: sorted[Math.floor(values.length * 0.05)],
    mean,
    stddev: Math.sqrt(variance),
  }
}

function formatMetric(value: number): string {
  return value.toPrecision(4)
}

function runBranchingCase(
  name: string,
  dimensions: LevelDimensions,
  profile: NavigationProfile,
): { hashes: string[]; summary: BranchingSummary; validation: { failures: number; total: number } } {
  // generator is seeded once per case and reused across every warm-up/timed sample. benchmarkSeed is
  // the shared seed parity-harness/bench-report.mjs derives and forwards to both ports each run, so a
  // repeated run generates the exact same sequence of mazes as the matching Go run for this case.
  const generator = createXorshift128Generator(benchmarkSeed)

  // Discarded warm-up, so no case is privileged by running later in the sweep.
  const warmupCount = Math.min(benchmarkWarmupIterations, benchmarkIterations)
  for (let warmup = 0; warmup < warmupCount; warmup += 1) {
    measureBranching(dimensions, profile, generator)
  }

  const samples: BranchingSample[] = []

  for (let sampleIndex = 0; sampleIndex < benchmarkIterations; sampleIndex += 1) {
    samples.push(measureBranching(dimensions, profile, generator))
  }

  const junctions = summarize(samples.map((sample) => sample.junctionsPerCell))
  const deadEnds = summarize(samples.map((sample) => sample.deadEndsPerCell))
  const junctionCounts = summarize(samples.map((sample) => sample.junctions))
  const deadEndCounts = summarize(samples.map((sample) => sample.deadEnds))
  const degree3Counts = summarize(samples.map((sample) => sample.degree3))
  const degree4Counts = summarize(samples.map((sample) => sample.degree4))
  const degree4Pct =
    junctionCounts.mean > 0 ? (degree4Counts.mean / junctionCounts.mean) * 100 : 0
  const zeroJunctionPct =
    (samples.filter((sample) => sample.junctions === 0).length / samples.length) * 100
  const pathLengths = summarize(samples.map((sample) => sample.pathLength))
  const backtrackCells = summarize(samples.map((sample) => sample.backtrackCells))
  const worstBranches = summarize(samples.map((sample) => sample.worstBranch))
  const structuralFailures = samples.filter((sample) => !sample.validStructure).length

  // Key order is display order: console.table renders keys as inserted, and the parity-harness report mirrors
  // this order for the Go side so the two tables read down the same columns.
  return {
    hashes: samples.map((sample) => sample.adjacencyHash),
    summary: {
      "Case": name,
      "Level": levelForArea(dimensions.area),
      // The raw encoding, exactly as Go reports it. bench-report.mjs turns it into a label for both
      // ports in one place, so neither port can spell a status differently from the other.
      "Preferred": shapeFitStatus(dimensions.numCols, dimensions.numRows),
      "Bias": profile.__leastNeighborsBias,
      "Max corridor": profile.__maxCorridorLength,
      "Junctions/maze": formatMetric(junctionCounts.mean),
      "Deg3/maze": formatMetric(degree3Counts.mean),
      "Deg4/maze": formatMetric(degree4Counts.mean),
      "%Deg4": formatMetric(degree4Pct),
      "Zero-J%": formatMetric(zeroJunctionPct),
      "Dead ends/maze": formatMetric(deadEndCounts.mean),
      "Junctions/cell": formatMetric(junctions.mean),
      "p5": formatMetric(junctions.low),
      "p95": formatMetric(junctions.high),
      "stddev": formatMetric(junctions.stddev),
      "Dead ends/cell": formatMetric(deadEnds.mean),
      "PathLen": formatMetric(pathLengths.mean),
      "Path-p5": formatMetric(pathLengths.low),
      "Path-p95": formatMetric(pathLengths.high),
      "Path%": formatMetric((pathLengths.mean / dimensions.area) * 100),
      "Backtrack": formatMetric(backtrackCells.mean),
      "Backtrack-p5": formatMetric(backtrackCells.low),
      "Backtrack-p95": formatMetric(backtrackCells.high),
      "WorstBranch": formatMetric(worstBranches.mean),
      "WorstBranch-p5": formatMetric(worstBranches.low),
      "WorstBranch-p95": formatMetric(worstBranches.high),
      "Budget": dimensions.area,
      "Headroom": formatMetric(dimensions.area - pathLengths.mean),
      "Conservative": conservativeLabel(dimensions.area - pathLengths.mean),
      "Runs": benchmarkIterations,
    },
    validation: {
      failures: structuralFailures,
      total: samples.length,
    },
  }
}

function measureNavigationBurden(
  maze: string[][],
  dimensions: LevelDimensions,
  startPosition: { x: number; y: number },
  finalPosition: { x: number; y: number },
): { backtrackCells: number; pathLength: number; worstBranch: number } {
  const startCell = cellKey(cellFromGridPoint(startPosition))
  const finalCell = cellKey(cellFromGridPoint(finalPosition))
  const pathCells = pathBetweenCells(maze, startCell, finalCell)
  const onPath = new Set(pathCells)

  return {
    backtrackCells: dimensions.area - pathCells.length,
    pathLength: pathCells.length,
    worstBranch: worstOffPathBranch(maze, dimensions, onPath),
  }
}

function cellFromGridPoint(point: { x: number; y: number }): { col: number; row: number } {
  return {
    row: Math.floor((point.y - 1) / 2),
    col: Math.floor((point.x - 1) / 2),
  }
}

function cellKey(cell: { col: number; row: number }): string {
  return `${cell.row},${cell.col}`
}

function cellFromKey(key: string): { col: number; row: number } {
  const [row, col] = key.split(",").map(Number)
  return { row, col }
}

function openNeighborKeys(maze: string[][], cellKeyValue: string): string[] {
  const cell = cellFromKey(cellKeyValue)
  return openMovesFromCell(maze, cell).map((move) => {
    const [rowDelta, colDelta] = MOVE_DELTAS[move]
    return cellKey({ row: cell.row + rowDelta, col: cell.col + colDelta })
  })
}

function pathBetweenCells(maze: string[][], startCell: string, finalCell: string): string[] {
  const parent = new Map<string, string | null>([[startCell, null]])
  const queue = [startCell]

  for (let index = 0; index < queue.length; index += 1) {
    const cell = queue[index]
    if (cell === finalCell) {
      break
    }
    for (const neighbor of openNeighborKeys(maze, cell)) {
      if (parent.has(neighbor)) {
        continue
      }
      parent.set(neighbor, cell)
      queue.push(neighbor)
    }
  }

  const path: string[] = []
  for (let cell: string | null | undefined = finalCell; cell; cell = parent.get(cell)) {
    path.push(cell)
    if (cell === startCell) {
      break
    }
  }
  return path
}

function worstOffPathBranch(
  maze: string[][],
  dimensions: LevelDimensions,
  onPath: Set<string>,
): number {
  let worstBranch = 0
  const seen = new Set<string>()

  for (let row = 0; row < dimensions.numRows; row += 1) {
    for (let col = 0; col < dimensions.numCols; col += 1) {
      const pathCell = cellKey({ row, col })
      if (!onPath.has(pathCell)) {
        continue
      }
      for (const neighbor of openNeighborKeys(maze, pathCell)) {
        if (onPath.has(neighbor) || seen.has(neighbor)) {
          continue
        }
        worstBranch = Math.max(worstBranch, offPathBranchDepth(maze, neighbor, onPath, seen))
      }
    }
  }

  return worstBranch
}

function offPathBranchDepth(
  maze: string[][],
  root: string,
  onPath: Set<string>,
  seen: Set<string>,
): number {
  let maxDepth = 0
  const queue = [{ cell: root, depth: 1 }]
  seen.add(root)

  for (let index = 0; index < queue.length; index += 1) {
    const { cell, depth } = queue[index]
    maxDepth = Math.max(maxDepth, depth)

    for (const neighbor of openNeighborKeys(maze, cell)) {
      if (onPath.has(neighbor) || seen.has(neighbor)) {
        continue
      }
      seen.add(neighbor)
      queue.push({ cell: neighbor, depth: depth + 1 })
    }
  }

  return maxDepth
}

function conservativeLabel(headroom: number): string {
  if (headroom < 0) {
    return "infeasible"
  }
  if (headroom === 0) {
    return "marginal"
  }
  return "feasible"
}

function validMazeStructure(maze: string[][], dimensions: LevelDimensions): boolean {
  let edges = 0
  const visited = new Set<string>(["0,0"])
  const queue = [{ row: 0, col: 0 }]

  for (let row = 0; row < dimensions.numRows; row += 1) {
    for (let col = 0; col < dimensions.numCols; col += 1) {
      const exits = openMovesFromCell(maze, { row, col })
      for (const move of exits) {
        const [rowDelta, colDelta] = MOVE_DELTAS[move]
        const exit = { row: row + rowDelta, col: col + colDelta }
        if (
          exit.row < 0 ||
          exit.col < 0 ||
          exit.row >= dimensions.numRows ||
          exit.col >= dimensions.numCols
        ) {
          return false
        }
        if (exit.row === row && exit.col === col + 1) {
          edges += 1
        }
        if (exit.row === row + 1 && exit.col === col) {
          edges += 1
        }
      }
    }
  }

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]
    for (const move of openMovesFromCell(maze, current)) {
      const [rowDelta, colDelta] = MOVE_DELTAS[move]
      const exit = { row: current.row + rowDelta, col: current.col + colDelta }
      const key = `${exit.row},${exit.col}`
      if (visited.has(key)) {
        continue
      }
      visited.add(key)
      queue.push(exit)
    }
  }

  return edges === dimensions.area - 1 && visited.size === dimensions.area
}

// logBenchmarkSummaries prints the descriptive per-case tables (shape/bias/branching-density figures
// unrelated to cross-language comparison) and, in JSON mode, includes each case's full hash sequence
// so parity-harness/bench-report.mjs can assert Go and TypeScript produced byte-identical mazes sample for
// sample - the hashes are kept out of the printed table itself so it stays readable.
function logBenchmarkSummaries(
  title: string,
  summaries: BranchingSummary[],
  hashesByCase: Record<string, string[]>,
  validationByCase: Record<string, { failures: number; total: number }>,
): void {
  if (benchmarkJsonOutput) {
    console.info(
      `${benchmarkJsonMarker}${JSON.stringify({
        hashesByCase,
        iterations: benchmarkIterations,
        seed: benchmarkSeed,
        summaries,
        title,
        validationByCase,
      })}`,
    )

    return
  }

  console.info(`\n${title}`)
  console.info(`Each case runs ${benchmarkIterations} maze generations. Seed: ${benchmarkSeed}.`)
  console.table(summaries)
}

// Only the derived profile is swept. Area and bias both follow from the level, so sweeping them
// independently would report combinations no round can reach - and a number that cannot occur in
// production cannot be used to judge production. Attribution to the bias alone lives in
// maze.test.ts, as an assertion at a fixed grid rather than a metric reported every run.
describe("Maze branching benchmarks", () => {
  it("reports branching by shape", () => {
    const results = branchingShapes().map((benchCase) => {
      const dimensions = createLevelDimensions(1, {
        numCols: benchCase.numCols,
        numRows: benchCase.numRows,
      })

      return runBranchingCase(
        benchCase.name,
        dimensions,
        getNavigationProfile(dimensions),
      )
    })

    logBenchmarkSummaries(
      "BenchmarkMazeBranching",
      results.map((result) => result.summary),
      Object.fromEntries(results.map((result) => [result.summary.Case, result.hashes])),
      Object.fromEntries(
        results.map((result) => [
          result.summary.Case,
          result.validation,
        ]),
      ),
    )
  }, benchmarkTimeoutMs)
})
