import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { extname, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { caseSequenceHash, compareHashSequences } from "./bench-compare.mjs"

// Legend layout. 150 is wide enough to keep each entry to one or two lines, which is what stops the
// legend competing with the tables it introduces, and still fits a maximised terminal or a CI log.
const legendLineWidth = 150

// Wide enough for the longest label plus a separating space. printLegendEntry guarantees that space
// regardless, so an over-long label degrades to a ragged line rather than colliding with its text.
const legendLabelWidth = 23

const benchmarkJsonMarker = "TAPOO_BENCH_REPORT:"
const benchmarkHashesMarker = "TAPOO_BENCH_HASHES:"
const benchmarkValidationMarker = "TAPOO_BENCH_VALIDATION:"
const benchmarkIterations = isMainModule() ? configuredBenchmarkIterations() : 0
const benchmarkSeed = isMainModule() ? configuredBenchmarkSeed() : 0
const traversalSpeedScaleUnits = configuredTraversalSpeedScaleUnits()
const traversalSpeedDisplayDecimals = String(traversalSpeedScaleUnits).length - 1
const routeGeometryTableTitle = "Table 3a - Route geometry"
const costModelTableTitle = "Table 3b - Cost model"
const minWinSpeedTableTitle = "Table 3c - Minimum winning speed"

const reportOutputPath = process.env.TAPOO_BENCH_OUT ?? "parity-harness/bench-report.json"
const chartOutputPath = chartPathForReport(reportOutputPath)
const preferredChartOutputPath = chartPathForReport(reportOutputPath, "preferred")

export const sensitivityCaseName = "sensitivity_area25_5x5"

export const hashSpec =
  "FNV-1a 64 over row-major cell adjacency masks; bits are Up(1), Right(2), Down(4), Left(8)"

if (isMainModule()) {
  main()
}

function main() {
  const reportMode = process.argv.includes("--go-only")
    ? "go"
    : process.argv.includes("--frontend-only")
      ? "frontend"
      : "combined"
  const goReport = reportMode === "frontend" ? null : runGoBenchmarks()
  const frontendReport = reportMode === "go" ? null : runFrontendBenchmarks()
  const reportMetadata = buildReportMetadata(goReport, frontendReport)

  // The sensitivity case is split out before the real pass/fail gate below: it is expected to
  // mismatch (that is the whole point of it), so it must never count toward "did the real cases
  // match" or it would fail every legitimate run. partitionHashesByCase keeps it in its own maps.
  const { rest: goRealHashes, sensitivity: goSensitivityHashes } = partitionHashesByCase(
    goReport?.hashesByCase,
  )
  const { rest: frontendRealHashes, sensitivity: frontendSensitivityHashes } = partitionHashesByCase(
    frontendReport?.hashesByCase,
  )

  // An unmatched case is a harness fault, not a result: the two sweeps are maintained as separate
  // lists, so a case added to one and not the other would otherwise shrink the check in silence while
  // the report still read "matched" - fewer cases covered, and nothing saying so. Exits immediately,
  // before writeJsonReport, since there is nothing meaningful to persist yet.
  const hashCheck =
    goReport && frontendReport ? compareHashSequences(goRealHashes, frontendRealHashes) : null
  const sensitivityCheck =
    goReport && frontendReport
      ? compareHashSequences(goSensitivityHashes, frontendSensitivityHashes)
      : null
  const structuralValidation = validationSummary([goReport, frontendReport])

  if (hashCheck && hashCheck.unmatchedCases.length > 0) {
    console.error(
      `\nBenchmark cases do not match across the two ports, so ${hashCheck.unmatchedCases.length} ` +
        "case(s) went uncompared. Keep branchingShapes() identical in maze/bench and frontend/bench.",
    )
    for (const entry of hashCheck.unmatchedCases) {
      console.error(`  ${entry}`)
    }
    process.exit(1)
  }

  printLegend()

  if (goReport && !frontendReport) {
    printStandaloneReport("Go maze branching benchmarks", goReport, reportMetadata)
  } else if (frontendReport && !goReport) {
    printStandaloneReport("TypeScript maze branching benchmarks", frontendReport, reportMetadata)
  } else {
    printComparisonReport(goReport, frontendReport, hashCheck, reportMetadata)
  }

  if (hashCheck) {
    printHashCheckResult(hashCheck)
  }

  if (hashCheck && !hashCheck.matched) {
    printHashComparisonTable(goReport, frontendReport)
    process.exit(1)
  }

  if (hashCheck) {
    printSensitivityCaseResult(sensitivityCheck)
  }
  printStructuralValidation(structuralValidation)
  printShapeFitParity(goReport, frontendReport)
  writeJsonReport(goReport, frontendReport, hashCheck, sensitivityCheck, structuralValidation, reportMetadata)
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
}

export function parseCaseName(name) {
  const match = String(name).match(/^area(\d+)_(\d+)x(\d+)$/)
  if (!match) {
    return null
  }

  const [, area, cols, rows] = match.map(Number)
  return {
    area,
    cols,
    rows,
    skew: Math.max(cols, rows) / Math.min(cols, rows),
  }
}

export function realSummaries(summaries) {
  return summaries.filter((summary) => summary.Case !== sensitivityCaseName)
}

export function caseDefinitionRows(summaries) {
  return Object.fromEntries(
    realSummaries(summaries).map((summary) => {
      const parsed = parseCaseName(summary.Case)
      return [
        summary.Case,
        {
          "Level": summary.Level,
          "Grid": parsed ? `${parsed.cols}x${parsed.rows}` : "",
          "Area (Cells)": parsed?.area ?? "",
          "Skew (Ratio)": parsed ? formatNumber(parsed.skew) : "",
          "Preferred": summary.Preferred,
          "Bias (%)": summary["Bias (%)"],
          "Max Corridor (Cells)": summary["Max corridor"],
        },
      ]
    }),
  )
}

export function branchingDistributionRows(summaries) {
  return Object.fromEntries(
    realSummaries(summaries).map((summary) => [
      summary.Case,
      {
        "Junctions/Maze": summary["Junctions/maze"],
        "Degree-3/Maze": summary["Deg3/maze"],
        "Degree-4/Maze": summary["Deg4/maze"],
        "Degree-4 (%)": roundedNumber(summary["%Deg4"], 2),
        "Dead Ends/Maze": summary["Dead ends/maze"],
        "Zero-Junction (%)": summary["Zero-J%"],
        "Junctions/Cell": summary["Junctions/cell"],
        "P5": summary.p5,
        "P95": summary.p95,
        "stddev": summary.stddev,
      },
    ]),
  )
}

export function routeGeometryRows(summaries) {
  return Object.fromEntries(
    realSummaries(summaries).map((summary) => [
      summary.Case,
      {
        "Path Len (Cells)": summary.PathLen,
        "Path P5 (Cells)": summary["Path-p5"],
        "Path P95 (Cells)": summary["Path-p95"],
        "Path (%)": summary["Path%"],
        "W-Branch (Depth)": summary.WorstBranch,
        "W-Branch P5 (Depth)": summary["WorstBranch-p5"],
        "W-Branch P95 (Depth)": summary["WorstBranch-p95"],
        "Error Margin (Cells)": summary.Headroom,
        "W-Branch (% of Margin)": worstBranchPercentOfMargin(summary),
      },
    ]),
  )
}

export function costModelRows(summaries) {
  return Object.fromEntries(
    realSummaries(summaries).map((summary) => [
      summary.Case,
      {
        "Budget (Decay)": summary.Budget,
        "Batching (Turns)": batchingTraversalBudget(summary),
        "Error Budget (Turns)": errorBudgetTurns(summary),
        "Error Budget (%)": percentOfBudget(errorBudgetTurns(summary), summary.Budget, 1),
        "W-Branch Cost (Turns)": costProjectionExpression(summary.WorstBranch),
        "Explore-All Cost (Turns)": costProjectionExpression(summary.Headroom),
      },
    ]),
  )
}

export function minWinSpeedRows(summaries) {
  return Object.fromEntries(
    realSummaries(summaries).map((summary) => [
      summary.Case,
      {
        "Conservative (No Batching) Min Win Speed": conservativeMinWinSpeed(summary),
      },
    ]),
  )
}

// minWinSpeedNumbers is the JSON counterpart of minWinSpeedRows. The table's values are strings
// by necessity - the 4dp directional rounding exists so a displayed figure can never contradict its
// classification, and that is a formatting decision - but a consumer should never have to parse
// them back. These are the raw quotients, unrounded and unformatted: same inputs, no presentation.
export function minWinSpeedNumbers(summaries) {
  return Object.fromEntries(
    realSummaries(summaries).map((summary) => {
      const uniqueCells = uniqueCellsCeiling(summary)
      const conservativeSpeed = conservativeMinWinSpeedRatio(summary)

      return [
        summary.Case,
        {
          uniqueCellsCeiling: Number.isFinite(uniqueCells) ? uniqueCells : null,
          conservativeSpeed: Number.isFinite(conservativeSpeed) ? conservativeSpeed : null,
        },
      ]
    }),
  )
}

function percentOfBudget(value, budget, precision = 4) {
  const numericBudget = Number(budget)
  if (!Number.isFinite(numericBudget) || numericBudget <= 0) {
    return ""
  }

  return roundedNumber((Number(value) / numericBudget) * 100, precision)
}

function errorMarginPerCell(summary) {
  const area = summaryArea(summary)
  if (!Number.isFinite(area) || area <= 0) {
    return ""
  }

  return formatNumber(Number(summary.Headroom) / area)
}

function worstBranchPercent(summary) {
  return percentOfBudget(summary.WorstBranch, summary.Budget)
}

function batchingTraversalBudget(summary) {
  const batching = batchingTraversalCost(summary)
  return Number.isFinite(batching) ? Math.round(batching) : ""
}

function batchingTraversalCost(summary) {
  const pathLength = Number(summary.PathLen)
  const errorMargin = Number(summary.Headroom)
  if (![pathLength, errorMargin].every(Number.isFinite)) {
    return Number.NaN
  }

  return pathLength + 1.25 * (errorMargin / 2)
}

function errorBudgetTurns(summary) {
  const conservative = Number(summary.Budget)
  const batching = batchingTraversalBudget(summary)
  if (![conservative, batching].every(Number.isFinite)) {
    return ""
  }

  return conservative - batching
}

function worstBranchPercentOfMargin(summary) {
  const worstBranch = Number(summary.WorstBranch)
  const errorMargin = Number(summary.Headroom)
  if (!Number.isFinite(worstBranch) || !Number.isFinite(errorMargin) || errorMargin <= 0) {
    return ""
  }

  return formatNumber(Math.min(100, (worstBranch / errorMargin) * 100))
}

function roundedNumber(value, precision) {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) {
    return ""
  }

  return Number(numericValue.toFixed(precision))
}

