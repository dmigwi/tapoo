import { describe, it } from "vitest"

import {
  generateMaze,
  generateMazeArea,
  getMazeDimensions,
  getNavigationProfile,
} from "../app/maze"
import { createMazeDimensions, openMovesFromCell } from "../app/traversal"
import type { BaseDimensions, LevelDimensions, NavigationProfile } from "../app/types"

type BranchingCase = {
  name: string
  numCols: number
  numRows: number
}

type BranchingSample = {
  deadEndsPerCell: number
  junctionsPerCell: number
}

type BranchingSummary = {
  "Case": string
  "Level": number
  "Preferred": string
  "Bias": number
  "Max corridor": number
  "Junctions/cell": string
  "p5": string
  "p95": string
  "stddev": string
  "Dead ends/cell": string
  "ns/op": string
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

function branchingShapes(): BranchingCase[] {
  return [
    // Areas carrying several shapes are skew ladders: same area means the same navigation profile,
    // so the whole profile is pinned and only the aspect ratio moves. Any spread within a ladder is
    // grid geometry acting alone. The ladders sit at four points down the bias range (100, 57, 28,
    // 0) because the shape effect is not constant — it is largest where the bias is working hardest
    // to suppress branching, and nearly absent once the bias is off.
    { name: "area70_10x7", numCols: 10, numRows: 7 },
    { name: "area70_7x10", numCols: 7, numRows: 10 },

    { name: "area100_10x10", numCols: 10, numRows: 10 },
    { name: "area100_20x5", numCols: 20, numRows: 5 },
    { name: "area100_25x4", numCols: 25, numRows: 4 },
    { name: "area100_50x2", numCols: 50, numRows: 2 },

    { name: "area280_40x7", numCols: 40, numRows: 7 },
    { name: "area280_20x14", numCols: 20, numRows: 14 },

    { name: "area400_20x20", numCols: 20, numRows: 20 },
    { name: "area400_40x10", numCols: 40, numRows: 10 },
    { name: "area400_80x5", numCols: 80, numRows: 5 },
    { name: "area400_100x4", numCols: 100, numRows: 4 },

    { name: "area600_25x24", numCols: 25, numRows: 24 },
    { name: "area600_30x20", numCols: 30, numRows: 20 },
    { name: "area600_60x10", numCols: 60, numRows: 10 },

    { name: "area900_30x30", numCols: 30, numRows: 30 },
    { name: "area900_60x15", numCols: 60, numRows: 15 },
    { name: "area900_90x10", numCols: 90, numRows: 10 },
    { name: "area900_150x6", numCols: 150, numRows: 6 },

    { name: "area1600_40x40", numCols: 40, numRows: 40 },
    { name: "area1600_80x20", numCols: 80, numRows: 20 },
    { name: "area1600_160x10", numCols: 160, numRows: 10 },
    { name: "area1600_400x4", numCols: 400, numRows: 4 },
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

// roomyViewport is large enough that getMazeDimensions is never constrained by screen room, so what
// it returns is the shape the selector prefers on merit rather than the best that happened to fit.
const roomyViewport = { numCols: 500, numRows: 500 }

// isPreferredShape asks the production selector whether this is the grid a level would actually be
// given. It is answered here, in TypeScript, rather than by restating the squarest-fit rule in the
// report: a third copy of that rule would keep agreeing with itself after this one changed.
function isPreferredShape(numCols: number, numRows: number): boolean {
  const level = levelForArea(numCols * numRows)
  if (level === 0) {
    return false
  }

  const selected = getMazeDimensions(level, roomyViewport)
  if (!selected) {
    return false
  }

  return (
    (selected.numCols === numCols && selected.numRows === numRows) ||
    (selected.numCols === numRows && selected.numRows === numCols)
  )
}

function createLevelDimensions(level: number, dimensions: BaseDimensions): LevelDimensions {
  return { ...createMazeDimensions(dimensions), level }
}

function measureBranching(
  dimensions: LevelDimensions,
  profile: NavigationProfile,
): BranchingSample {
  const { maze } = generateMaze(dimensions, 1, profile)
  let deadEnds = 0
  let junctions = 0

  for (let row = 0; row < dimensions.numRows; row += 1) {
    for (let col = 0; col < dimensions.numCols; col += 1) {
      const exits = openMovesFromCell(maze, { row, col }).length
      if (exits >= 3) {
        junctions += 1
      } else if (exits === 1) {
        deadEnds += 1
      }
    }
  }

  return {
    deadEndsPerCell: deadEnds / dimensions.area,
    junctionsPerCell: junctions / dimensions.area,
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
): BranchingSummary {
  // Discarded warm-up. Without it the first case absorbs the cost of JIT-compiling generateMaze and
  // reads roughly 25% slower than an identical case later in the sweep — an artefact that reverses
  // the ns/op ordering between two cases doing the same work. Every case pays the same warm-up, so
  // no case is privileged by running later.
  const warmupCount = Math.min(benchmarkWarmupIterations, benchmarkIterations)
  for (let warmup = 0; warmup < warmupCount; warmup += 1) {
    measureBranching(dimensions, profile)
  }

  const samples: BranchingSample[] = []
  const startedAt = performance.now()

  for (let sampleIndex = 0; sampleIndex < benchmarkIterations; sampleIndex += 1) {
    samples.push(measureBranching(dimensions, profile))
  }

  const elapsedMs = performance.now() - startedAt
  const junctions = summarize(samples.map((sample) => sample.junctionsPerCell))
  const deadEnds = summarize(samples.map((sample) => sample.deadEndsPerCell))

  // Key order is display order: console.table renders keys as inserted, and bench-report.mjs mirrors
  // this order for the Go side so the two tables read down the same columns.
  return {
    "Case": name,
    "Level": levelForArea(dimensions.area),
    "Preferred": isPreferredShape(dimensions.numCols, dimensions.numRows) ? "yes" : "",
    "Bias": profile.__leastNeighborsBias,
    "Max corridor": profile.__maxCorridorLength,
    "Junctions/cell": formatMetric(junctions.mean),
    "p5": formatMetric(junctions.low),
    "p95": formatMetric(junctions.high),
    "stddev": formatMetric(junctions.stddev),
    "Dead ends/cell": formatMetric(deadEnds.mean),
    "ns/op": formatMetric((elapsedMs * 1_000_000) / benchmarkIterations),
    "Runs": benchmarkIterations,
  }
}

function logBenchmarkSummaries(title: string, summaries: BranchingSummary[]): void {
  if (benchmarkJsonOutput) {
    console.info(
      `${benchmarkJsonMarker}${JSON.stringify({
        iterations: benchmarkIterations,
        summaries,
        title,
      })}`,
    )

    return
  }

  console.info(`\n${title}`)
  console.info(`Each case runs ${benchmarkIterations} maze generations.`)
  console.table(summaries)
}

// Only the derived profile is swept. Area and bias both follow from the level, so sweeping them
// independently would report combinations no round can reach — and a number that cannot occur in
// production cannot be used to judge production. Attribution to the bias alone lives in
// maze.test.ts, as an assertion at a fixed grid rather than a metric reported every run.
describe("Maze branching benchmarks", () => {
  it("reports branching by shape", () => {
    const summaries = branchingShapes().map((benchCase) => {
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

    logBenchmarkSummaries("BenchmarkMazeBranching", summaries)
  }, benchmarkTimeoutMs)
})