function costProjectionExpression(value) {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) {
    return ""
  }

  const projections = [
    Math.max(0, Math.floor(numericValue * 1.25)),
    Math.max(0, Math.floor(numericValue * 2)),
  ].join(" - ")
  return projections
}

function uniqueCellsCeiling(summary) {
  const pathLength = Number(summary.PathLen)
  const budget = Number(summary.Budget)
  if (![pathLength, budget].every(Number.isFinite)) {
    return Number.NaN
  }

  return (pathLength + budget) / 2
}

function conservativeMinWinSpeedRatio(summary) {
  const uniqueCells = uniqueCellsCeiling(summary)
  const budget = Number(summary.Budget)
  if (![uniqueCells, budget].every(Number.isFinite) || budget <= 0) {
    return Number.NaN
  }

  return uniqueCells / budget
}

function conservativeMinWinSpeed(summary) {
  const uniqueCells = uniqueCellsCeiling(summary)
  const budget = Number(summary.Budget)
  if (![uniqueCells, budget].every(Number.isFinite) || budget <= 0) {
    return ""
  }

  return `${traversalSpeedUnitsToDisplay(calculateTraversalSpeedUnits(uniqueCells, budget))}x`
}

// Mirrors frontend/app/agent/efficiency.ts calculateTraversalSpeedUnits().
function calculateTraversalSpeedUnits(uniqueCellsVisited, scoreDecayUnits) {
  if (scoreDecayUnits <= 0) {
    return 0
  }
  if (uniqueCellsVisited === scoreDecayUnits) {
    return traversalSpeedScaleUnits
  }

  const scaledSpeedUnits = (uniqueCellsVisited * traversalSpeedScaleUnits) / scoreDecayUnits
  const speedUnits = uniqueCellsVisited < scoreDecayUnits
    ? Math.floor(scaledSpeedUnits)
    : Math.ceil(scaledSpeedUnits)

  return Math.max(0, speedUnits)
}

// Mirrors frontend/app/agent/efficiency.ts traversalSpeedUnitsToDisplay().
function traversalSpeedUnitsToDisplay(traversalSpeedUnits) {
  return (traversalSpeedUnits / traversalSpeedScaleUnits)
    .toFixed(traversalSpeedDisplayDecimals)
}

export function conservativeLabel(headroom) {
  const numericHeadroom = Number(headroom)
  if (!Number.isFinite(numericHeadroom) || numericHeadroom < 0) {
    return "infeasible"
  }
  if (numericHeadroom === 0) {
    return "marginal"
  }
  return "feasible"
}

export function validationSummary(reports) {
  const invalid = []
  let total = 0

  for (const report of reports.filter(Boolean)) {
    for (const [caseName, validation] of report.validationByCase) {
      total += validation.total
      if (validation.failures > 0) {
        invalid.push({ caseName, ...validation })
      }
    }
  }

  return {
    invalid,
    matched: invalid.length === 0,
    total,
  }
}

// partitionHashesByCase splits sensitivityCaseName out of a hashesByCase map into its own map, so it
// can be compared separately from - and never silently folded into - the real pass/fail gate above.
function partitionHashesByCase(hashesByCase) {
  const rest = new Map()
  const sensitivity = new Map()

  for (const [caseName, hashes] of hashesByCase ?? []) {
    ;(caseName === sensitivityCaseName ? sensitivity : rest).set(caseName, hashes)
  }

  return { rest, sensitivity }
}

// printSensitivityCaseResult reports sensitivityCaseName's own comparison - using this run's own
// real, independently-generated mazes and the exact same compareHashSequences/table machinery every
// real case above went through - expecting a mismatch, since Go deliberately offset its seed for
// this one case. A mismatch here is the proof the check works; if it unexpectedly matches instead,
// that means the deliberate divergence didn't actually happen (the offset seed produced the same
// maze anyway) or the comparison itself has a blind spot - either way, worth failing loudly over.
function printSensitivityCaseResult(result) {
  console.info("")
  console.info("Table 5 - Detection controls")
  printWrapped(
    console.info,
    "Controls are expected failures and are excluded from the parity verdict. They exist to prove " +
      "the check can fail - a comparison that only ever agrees proves nothing.",
  )

  if (!result.matched) {
    // Keyed by the real case name, matching the first-diff detail below it. The row used to read
    // offset_seed, which named the mutation a second time while disagreeing with every other
    // reference to this case.
    printCaseTable({
      [sensitivityCaseName]: {
        "Mutation": "different PRNG seed",
        "Detected": "yes",
        "First diff": `#${result.firstMismatch.index}`,
      },
    })
    printWrapped(
      console.info,
      "Coverage gap: an offset seed produces a wholly different maze, so this control proves only " +
        "that total divergence is detectable. Real drift is one carving decision differing at one " +
        "junction in one maze out of thousands. Single-wall-flip, transpose and dimension-off-by-one " +
        "controls are needed to demonstrate that sensitivity.",
    )
    printWrapped(
      console.info,
      `First diff detail: case "${result.firstMismatch.case}", sample #${result.firstMismatch.index}: ` +
        `Go ${result.firstMismatch.goHash} != TypeScript ${result.firstMismatch.frontendHash}.`,
    )
    return
  }

  printCaseTable({
    [sensitivityCaseName]: {
      "Mutation": "different PRNG seed",
      "Detected": "no",
      "First diff": "-",
    },
  })

  printWrapped(
    console.error,
    "Sensitivity case unexpectedly matched: the deliberately offset seed produced the same maze " +
      "anyway (extremely unlikely by chance), or the comparison has a blind spot. Either way this " +
      "means nothing above can be trusted as a real proof of parity.",
  )
  process.exit(1)
}

function buildReportMetadata(goReport, frontendReport) {
  const writtenPath = resolve(reportOutputPath)
  const gitCommit = commandOutput("git", ["rev-parse", "--short=8", "HEAD"]) || "(unknown)"
  const worktreeStatus = commandOutput("git", ["status", "--short"])
  const goVersion = commandOutput("go", ["version"]) || "(not run)"
  const nodeVersion = process.version
  const cpuLine = [...(goReport?.metadata ?? []), ...(frontendReport?.metadata ?? [])].find(
    (line) => line.startsWith("cpu:"),
  )
  const caseCount = realCaseCount(goReport ?? frontendReport)
  const portCount = goReport && frontendReport ? 2 : 1

  return {
    caseCount,
    chartPath: resolve(chartOutputPath),
    commit: gitCommit,
    cpu: cpuLine ? cpuLine.replace(/^cpu:\s*/, "") : "(unknown)",
    goVersion,
    hashSpec,
    nodeVersion,
    outputPath: writtenPath,
    preferredChartPath: resolve(preferredChartOutputPath),
    sampleLine:
      `${benchmarkIterations} per case x ${caseCount} parity cases x ${portCount} port(s) = ` +
      `${benchmarkIterations * caseCount * portCount} mazes ` +
      `(+${benchmarkIterations * portCount} detection-control mazes)`,
    worktree: worktreeStatus ? "dirty" : "clean",
  }
}

function commandOutput(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" })
  return result.status === 0 ? result.stdout.trim() : ""
}

function realCaseCount(report) {
  const firstGroup = report?.groups.values().next().value
  return firstGroup ? realSummaries(firstGroup.summaries).length : 0
}

function runGoBenchmarks() {
  const goResult = spawnSync(
    "go",
    [
      "test",
      "./maze/bench",
      "-run",
      "^$",
      "-bench",
      "^BenchmarkMazeBranching",
      "-benchtime",
      `${benchmarkIterations}x`,
      "-benchmem",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        TAPOO_BENCH_SEED: String(benchmarkSeed),
        // -benchtime Nx above already sets the real iteration count; this env var is what lets the
        // Go side's warm-up cap match the frontend's (b.N is unreliable for this under the newer
        // b.Loop() API - see maze/bench/levels_bench_test.go's configuredBenchmarkIterations).
        TAPOO_BENCH_ITERATIONS: String(benchmarkIterations),
      },
      maxBuffer: 10 * 1024 * 1024,
    },
  )

  if (goResult.status !== 0) {
    process.stdout.write(goResult.stdout)
    process.stderr.write(goResult.stderr)
    process.exit(goResult.status ?? 1)
  }

  const groups = new Map()
  const metadata = []
  const hashesByCase = new Map()
  const validationByCase = new Map()

  for (const line of goResult.stdout.split("\n")) {
    if (line.startsWith("Benchmark")) {
      const row = parseGoBenchmarkLine(line)
      if (!row) {
        continue
      }

      const group = groups.get(row.group) ?? {
        iterations: row.iterations,
        summaries: [],
      }
      group.summaries.push(row.summary)
      groups.set(row.group, group)
      continue
    }

    const hashesMarkerIndex = line.indexOf(benchmarkHashesMarker)
    if (hashesMarkerIndex !== -1) {
      const rest = line.slice(hashesMarkerIndex + benchmarkHashesMarker.length)
      const separatorIndex = rest.indexOf(":")
      hashesByCase.set(rest.slice(0, separatorIndex), JSON.parse(rest.slice(separatorIndex + 1)))
      continue
    }

    if (
      line.startsWith("goos:") ||
      line.startsWith("goarch:") ||
      line.startsWith("pkg:") ||
      line.startsWith("cpu:")
    ) {
      metadata.push(line)
      continue
    }

    const validationMarkerIndex = line.indexOf(benchmarkValidationMarker)
    if (validationMarkerIndex !== -1) {
      const rest = line.slice(validationMarkerIndex + benchmarkValidationMarker.length)
      const separatorIndex = rest.indexOf(":")
      validationByCase.set(
        rest.slice(0, separatorIndex),
        JSON.parse(rest.slice(separatorIndex + 1)),
      )
    }
  }

  return { groups, hashesByCase, metadata, name: "Go", validationByCase }
}

function runFrontendBenchmarks() {
  const frontendResult = spawnSync(
    "./node_modules/.bin/vitest",
    ["run", "--config", "vitest.bench.config.ts", "--reporter", "verbose"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        TAPOO_BENCH_JSON: "1",
        TAPOO_BENCH_ITERATIONS: String(benchmarkIterations),
        TAPOO_BENCH_SEED: String(benchmarkSeed),
      },
      maxBuffer: 10 * 1024 * 1024,
    },
  )

  if (frontendResult.status !== 0) {
    process.stdout.write(frontendResult.stdout)
    process.stderr.write(frontendResult.stderr)
    process.exit(frontendResult.status ?? 1)
  }

  const groups = new Map()
  const hashesByCase = new Map()
  const validationByCase = new Map()

  for (const line of frontendResult.stdout.split("\n")) {
    const markerIndex = line.indexOf(benchmarkJsonMarker)
    if (markerIndex === -1) {
      continue
    }

    const payload = JSON.parse(
      line.slice(markerIndex + benchmarkJsonMarker.length),
    )
    groups.set(payload.title, {
      iterations: payload.iterations,
      summaries: payload.summaries.map(normalizeSummary),
    })
    for (const [caseName, hashes] of Object.entries(payload.hashesByCase ?? {})) {
      hashesByCase.set(caseName, hashes)
    }
    for (const [caseName, validation] of Object.entries(payload.validationByCase ?? {})) {
      validationByCase.set(caseName, validation)
    }
  }

  return { groups, hashesByCase, metadata: [], name: "TypeScript", validationByCase }
}

// printLegend explains the columns in place. Densities are reported per cell so cases of different
// areas can be compared, but that form is unreadable on its own - junction counts are integers, so a
// per-cell figure is always some multiple of 1/area, and 0.01429 at area 70 is not a small fraction
// but exactly one junction. The legend prints every run because that conversion is the first thing
// anyone needs and the last thing anyone remembers.
function printLegend() {
  console.info("Reading the benchmark report")
  printReportReadingGuide()

  printLegendSection("Glossary, regrouped by table")

  printLegendSection("Table 1 - Case definitions")

  printLegendEntry(
    "Case, Level:",
    "Case is the area_shape measured. Level is the game level that normally uses that area.",
  )
  printLegendEntry(
    "Area (Cells):",
    "rows x cols. Also the decay budget for the level.",
  )
  printLegendEntry(
    "Skew (Ratio):",
    "max(rows, cols) / min(rows, cols). 1 is square; larger is flatter or taller. Compare rows " +
      "sharing a level to see how shape affects the same maze area. The dimensions with the " +
      "smallest skew that still fits the display is the shape the selector picks at that level.",
  )
  printLegendEntry(
    "Preferred:",
    "how each row fares on the viewport named on the report's 'Viewport used:' line (derived in " +
      "baseViewport, maze/bench). " +
      "'yes' is the shape that display's selector picks for the level; '-' fits it but is not the " +
      "shape picked; 'too-big' does not fit at all - and since every level fits by area, too-big " +
      "always means the ratio is too extreme rather than the maze too large. An area can have no " +
      "'yes' row: the sweep is a geometry ladder, so the shape the selector would pick is not " +
      "always one of the rows.",
  )
  printLegendEntry(
    "Bias (%), Max Corridor:",
    "Generator inputs, not results. Both are pegged to a specific level's area, so area, bias and " +
      "corridor cap move together across every playable level. Nothing in this report can therefore " +
      "attribute a branching change to one of the three in isolation; they are confounded by design.",
  )

  printLegendSection("Table 2 - Branching distribution")

  printLegendEntry(
    "Junctions/Maze:",
    "Average count of cells with three or more exits. Read the count block before the rate block - " +
      "\"0.17 junctions per maze\" is legible in a way that \"0.0024 per cell\" is not.",
  )
  printLegendEntry(
    "Degree-3/Maze, Degree-4/Maze:",
    "T-junctions and four-way crossroads, per maze. They sum to Junctions/Maze. More Degree-4 means " +
      "a harder local inference target: more branches must be eliminated before a move can be proven safe.",
  )
  printLegendEntry(
    "Degree-4 (%):",
    "Share of junctions that are crossroads in the whole maze. It rises with area and falls with extreme skew because " +
      "very thin grids cannot physically support many crossroads. Shape changes junction character, " +
      "not just count. The effect is real but small: even large benchmark cases average only a few " +
      "crossroads per maze.",
  )
  printLegendEntry(
    "Dead Ends/Maze:",
    "Cells with a single exit. Determined by the two degree columns beside it: " +
      "deadEnds = deg3 + 2*deg4 + 2. This is the tree degree-sum identity, exact for every maze, " +
      "so the three columns are a visible redundancy check rather than three independent " +
      "measurements. Do not read the difference between Dead Ends and Junctions as a metric - it is " +
      "Degree-4 plus 2, restated.",
  )
  printLegendEntry(
    "Zero-Junction (%):",
    "Share of samples with no junction at all. At small areas this is the informative statistic; " +
      "p5/p95 there only distinguish \"zero\" from \"one\".",
  )
  printLegendEntry(
    "Junctions/Cell:",
    "Junctions/Maze divided by Area. Use only when comparing cases of different size.",
  )
  printLegendEntry(
    "P5/P95, stddev:",
    "Spread of per-sample junctions/cell. Indicative only for cases averaging under one junction " +
      `per maze, where n=${benchmarkIterations} leaves the estimate noisy.`,
  )

  printLegendSection("Table 3a - Route geometry")

  printLegendEntry(
    "Path Len, Path P5/P95:",
    "Cells on the unique start-to-destination route: the mean, with the 5th and 95th percentiles in " +
      "their own columns. The unavoidable ideal path, not any route an agent found. Every maze is a " +
      "spanning tree, so exactly one route exists between any two cells. The spread matters as much as the " +
      "mean - an agent faces one draw, not the average.",
  )
  printLegendEntry(
    "Path (%):",
    "Path Len as a percentage share of area. Low levels are near-pure corridors; higher levels are more " +
      "heavily branched.",
  )
  printLegendEntry(
    "Error Margin:",
    "Area minus Path Len - every cell off the winning route. It is 1 - Path (%) restated as a " +
      "count, and it is the space an agent must search through and pay to leave.",
  )
  printLegendEntry(
    "W-Branch, W-Branch P5/P95:",
    "Depth of the deepest single off-path branch, counted in cells from the route: the mean, with " +
      "percentiles in their own columns. Depth, not size - a branch that forks holds more cells " +
      "than its depth, so 2L below is the cost of walking that deepest line in and back out, and a " +
      "branch that must be explored in full costs more than that. The most expensive single wrong " +
      "turn is therefore at least this, not exactly this.",
  )
  printLegendEntry(
    "W-Branch (% of Margin):",
    "W-Branch over Error Margin. Shown against margin rather than area because that is the " +
      "decision-relevant denominator. At low levels the entire off-path space can be one branch, so " +
      "the maze poses one binary decision; at high levels it fragments into several branches, so " +
      "outcomes average out. Clamped at 100 to guard rounding when both averages are near zero.",
  )

  printLegendSection("Table 3b - Cost model")

  printLegendEntry(
    "Budget (Decay):",
    "Decay units available for the level, equal to area. A clean turn costs 1 unit; a partial " +
      "failure 2; a malformed response 3. Cost columns below are turn counts, which equal decay " +
      "only under error-free play.",
  )
  printLegendEntry(
    "Conservative:",
    "Cost of single-move play: P + 2*(M/2) = P + M = area. This equals Budget exactly, at every " +
      "level, by construction - which is why it is not printed as a column.",
  )
  printLegendEntry(
    "Batching:",
    "Cost of the same journey retracing at 4 cells per turn: P + 1.25*(M/2). 4 is the top of " +
      "suggestedMovesPerTurn, which is guidance rather than a limit - observed agents submit longer " +
      "batches over known ground and they apply - so this is an upper bound on batching cost, not " +
      "an expected value.",
  )
  printLegendEntry(
    "Why 1.25 and 2:",
    "A dead end is knowable only on arrival, and an unvisited cell's exits are unknown until you " +
      "land there, so the inbound leg is normally one cell per turn. The outbound leg retraces " +
      "cells already in filteredTraversalHistory, and 4 is where suggestedMovesPerTurn tops out rather " +
      "than where batching does. Conservative play pays " +
      "L in + L out = 2L; batching pays L in + L/4 out = 1.25L. Nothing caps a batch at 4: " +
      "suggestedMovesPerTurn only suggests it, and batch depth is really limited by how far the " +
      "next moves can be deduced - over fully mapped ground that can be the whole retrace. 1.25L " +
      "is therefore a ceiling on what batching costs, so Error Budget below understates the " +
      "tolerance a good batcher actually has. Forward deduction does not appear " +
      "here as a lower cost per branch. Because the destination is known, deduction mainly identifies " +
      "which branches the route cannot use - so it shows up as fewer branches entered, not cheaper " +
      "traversal of the ones entered. Entering a branch that could have been proven dead is a " +
      "context-disregard violation, not an efficient traversal. There is likewise no cheaper case " +
      "from shared history: a branch any player has mapped exposes cellType: dead-end, so " +
      "re-entering it is a violation.",
  )
  printLegendEntry(
    "Error Budget (Turns):",
    "Budget minus Batching - decay the batching agent never spends. Since conservative cost equals " +
      "Budget exactly, a conservative agent's error budget is zero at every level, and this column " +
      "is therefore the batching agent's entire tolerance for going wrong: penalties, extra " +
      "branches, wasted turns. It is not idle capacity to spend on something - every turn costs " +
      "decay and the level ends on arrival. Distinct from Error Margin despite the similar name: " +
      "margin is cells of off-path space in Table 3a; this is decay units of tolerance. They are " +
      "joined by Error Budget = 0.375 * Error Margin, so this column is a scaled restatement rather " +
      "than independent evidence. The constant is 1 - 5/8, the batcher's per-cell saving (1/2 " +
      "inbound plus 1/8 outbound, against 1). Because 1.25L bounds batching cost from above, this " +
      "column is a floor on the batcher's tolerance rather than an estimate of it.",
  )
  printLegendEntry(
    "Error Budget (%):",
    "Error Budget over Budget. It rises with level: higher levels are more forgiving to a batching " +
      "agent in relative terms, because there is more waste to eliminate.",
  )
  printLegendEntry(
    "W-Branch Cost, Explore-All Cost:",
    "Projected turns as floor(1.25L) - floor(2L), where L is W-Branch and Error Margin " +
      "respectively. Explore-All Cost exceeds the available margin in every row under both " +
      "strategies - exhaustive exploration is never affordable at any level. Small averaged margins " +
      "can display 0 - 0 even when individual samples had a short branch.",
  )

  printLegendSection("Table 3c - Minimum winning speed")

  printLegendEntry(
    "Min Win Speed:",
    "s_min = (P + M/2) / Budget, where P is Path Length and M is Error Margin. " +
      "Equivalently U/Budget with U = (P + Budget)/2, the unique cells a conservative " +
      "agent has visited at break-even - the whole path plus half the off-path space, " +
      "typically 70-80% of the maze, not half of anything a reader would count. Cannot " +
      "exceed 1.0000: one turn, one decay unit, at most one new cell, so U <= D always. " +
      "Reaches exactly 1.0000 only when Error Margin is zero, so conservative play is " +
      "always Backtracker.",
  )
  printLegendEntry(
    "Formatting:",
    "Four decimal places, rounded away from 1.0000 so a displayed value never contradicts its class. " +
      "Classification is computed from the raw ratio, not the rendered string.",
  )
  printLegendEntry(
    "What this means:",
    "Exceeding 1.0000 requires more than one new cell per turn, which requires batching forward, into " +
      "cells never visited. The Trailblazer threshold is therefore a forward-deduction test, and a " +
      "Backtracker classification at high levels may be a structural ceiling rather than poor play. " +
      "Perfect retrace batching can approach 1.0000 from below, but cannot cross it: retracing " +
      "saves denominator while adding no new cells. That limit is a global fact, stated here once, " +
      "rather than a column sitting at one arbitrary batch depth.",
  )

  printDerivedFormulaLegend()
  printDifficultyCalibration()

  printLegendSection("Maze structure check")

  printLegendEntry(
    "Maze Structure Hash:",
    "a pass/fail assertion over every per-sample maze-adjacency hash. The terminal shows the verdict; " +
      "the JSON keeps per-case and per-sample hash details for debugging or citation.",
  )

  printLegendEntry(
    "Seed:",
    "the one PRNG seed both ports use for this run, derived fresh each invocation unless " +
      "TAPOO_BENCH_SEED pins it - copy the printed value into that variable to reproduce a run exactly. " +
      "Printed once at the top of the report, beside the run's other identifying metadata.",
  )
  printLegendEntry(
    "Check:",
    "not a benchmark metric - a pass/fail assertion. Every generated maze's decoded adjacency is " +
      "hashed and compared, case by case and sample by sample, between Go and TypeScript. Any single " +
      "difference fails the run and reports the first case and sample index where the two diverged.",
  )
  printLegendEntry(
    "Tables:",
    "parity is established by hash equality; distribution tables describe generator behavior and are " +
      "not a drift check. Detection controls are expected failures and excluded from the parity verdict.",
  )
  console.info("")
}

function printDerivedFormulaLegend() {
  printLegendSection("Derived formulas")

  printLegendEntry(
    "Case shape:",
    "Area (Cells) = rows*cols. Skew (Ratio) = max(rows, cols) / min(rows, cols).",
  )
  printLegendEntry(
    "Branching rates:",
    "Junctions/Cell = Junctions/Maze / Area (Cells). Degree-4 (%) = 100*Degree-4/Maze / " +
      "Junctions/Maze when Junctions/Maze is non-zero. Zero-Junction (%) = 100*samples with zero " +
      "junctions / samples.",
  )
  printLegendEntry(
    "Spread columns:",
    "Mean, P5, and P95 columns report the sample mean plus the 5th and 95th percentile for that " +
      "same metric. P5/P95 (Junctions/Cell) and stddev (Junctions/Cell) are computed over " +
      "per-sample junctions/cell values; Path P5/P95 are cell counts and W-Branch P5/P95 are depths.",
  )
  printLegendEntry(
    "Route percentages:",
    "Path (%) = 100*Path Len (Cells) / Area (Cells). Error Margin (Cells) = Area (Cells) - " +
      "Path Len (Cells). W-Branch (% of Margin) = min(100, 100*W-Branch (Depth) / " +
      "Error Margin (Cells)) - a depth over a cell count, so read it as how far the worst branch " +
      "reaches into the off-path space rather than what share of it that branch holds.",
  )
  printLegendEntry(
    "Cost model:",
    "Batching (Turns) = round(Path Len (Cells) + 1.25*(Error Margin (Cells)/2)). " +
      "Error Budget (Turns) = Budget (Decay) - Batching (Turns). Error Budget (%) = " +
      "100*Error Budget (Turns) / Budget (Decay).",
  )
  printLegendEntry(
    "Min win speed:",
    "s_min = (Path Length + Error Margin/2) / Budget, the final traversal speed of a " +
      "single-move agent that exactly exhausts its budget. Generalises to " +
      "s_min(c) = (P + M/c) / Budget for a strategy with round-trip multiplier c; " +
      "c = 2 is printed, c = 1 gives exactly 1.0000.",
  )
  printLegendEntry(
    "Redundancies:",
    "Dead Ends/Maze = Degree-3/Maze + 2*Degree-4/Maze + 2. Error Budget (Turns) = " +
      "0.375 * Error Margin (Cells), before whole-turn rounding, given the depth-4 Batching column. " +
      "Error Margin (Cells) = Area * (1 - Path (%)/100). These are identities, not independent " +
      "measurements. They are printed because a visible identity that must hold is a free correctness check.",
  )
  printLegendEntry(
    "Failure threshold:",
    "An agent fails when it explores more than 1/c of the off-path space. c = 2.00 for " +
      "single-move play. Batching lowers c - 1.25 at depth 4, less at greater depth - so " +
      "the threshold rises with batch depth. Independent of area, path length and margin.",
  )
  printLegendEntry(
    "Speed display:",
    "Speeds render at 4dp, rounded away from 1.0000. Class comes from comparing U against D directly, " +
      "so the number and the class cannot disagree.",
  )
}

function printDifficultyCalibration() {
  printLegendSection("Difficulty calibration")
  printWrapped(
    console.info,
    "Let f be the fraction of off-path space an agent explores before finding the route, and c the " +
      "strategy's round-trip multiplier. Total cost is P + c*f*M. The agent fails when that exceeds " +
      "Budget = P + M:",
  )
  printWrapped(
    console.info,
    "P + c*f*M > P + M => c*f > 1 => f > 1/c",
  )
  printWrapped(
    console.info,
    "Path length, error margin and area all cancel. The pass mark is a pure function of strategy:",
  )
  printLegendEntry(
    "Conservative:",
    "c = 2.00; fails above 50% exploration.",
  )
  printLegendEntry(
    "Retrace batching:",
    "c <= 1.25 at batch depth 4, and lower at greater depth. At c = 1.25 the threshold is " +
      "80% exploration; deeper batching raises it further. 1.25 is the depth-4 case, not " +
      "a property of batching.",
  )
  printLegendEntry(
    "Forward deduction:",
    "does not change c. Because the destination is known, deduction identifies branches the route " +
      "cannot use, so it lowers f - the fraction of off-path space entered - rather than the cost " +
      "of traversing a branch once entered. An agent that could prove a branch dead and entered " +
      "anyway has committed a context-disregard violation, not paid a cheaper price.",
  )
  printWrapped(
    console.info,
    "This holds at every level. A conservative agent must find the route having searched under half " +
      "the maze's dead ends whether the maze is 70 cells or 1600 - the same test at every difficulty.",
  )
  printWrapped(
    console.info,
    "What is not constant, and is not meant to be:",
  )
  printLegendEntry(
    "Stakes:",
    "Error Margin ranges from near zero at level 1 to hundreds of cells at high levels. The " +
      "threshold is fixed; the consequences are not.",
  )
  printLegendEntry(
    "Capability:",
    "At level 1 there is almost nothing to explore, so f is barely meaningful and the only margin " +
      "comes from forward deduction along the path itself. At high levels exploration is the whole game.",
  )
  printLegendEntry(
    "Luck exposure:",
    "W-Branch can be the whole margin at low levels and only a fraction of it at high levels. " +
      "Low levels are closer to one binary decision; high levels average over several.",
  )
  printWrapped(
    console.info,
    "Constant pass mark, sweeping capability.",
  )
}

function printReportReadingGuide() {
  printLegendSection("----------------------------------------------------")
  printLegendSection("How to read this report")
  printWrapped(
    console.info,
    "This report answers two independent questions.",
  )
  console.info("")
  printNumberedReadingGuideItem(
    1,
    "Do the Go and TypeScript maze generators produce identical mazes? Answered by Tables 4 " +
      "and 5, as a pass/fail assertion over per-maze structure hashes. This is the drift check.",
  )
  console.info("")
  printNumberedReadingGuideItem(
    2,
    "What kind of task does each level present? Answered by Tables 1, 2, 3a, 3b and 3c, " +
      "which characterise maze structure and derive what it costs an agent to solve. These are " +
      "descriptive. They are NOT a drift check and no threshold in them ever fires.",
  )
  console.info("")
  printWrapped(
    console.info,
    "* What this report does not establish.",
  )
  console.info("")
  printWrapped(
    console.info,
    "Parity means the two ports agree, not that either is correct. The structural validation " +
      "line covers correctness of form - tree, connected, closed - but not of intent. " +
      "Tables 3b and 3c are projections from a cost model, not measurements: no agent " +
      `has been run. Every figure is a mean over ${benchmarkIterations} samples unless ` +
      "a percentile column says otherwise.",
  )
  console.info("")
  printWrapped(
    console.info,
    "* Where the cost model comes from.",
  )
  console.info("")
  printWrapped(
    console.info,
    "Tables 3b and 3c describe two agent archetypes at the point where each exactly exhausts " +
      "its budget. Nothing about real agent behaviour is assumed: the exploration fraction is " +
      "derived from the strategy, not guessed. Single-move play pays 2 turns per off-path cell, " +
      "so it breaks even having entered half of them; batching pays less per cell, so it breaks " +
      "even having entered more. Both figures are thresholds, not predictions - an agent below " +
      "its line has already lost.",
  )
  console.info("")
  printWrapped(
    console.info,
    "* Reading speed figures.",
  )
  console.info("")
  printWrapped(
    console.info,
    "Speeds show four decimal places here and in gameplay output, rounded " +
      "away from 1.0000 so that a displayed value never contradicts its " +
      "classification. Benchmark speeds are derived from route geometry; gameplay speeds " +
      "are measured from actual cells and decay. " +
      "Same format, different status - do not compare one against the other as though they were " +
      "the same kind of number.",
  )
  printLegendSection("----------------------------------------------------\n")
}

function printNumberedReadingGuideItem(number, text) {
  const prefix = `  ${number}. `
  const indent = " ".repeat(prefix.length)
  const lines = wrapWords(text, legendLineWidth - prefix.length)

  console.info(lines.map((line, index) => `${index === 0 ? prefix : indent}${line}`).join("\n"))
}

function printLegendSection(title) {
  console.info(`\n${title}`)
}

// wrapWords breaks text into lines no wider than width, computed rather than hand-broken so callers
// stay editable prose - hand-wrapped strings drift out of alignment the first time anyone reworks a
// sentence, and the misalignment is invisible until the report is run.
function wrapWords(text, width) {
  const lines = []
  let current = ""

  for (const word of text.split(/\s+/)) {
    if (current && current.length + word.length + 1 > width) {
      lines.push(current)
      current = word
      continue
    }

    current = current ? `${current} ${word}` : word
  }

  if (current) {
    lines.push(current)
  }

  return lines
}

// baseDisplayLine describes the display the Preferred column is measured against, printed with the
// other run parameters because that is what it is: a measurement condition, not a result. The
// derivation lives in baseViewport (maze/bench), which is where the selector is actually consulted;
// this is a summary of it and has to be updated alongside it.
//
// A function rather than a const for the same reason groupCaveat is one: the header prints before
// this point in the file, where a const is still in its temporal dead zone.
function baseDisplayLine() {
  return "16-inch, 3456x2234 px @dpr2 => 1728x1117 CSS px => 288x101 chars => 70x45 cells (3150)"
}

// shapeFitLabel turns the numeric "preferred" metric into the label the table prints. The encoding
// lives in maze/bench (shapeTooBig/shapeFits/shapeIsSelected) because that is where the production
// selector is consulted; this only renders it. Anything unrecognised reads as a plain non-selection
// rather than inventing a fourth state.
function shapeFitLabel(metric) {
  const value = Number(metric)
  if (value === 1) {
    return "yes"
  }

  return value === -1 ? "too-big" : "-"
}

// printLegendEntry wraps one entry to legendLineWidth via wrapWords, hanging the continuation under
// the text rather than the label.
function printLegendEntry(label, text) {
  const indent = " ".repeat(legendLabelWidth)
  const lines = wrapWords(text, legendLineWidth - legendLabelWidth)

  // The blank line separating entries is prefixed outside the padded label: inside it, the newline
  // counts toward padEnd and every first line lands one column left of its own continuations.
  const head = `  ${label} `.padEnd(legendLabelWidth)

  console.info(
    `\n${lines.map((line, index) => (index === 0 ? head : indent) + line).join("\n")}`,
  )
}

// printWrapped wraps a plain (unlabeled) message to legendLineWidth via wrapWords - the same width
// printLegendEntry uses - so free-standing explanatory text (like the sensitivity case's) reads at
// the same measure as the rest of the report instead of running the terminal's full width.
function printWrapped(log, text) {
  log(wrapWords(text, legendLineWidth).join("\n"))
}

// groupCaveat records how a table relates to real play. Declared as a function rather than a const
// map because the report prints before this point in the file, where a const would still be in its
// temporal dead zone.
function groupCaveat(groupName) {
  if (
    groupName === "BenchmarkMazeBranching" ||
    groupName === "BenchmarkMazeBranchingByShape"
  ) {
    // The rows are a geometry ladder, not a device model: grids are written down directly, and the
    // widest (400x4, 160x10) are ratios no viewport would ever produce. That is deliberate - it is
    // what lets a row isolate shape. Which of them a real screen could actually play is a separate
    // question, and it is the Preferred column that answers it.
    return (
      "Shape sweep: compare rows sharing a level to see whether the grid's aspect ratio alone alters " +
      "branching. Grids are written down directly rather than derived from a screen, and the widest " +
      "ladders are ratios no display would produce, so a row isolates geometry. Area and bias are " +
      "dependent at a given level, so rows with the same area keep the same bias and max corridor. " +
      "The Preferred column measures each row against the report's 'Viewport used:' line - a 70x45 " +
      "cell grid, which every level below fits by area, so a too-big row is always a statement " +
      "about its ratio rather than its size."
    )
  }

  if (groupName === "BenchmarkMazeBranchingByBias") {
    return (
      "Bias sweep: the grid and max corridor stay fixed, so changes in Junctions/cell mostly show the " +
      "effect of the bias knob itself."
    )
  }

  return ""
}

function printGroupCaveat(groupName) {
  const caveat = groupCaveat(groupName)
  if (caveat) {
    printLegendEntry("Table note:", caveat)
  }
}

function printBranchingDistributionNote() {
  printLegendEntry(
    "Table 2 note:",
    "Branching metrics describe maze structure. Read absolute counts first for same-area cases, then " +
      "use per-cell rates and p5/p95/stddev only when comparing different areas or normal variation. " +
      "Averages below roughly 1 junction/maze are low-count estimates: parity is still exact, but the " +
      "displayed mean can swing sharply between runs because a few extra junctions move the average.",
  )
}

function printRouteGeometryNote() {
  printLegendEntry(
    "Table 3a note:",
    "Route geometry contains only maze structure, not agent assumptions. P5/P95 columns are split " +
      "out as numeric cells so console.table keeps them unquoted and right-aligned. W-Branch means Worst Branch. " +
      "Error Margin (Cells) = area - Path Len (Cells), or 1 - Path (%) restated as a count. W-Branch " +
      "(% of Margin) is clamped at 100 to guard rounding artifacts when both averaged values " +
      "are near zero.",
  )
}

function printCostModelNote() {
  printLegendEntry(
    "Table 3b note:",
    "Conservative cost equals Budget exactly at every level because P + M = area. Batching = " +
      "P + 1.25*(M/2), rounded to a whole turn count, and Error Budget is the batching agent's " +
      "entire tolerance for wrong turns. Explore-All Cost is the projected cost of walking every off-path cell. " +
      "Cost columns display floor(1.25L) - floor(2L) as projected whole-turn counts, where L is " +
      "W-Branch (Worst Branch) Depth for W-Branch Cost and Error Margin (Cells) for Explore-All Cost. " +
      "The two Ls are different quantities: a depth for one, a cell count for the other. " +
      "Small averaged margins can therefore display 0 - 0 even when a few individual samples had a " +
      "short off-path branch. " +
      "A dead-end is only knowable on arrival, and an unvisited cell's exits are unknown until " +
      "landing there, so the inbound leg is normally one cell per turn. Conservative traversal pays " +
      "L in + L out = 2L; batching traversal pays L in + L/4 out = 1.25L because the outbound leg " +
      "retraces cells already in filteredTraversalHistory, where 4 is suggestedMovesPerTurn's top " +
      "end rather than a cap - real batches run longer over known ground, so 1.25L bounds the cost " +
      "from above. Forward " +
      "deduction shows up as fewer branches entered, not cheaper traversal of an entered branch. " +
      "A mapped branch exposes cellType: dead-end in shared history, so entering it again is a " +
      "context-disregard violation. Turns map to decay units only when nothing goes wrong; " +
      "penalties make actual decay cost diverge upward from these turn counts.",
  )
}

function printMinWinSpeedNote() {
  printLegendEntry(
    "Table 3c note:",
    "The final traversal speed of a single-move agent that exactly exhausts its budget: " +
      "s_min = (P + M/2) / Budget. Below this line a conservative agent has already explored " +
      "more than half the off-path space and cannot finish; at or above it, it can. The half " +
      "is derived from the strategy - single-move play pays 2 turns per off-path cell - not " +
      "assumed from behaviour. s_min rises as batching improves, reaching exactly 1.0000 in " +
      "the limit of perfect retrace batching, and never exceeding it: retracing visits no new " +
      "cells, so it lowers the denominator without raising the numerator. Exceeding 1.0000 " +
      "therefore requires batching forward into cells never visited, at any batch depth. " +
      "Trailblazer is a forward-deduction test. Values are 4dp strings rounded away from " +
      "1.0000 so a figure never contradicts its class; the JSON carries the same ratios " +
      "unrounded under minWinSpeeds, which is what downstream analysis should read. Derived " +
      "from Table 3a, not measured.",
  )
}

function printNavigationTables(summaries, suffix = "") {
  console.info(`\n${routeGeometryTableTitle}${suffix}`)
  printRouteGeometryNote()
  printCaseTable(routeGeometryRows(summaries))

  console.info(`\n${costModelTableTitle}${suffix}`)
  printCostModelNote()
  printCaseTable(costModelRows(summaries))

  console.info(`\n${minWinSpeedTableTitle}${suffix}`)
  printMinWinSpeedNote()
  printCaseTable(minWinSpeedRows(summaries))
}

// printHashComparisonTable is the actual equality check made legible in one place: a single
// case-keyed table with both ports' hashes side by side and an explicit Match column, so a mismatch
// is visible by scanning down one table rather than mentally diffing two separate, much wider ones
// further up the report.
function printHashComparisonTable(goReport, frontendReport) {
  console.info("\nGo vs TypeScript maze structure hash comparison")
  printCaseTable(
    Object.fromEntries(
      [...goReport.hashesByCase.keys()].map((caseName) => {
        const goHash = caseSequenceHash(goReport.hashesByCase.get(caseName) ?? [])
        const frontendHashes = frontendReport.hashesByCase.get(caseName)
        const frontendHash = frontendHashes ? caseSequenceHash(frontendHashes) : "(missing)"

        return [
          caseName,
          {
            "Go Maze Structure Hash": goHash,
            "TypeScript Maze Structure Hash": frontendHash,
            "Match": goHash === frontendHash ? "yes" : "MISMATCH",
          },
        ]
      }),
    ),
  )
}

// printCaseTable renders a case-keyed table with the key column headed "Case" instead of "(index)".
// Rows are keyed by case name so console.table shows the name in that column rather than a row
// number, but the label itself is fixed inside console.table with no option to set it - so the one
// header cell is rewritten on the way out. "Case" is padded to the width of "(index)" so the box
// rules still line up, and stdout is restored immediately afterwards.
function printCaseTable(rows) {
  const write = process.stdout.write.bind(process.stdout)
  process.stdout.write = (chunk, ...rest) =>
    write(String(chunk).replace("(index)", "Case   "), ...rest)

  try {
    console.table(rows)
  } finally {
    process.stdout.write = write
  }
}

function printReportHeader(metadata) {
  console.info("Tapoo maze structure & difficulty report")
  console.info("──────────────────────────────────────────────────────────────")
  console.info(`commit:         ${metadata.commit}`)
  if (metadata.worktree === "dirty") {
    console.info("* warning:       dirty worktree - commit SHA does not fully describe the code that produced this report.")
  }
  console.info(`go:             ${metadata.goVersion}`)
  console.info(`node:           ${metadata.nodeVersion}`)
  console.info(`cpu:            ${metadata.cpu}`)
  console.info("")
  console.info(`seed:           ${benchmarkSeed}  => pin via TAPOO_BENCH_SEED`)
  console.info(`hashing:        ${metadata.hashSpec}`)
  console.info(`viewport:       ${baseDisplayLine()}`)
  console.info(`samples:        ${metadata.sampleLine}`)
  console.info("")
  console.info(`json:           ${metadata.outputPath}`)
  console.info(`charts:         ${metadata.chartPath}`)
  console.info(`preferred:      ${metadata.preferredChartPath}`)
}

function printStandaloneReport(title, report, metadata) {
  printReportHeader(metadata)
  console.info(`\n${title}`)

  for (const [groupName, group] of report.groups) {
    console.info(`\nTable 1 - Case definitions (${groupName})`)
    printGroupCaveat(groupName)
    printCaseTable(caseDefinitionRows(group.summaries))

    console.info(
      `\nTable 2 - Branching distribution (${report.name}, ${mazesPerCaseText(group.iterations)})`,
    )
    printBranchingDistributionNote()
    printCaseTable(branchingDistributionRows(group.summaries))

    printNavigationTables(group.summaries, ` (${report.name})`)
  }
}

function printComparisonReport(goReport, frontendReport, hashCheck, metadata) {
  printReportHeader(metadata)

  for (const [groupName, goGroup] of goReport.groups) {
    const frontendGroup = frontendReport.groups.get(groupName)
    if (!frontendGroup) {
      continue
    }

    console.info(`\nTable 1 - Case definitions (${groupName})`)
    printGroupCaveat(groupName)
    printCaseTable(caseDefinitionRows(goGroup.summaries))

    if (hashCheck?.matched) {
      console.info(
        `\nTable 2 - Branching distribution (verified identical across ports, ` +
          `${mazesPerCaseText(goGroup.iterations)})`,
      )
      printBranchingDistributionNote()
      printCaseTable(branchingDistributionRows(goGroup.summaries))
      printNavigationTables(goGroup.summaries)
      continue
    }

    console.info(`\nTable 2 - Branching distribution (Go, ${mazesPerCaseText(goGroup.iterations)})`)
    printBranchingDistributionNote()
    printCaseTable(branchingDistributionRows(goGroup.summaries))
    console.info(
      `Table 2 - Branching distribution (TypeScript, ${mazesPerCaseText(frontendGroup.iterations)})`,
    )
    printBranchingDistributionNote()
    printCaseTable(branchingDistributionRows(frontendGroup.summaries))

    printNavigationTables(goGroup.summaries, " (Go)")
    printNavigationTables(frontendGroup.summaries, " (TypeScript)")
  }
}

function mazesPerCaseText(iterations) {
  return `${iterations} ${Number(iterations) === 1 ? "maze" : "mazes"} per case`
}

// printHashCheckResult reports the pass/fail outcome of compareHashSequences (parity-harness/bench-compare.mjs). On failure it headlines
// the very first divergence point (case + sample index) across the whole sweep, then a per-case
// breakdown of how many of that case's samples mismatched - enough to tell whether the drift is
// isolated to one case or pervasive.
function printHashCheckResult(hashCheck) {
  console.info("\nTable 4 - Structure parity")
  if (hashCheck.matched) {
    console.info(
      `Structure parity: PASS\n  ${benchmarkIterations * hashCheck.caseCount} sample pairs across ` +
        `${hashCheck.caseCount} cases - Go and TypeScript matched every sample.`,
    )
    return
  }

  const { case: firstCase, index, goHash, frontendHash } = hashCheck.firstMismatch
  console.error(
    `Structure parity: FAIL\n  First difference - case "${firstCase}", ` +
      `sample #${index}: Go ${goHash} != TypeScript ${frontendHash}.`,
  )
  for (const [caseName, { mismatches, total }] of hashCheck.mismatchByCase) {
    console.error(`  ${caseName}: ${mismatches}/${total} samples mismatched`)
  }
}

// printShapeFitParity asserts the two ports agree on every Preferred value. Each port answers by
// calling its own selector - Go's GetMazeDimensions, TypeScript's getMazeDimensions - so this is a
// real comparison of two implementations rather than of one value copied twice, and it is the only
// check in this report that exercises dimension *selection*. The hash parity above compares mazes
// carved into dimensions the benchmark hands both ports, so it cannot see a selector disagreement
// at all.
//
// This is how the last divergence surfaced: the ports were on different viewports and produced
// 13 selected shapes against 12, visible only to someone diffing two tables by eye.
function printShapeFitParity(goReport, frontendReport) {
  if (!goReport || !frontendReport) {
    return
  }

  const preferredByCase = (report) =>
    new Map(
      [...report.groups.values()].flatMap((group) =>
        realSummaries(group.summaries).map((summary) => [summary.Case, summary.Preferred]),
      ),
    )

  const goPreferred = preferredByCase(goReport)
  const frontendPreferred = preferredByCase(frontendReport)
  const disagreements = [...goPreferred.entries()]
    .filter(([caseName, value]) => frontendPreferred.get(caseName) !== value)
    .map(([caseName, value]) => `${caseName}: Go ${value} != TypeScript ${frontendPreferred.get(caseName)}`)

  console.info("")
  if (disagreements.length === 0) {
    console.info(
      `Shape selection parity: PASS\n  ${goPreferred.size} cases - both selectors agree on every ` +
        "Preferred value.",
    )
    return
  }

  console.error(
    `Shape selection parity: FAIL\n  ${disagreements.length} case(s) disagree:\n    ` +
      disagreements.join("\n    "),
  )
  process.exit(1)
}

function printStructuralValidation(result) {
  console.info("\nStructural validation")
  if (result.matched) {
    console.info(
      `Structural validation: PASS\n  ${result.total} mazes - edges == area-1, connected, acyclic, border closed.`,
    )
    return
  }

  console.error(`Structural validation: FAIL\n  ${result.invalid.length} case(s) contained invalid mazes.`)
  for (const entry of result.invalid) {
    console.error(`  ${entry.caseName}: ${entry.failures}/${entry.total} invalid`)
  }
}

// writeJsonReport persists the run so it can be compared against other commits. The console tables
// are unreadable as history: without this, telling whether a number moved means opening two CI logs
// and reading them side by side.
function writeJsonReport(
  goReport,
  frontendReport,
  hashCheck,
  sensitivityCheck,
  structuralValidation,
  metadata,
) {
  const report = {
    commit: process.env.GITHUB_SHA ?? null,
    generatedAt: new Date().toISOString(),
    hashSpec,
    iterations: benchmarkIterations,
    metadata,
    seed: benchmarkSeed,
    hashCheck: hashCheck && {
      matched: hashCheck.matched,
      firstMismatch: hashCheck.firstMismatch,
      mismatchByCase: Object.fromEntries(hashCheck.mismatchByCase),
    },
    sensitivityCheck: sensitivityCheck && {
      matched: sensitivityCheck.matched,
      firstMismatch: sensitivityCheck.firstMismatch,
      mismatchByCase: Object.fromEntries(sensitivityCheck.mismatchByCase),
    },
    structuralValidation,
    go: serializeGroups(goReport),
    typescript: serializeGroups(frontendReport),
  }

  // Resolved before logging: the path is relative to the working directory rather than to this
  // script, so the bare name alone does not say which directory the run actually wrote to.
  const writtenPath = resolve(reportOutputPath)
  writeFileSync(writtenPath, `${JSON.stringify(report, null, 2)}\n`)
  console.info(`\nWrote ${writtenPath}`)

  const chartsPath = resolve(chartOutputPath)
  writeFileSync(chartsPath, renderBenchmarkCharts(goReport ?? frontendReport))
  console.info(`Wrote ${chartsPath}`)

  const preferredChartsPath = resolve(preferredChartOutputPath)
  writeFileSync(
    preferredChartsPath,
    renderBenchmarkCharts(goReport ?? frontendReport, {
      filterLabel: "Preferred cases only",
      summaryFilter: (summary) => summary.Preferred === "yes",
    }),
  )
  console.info(`Wrote ${preferredChartsPath}`)
}

export function renderBenchmarkCharts(report, options = {}) {
  const firstGroup = report?.groups.values().next().value
  const summaries = realSummaries(firstGroup?.summaries ?? []).filter(
    options.summaryFilter ?? (() => true),
  )
  const branchingCharts = [
    ["Junctions/Maze", "Junctions/maze"],
    ["Junctions/Cell", "Junctions/cell"],
    ["Degree-3/Maze", "Deg3/maze"],
    ["Degree-4 (%)", "%Deg4"],
    ["Zero-Junction (%)", "Zero-J%"],
    ["Dead Ends/Maze", "Dead ends/maze"],
    ["P5 (Junctions/Cell)", "p5"],
    ["P95 (Junctions/Cell)", "p95"],
    ["stddev (Junctions/Cell)", "stddev"],
  ]
  const navigationCharts = [
    ["Path (%)", "Path%"],
    ["W-Branch (%)", (summary) => percentOfBudget(summary.WorstBranch, summary.Budget)],
    ["Error Margin / Cell", errorMarginPerCell],
    ["Conservative (No Batching) Min Win Speed", conservativeMinWinSpeedRatio],
  ]
  const relationshipCharts = [
    ["Skew vs Error Margin / Cell", errorMarginPerCell, summarySkew, "skew"],
    [
      "Junctions/Cell vs Path (%)",
      (summary) => summary["Path%"],
      (summary) => summary["Junctions/cell"],
      "junctions/cell",
    ],
    [
      "Junctions/Cell vs W-Branch (%)",
      worstBranchPercent,
      (summary) => summary["Junctions/cell"],
      "junctions/cell",
    ],
    [
      "Degree-4 (%) vs W-Branch (%)",
      worstBranchPercent,
      (summary) => summary["%Deg4"],
      "degree-4 (%)",
    ],
    [
      "Zero-Junction (%) vs Path (%)",
      (summary) => summary["Path%"],
      (summary) => summary["Zero-J%"],
      "zero-junction (%)",
    ],
    [
      "Path (%) vs Error Margin / Cell",
      errorMarginPerCell,
      (summary) => summary["Path%"],
      "path (%)",
    ],
  ]
  const chartWidth = 360
  const chartHeight = 180
  const gap = 22
  const columns = 2
  const titleSuffix = options.filterLabel ? ` (${options.filterLabel})` : ""
  const allCharts = [
    { title: `Table 2 - Branching distribution${titleSuffix}`, metrics: branchingCharts },
    { title: `Table 3 - Navigation summaries${titleSuffix}`, metrics: navigationCharts },
    { title: `Shape relationships${titleSuffix}`, metrics: relationshipCharts },
  ]
  const sectionHeights = allCharts.map(({ metrics }) => {
    const rows = Math.ceil(metrics.length / columns)
    return 58 + rows * (chartHeight + gap)
  })
  const width = columns * chartWidth + (columns + 1) * gap
  const height = 28 + sectionHeights.reduce((total, sectionHeight) => total + sectionHeight, 0)
  let y = 24

  const sections = allCharts.map((section, index) => {
    const output = renderChartSection({
      chartHeight,
      chartWidth,
      columns,
      gap,
      metrics: section.metrics,
      summaries,
      title: section.title,
      y,
    })
    y += sectionHeights[index]
    return output
  })

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}" role="img" aria-label="Tapoo benchmark line charts">\n` +
    `<style>
      text { font-family: "PT Mono", ui-monospace, SFMono-Regular, Menlo, monospace; fill: #dfe8df; }
      .title { font-size: 18px; font-weight: 700; }
      .label { font-size: 11px; fill: #9aa69c; }
      .panel { fill: #101713; stroke: #2f4137; stroke-width: 1; }
      .axis { stroke: #405247; stroke-width: 1; }
      .grid { stroke: #24322b; stroke-width: 1; }
      .line { fill: none; stroke: #5cc8aa; stroke-width: 2; }
      .point { fill: #f1d065; }
    </style>\n` +
    `<rect width="100%" height="100%" fill="#0b110e"/>\n` +
    sections.join("\n") +
    `\n</svg>\n`
  )
}

function renderChartSection({ chartHeight, chartWidth, columns, gap, metrics, summaries, title, y }) {
  const titleLine = `<text class="title" x="${gap}" y="${y}">${escapeXml(title)}</text>`
  const charts = metrics.map(([label, selector, xSelector, xLabel], index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const x = gap + column * (chartWidth + gap)
    const chartY = y + 34 + row * (chartHeight + gap)
    return renderLineChart({
      height: chartHeight,
      label,
      summaries,
      values: summaries.map((summary) => metricValue(summary, selector)),
      width: chartWidth,
      x,
      xLabel,
      xValues: summaries.map((summary) => metricValue(summary, xSelector ?? summaryArea)),
      y: chartY,
    })
  })

  return [titleLine, ...charts].join("\n")
}

function renderLineChart({ height, label, values, width, x, xLabel = "total cells", xValues, y }) {
  const padding = { bottom: 34, left: 46, right: 18, top: 28 }
  const chartLeft = x + padding.left
  const chartTop = y + padding.top
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom
  const finiteValues = values.filter((value) => Number.isFinite(value))
  const { maxValue, minValue, scaled } = chartScale(finiteValues)
  const finiteXValues = xValues.filter((value) => Number.isFinite(value))
  const { maxValue: maxXValue, minValue: minXValue } = chartScale(finiteXValues)
  const xRange = maxXValue - minXValue || 1
  const range = maxValue - minValue || 1
  const points = values
    .map((value, index) => {
      const xValue = xValues[index]
      if (!Number.isFinite(value) || !Number.isFinite(xValue)) {
        return null
      }
      const px = chartLeft + ((xValue - minXValue) / xRange) * chartWidth
      const py = chartTop + chartHeight - ((value - minValue) / range) * chartHeight
      return { px, py }
    })
    .filter(Boolean)
    .sort((first, second) => first.px - second.px)
  const line = points.map(({ px, py }) => `${roundSvg(px)},${roundSvg(py)}`).join(" ")
  const firstXValue = Number.isFinite(minXValue) ? formatNumber(minXValue) : ""
  const lastXValue = Number.isFinite(maxXValue) ? formatNumber(maxXValue) : ""

  return (
    `<g>\n` +
    `<rect class="panel" x="${x}" y="${y}" width="${width}" height="${height}" rx="6"/>\n` +
    `<text x="${x + 12}" y="${y + 18}" font-size="13">${escapeXml(label)}${scaled ? " (scaled)" : ""}</text>\n` +
    `<line class="grid" x1="${chartLeft}" y1="${chartTop}" x2="${chartLeft + chartWidth}" y2="${chartTop}"/>\n` +
    `<line class="grid" x1="${chartLeft}" y1="${chartTop + chartHeight / 2}" x2="${chartLeft + chartWidth}" y2="${chartTop + chartHeight / 2}"/>\n` +
    `<line class="axis" x1="${chartLeft}" y1="${chartTop + chartHeight}" x2="${chartLeft + chartWidth}" y2="${chartTop + chartHeight}"/>\n` +
    `<line class="axis" x1="${chartLeft}" y1="${chartTop}" x2="${chartLeft}" y2="${chartTop + chartHeight}"/>\n` +
    `<polyline class="line" points="${line}"/>\n` +
    points.map(({ px, py }) => `<circle class="point" cx="${roundSvg(px)}" cy="${roundSvg(py)}" r="2"/>`).join("\n") +
    `\n<text class="label" x="${x + 10}" y="${y + height - 14}">${escapeXml(firstXValue)}</text>\n` +
    `<text class="label" text-anchor="middle" x="${x + width / 2}" y="${y + height - 14}">${escapeXml(xLabel)}</text>\n` +
    `<text class="label" text-anchor="end" x="${x + width - 10}" y="${y + height - 14}">${escapeXml(lastXValue)}</text>\n` +
    `<text class="label" x="${x + 10}" y="${chartTop + 4}">${formatNumber(maxValue)}</text>\n` +
    `<text class="label" x="${x + 10}" y="${chartTop + chartHeight + 4}">${formatNumber(minValue)}</text>\n` +
    `</g>`
  )
}

function chartScale(values) {
  if (values.length === 0) {
    return { maxValue: 1, minValue: 0, scaled: false }
  }

  const observedMin = Math.min(...values)
  const observedMax = Math.max(...values)
  if (observedMin === observedMax) {
    const padding = Math.max(1, Math.abs(observedMax) * 0.1)
    return {
      maxValue: observedMax + padding,
      minValue: observedMin - padding,
      scaled: true,
    }
  }

  const padding = (observedMax - observedMin) * 0.12
  return {
    maxValue: observedMax + padding,
    minValue: observedMin - padding,
    scaled: true,
  }
}

function metricValue(summary, selector) {
  return Number(typeof selector === "function" ? selector(summary) : summary[selector])
}

function summaryArea(summary) {
  return Number(parseCaseName(summary.Case)?.area)
}

function summarySkew(summary) {
  return Number(parseCaseName(summary.Case)?.skew)
}

function chartPathForReport(path, variant = "") {
  const extension = extname(path)
  const suffix = variant ? `.${variant}.charts.svg` : ".charts.svg"
  return extension ? `${path.slice(0, -extension.length)}${suffix}` : `${path}${suffix}`
}

function roundSvg(value) {
  return Number(value.toFixed(2))
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function serializeGroups(report) {
  if (!report) {
    return null
  }

  return Object.fromEntries(
    [...report.groups].map(([groupName, group]) => [
      groupName,
      {
        hashesByCase: Object.fromEntries(report.hashesByCase),
        iterations: group.iterations,
        summaries: group.summaries,
        // Table 3c renders these as directionally-rounded strings; downstream work gets the raw
        // quotients here so it never has to parse a display value back into a number.
        minWinSpeeds: minWinSpeedNumbers(group.summaries),
        validationByCase: Object.fromEntries(report.validationByCase),
      },
    ]),
  )
}

function parseGoBenchmarkLine(line) {
  const match = line.match(
    // [^/]* rather than [^/]+ : the sweep is named exactly BenchmarkMazeBranching, so the slash
    // follows the prefix directly and a mandatory suffix would match nothing at all.
    /^(BenchmarkMazeBranching[^/]*)\/([^\s]+?)-\d+\s+(\d+)\s+([\d.]+)\s+ns\/op\s+(.*)$/,
  )
  if (!match) {
    return null
  }

  const [, group, name, iterations, , metricText] = match
  const metrics = parseReportedMetrics(metricText)

  // Key order is display order: console.table renders keys as inserted. Inputs first, then the
  // headline outcome with its own spread beside it, then the cross-check - so a row reads left to
  // right as "these knobs produced this branching". ns/op is captured by the regex above (needed to
  // parse the line at all) but dropped here: it only reflects generation speed, not maze-generation
  // logic, and was never a valid cross-language comparison.
  return {
    group,
    iterations: Number(iterations),
    summary: {
      "Case": name,
      "Level": formatNumber(metrics.level),
      "Preferred": shapeFitLabel(metrics.preferred),
      "Bias (%)": formatNumber(metrics.bias),
      "Max corridor": formatNumber(metrics.maxCorridor),
      "Junctions/maze": formatNumber(metrics["junctions/maze"]),
      "Deg3/maze": formatNumber(metrics["deg3/maze"]),
      "Deg4/maze": formatNumber(metrics["deg4/maze"]),
      "%Deg4": formatNumber(metrics.deg4Pct),
      "Zero-J%": formatNumber(metrics.zeroJPct),
      "Dead ends/maze": formatNumber(metrics["deadEnds/maze"]),
      "Junctions/cell": formatNumber(metrics["junctions/cell"]),
      "p5": formatNumber(metrics["junction-p5"]),
      "p95": formatNumber(metrics["junction-p95"]),
      "stddev": formatNumber(metrics["junction-stddev"]),
      "Dead ends/cell": formatNumber(metrics["deadEnds/cell"]),
      "PathLen": formatNumber(metrics.pathLen),
      "Path-p5": formatNumber(metrics["path-p5"]),
      "Path-p95": formatNumber(metrics["path-p95"]),
      "Path%": formatNumber(metrics.pathPct),
      "Backtrack": formatNumber(metrics.backtrack),
      "Backtrack-p5": formatNumber(metrics["backtrack-p5"]),
      "Backtrack-p95": formatNumber(metrics["backtrack-p95"]),
      "WorstBranch": formatNumber(metrics.worstBranch),
      "WorstBranch-p5": formatNumber(metrics["worstBranch-p5"]),
      "WorstBranch-p95": formatNumber(metrics["worstBranch-p95"]),
      "Budget": formatNumber(metrics.budget),
      "Headroom": formatNumber(metrics.headroom),
      "Runs": Number(iterations),
    },
  }
}

function parseReportedMetrics(metricText) {
  const tokens = metricText.trim().split(/\s+/)
  const metrics = {}

  for (let index = 0; index + 1 < tokens.length; index += 2) {
    metrics[tokens[index + 1]] = tokens[index]
  }

  return metrics
}

// normalizeSummary restates the TypeScript payload in the same key order as the Go side, so the two
// tables can be read down the same columns rather than re-checked header by header.
function normalizeSummary(summary) {
  return {
    "Case": summary.Case,
    "Level": formatNumber(summary.Level),
    // Both ports emit the numeric encoding; the label is applied here so it exists once.
    "Preferred": shapeFitLabel(summary.Preferred),
    "Bias (%)": formatNumber(summary.Bias),
    "Max corridor": formatNumber(summary["Max corridor"]),
    "Junctions/maze": formatNumber(summary["Junctions/maze"]),
    "Deg3/maze": formatNumber(summary["Deg3/maze"]),
    "Deg4/maze": formatNumber(summary["Deg4/maze"]),
    "%Deg4": formatNumber(summary["%Deg4"]),
    "Zero-J%": formatNumber(summary["Zero-J%"]),
    "Dead ends/maze": formatNumber(summary["Dead ends/maze"]),
    "Junctions/cell": formatNumber(summary["Junctions/cell"]),
    "p5": formatNumber(summary.p5),
    "p95": formatNumber(summary.p95),
    "stddev": formatNumber(summary.stddev),
    "Dead ends/cell": formatNumber(summary["Dead ends/cell"]),
    "PathLen": formatNumber(summary.PathLen),
    "Path-p5": formatNumber(summary["Path-p5"]),
    "Path-p95": formatNumber(summary["Path-p95"]),
    "Path%": formatNumber(summary["Path%"]),
    "Backtrack": formatNumber(summary.Backtrack),
    "Backtrack-p5": formatNumber(summary["Backtrack-p5"]),
    "Backtrack-p95": formatNumber(summary["Backtrack-p95"]),
    "WorstBranch": formatNumber(summary.WorstBranch),
    "WorstBranch-p5": formatNumber(summary["WorstBranch-p5"]),
    "WorstBranch-p95": formatNumber(summary["WorstBranch-p95"]),
    "Budget": formatNumber(summary.Budget),
    "Headroom": formatNumber(summary.Headroom),
    "Runs": Number(summary.Runs),
  }
}

function formatNumber(value) {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) {
    return ""
  }

  return Number(numberValue.toPrecision(4))
}

// Table 3c speed ceilings must use the same fixed-point display precision as gameplay. Reading the
// frontend config keeps the benchmark report from silently drifting if traversalSpeedScaleUnits
// changes again.
function configuredTraversalSpeedScaleUnits() {
  const configPath = resolve("frontend/app/config.ts")
  const configSource = readFileSync(configPath, "utf8")
  const scaleMatch = configSource.match(/traversalSpeedScaleUnits:\s*([\d_]+)/)
  const scaleUnits = Number(scaleMatch?.[1]?.replaceAll("_", ""))

  if (Number.isInteger(scaleUnits) && scaleUnits > 0) {
    return scaleUnits
  }

  throw new Error(`Could not read traversalSpeedScaleUnits from ${configPath}`)
}

// configuredBenchmarkIterations is the single place to change the default benchmark sample count.
// TAPOO_BENCH_ITERATIONS can override it for one-off local or CI benchmark runs.
function configuredBenchmarkIterations() {
  const configuredValue = process.env.TAPOO_BENCH_ITERATIONS
  if (!configuredValue) {
    return 200
  }

  const iterations = Number(configuredValue)
  if (Number.isInteger(iterations) && iterations > 0) {
    return iterations
  }

  console.error(
    `TAPOO_BENCH_ITERATIONS must be a positive integer, got: ${configuredValue}`,
  )
  process.exit(1)
}

// configuredBenchmarkSeed is the one shared seed both ports' PRNG use for this run. Derived fresh
// each invocation (Date.now()) so coverage grows across runs instead of staying pinned to one static
// maze sequence forever - a fixed seed would only ever test that one slice of the generation space,
// letting drift that only shows up elsewhere stay invisible. TAPOO_BENCH_SEED pins a specific value
// to reproduce a past run exactly (the report always prints the seed it used).
function configuredBenchmarkSeed() {
  const configuredValue = process.env.TAPOO_BENCH_SEED
  if (!configuredValue) {
    return Date.now()
  }

  const seed = Number(configuredValue)
  if (Number.isInteger(seed)) {
    return seed
  }

  console.error(`TAPOO_BENCH_SEED must be an integer, got: ${configuredValue}`)
  process.exit(1)
}
