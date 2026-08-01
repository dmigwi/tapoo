import { spawnSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { resolve } from "node:path"

// Parity threshold. Both ports carve the same maze from different random sources, so they can never
// agree maze for maze — only in distribution. A case is therefore flagged on a statistical test
// rather than a raw gap: the two means must sit further apart than the sampling noise in those means
// can account for.
//
// parityMinZ is set well above the usual 2 because the run makes ~23 comparisons, not one. Under
// "no real difference" a z-score is a draw from N(0,1), so at z=2 each case has a 1-in-22 chance of
// flagging: across 23 of them one would flag every run, and at least one would flag in 66% of runs.
// At 3.5 the odds are 1 in 2149 per case, or about one run in 94 — rare enough that a failure is
// worth reading rather than rerunning.
const parityMinZ = 3.5

// parityMinResolutionMultiple guards the one thing z cannot: both ports report metrics at four
// significant digits — Go through b.ReportMetric's formatting, TypeScript through toPrecision(4) —
// so a gap narrower than that rounding may be an artefact of the printing rather than the generator.
// At the iteration counts CI uses this never binds (z corresponds to a gap ~30x wider), but the
// margin closes as iterations rise: at 5,000 the rounding quantum is already half of one standard
// error, and past ~20,000 it exceeds it and would flag on rounding alone.
//
// This deliberately replaced a fixed 0.002 floor justified as "too small to change how a maze
// plays". That reasoning does not hold: the two ports run the same algorithm, so their distributions
// should be identical rather than merely close, and any reproducible gap is a defect whatever its
// size. A practical-significance floor only suppressed real signal at the most sensitive cases.
const parityMinResolutionMultiple = 2

// reportedResolution is the size of the last digit both ports print for a value, which is the
// smallest difference the report can represent.
function reportedResolution(value) {
  if (!Number.isFinite(value) || value === 0) {
    return 0
  }

  return 10 ** (Math.floor(Math.log10(Math.abs(value))) - 3)
}

// Legend layout. 150 is wide enough to keep each entry to one or two lines, which is what stops the
// legend competing with the tables it introduces, and still fits a maximised terminal or a CI log.
const legendLineWidth = 150

// Wide enough for the longest label plus a separating space. printLegendEntry guarantees that space
// regardless, so an over-long label degrades to a ragged line rather than colliding with its text.
const legendLabelWidth = 22

const benchmarkJsonMarker = "TAPOO_BENCH_REPORT:"
const benchmarkIterations = configuredBenchmarkIterations()
const reportOutputPath = process.env.TAPOO_BENCH_OUT ?? "bench-report.json"
const reportMode = process.argv.includes("--go-only")
  ? "go"
  : process.argv.includes("--frontend-only")
    ? "frontend"
    : "combined"
const goReport = reportMode === "frontend" ? null : runGoBenchmarks()
const frontendReport = reportMode === "go" ? null : runFrontendBenchmarks()

printLegend()

if (goReport && !frontendReport) {
  printStandaloneReport("Go maze branching benchmarks", goReport)
} else if (frontendReport && !goReport) {
  printStandaloneReport("TypeScript maze branching benchmarks", frontendReport)
} else {
  printComparisonReport(goReport, frontendReport)
}

// An unmatched case is a harness fault, not a result: the two sweeps are maintained as separate
// lists, so a case added to one and not the other would otherwise shrink the parity check in silence
// while the report still read "0 breached" — fewer cases covered, and nothing saying so.
const { rows: parityRows, unmatched: unmatchedCases } =
  goReport && frontendReport
    ? compareImplementations(goReport, frontendReport)
    : { rows: [], unmatched: [] }

if (parityRows.length > 0) {
  printParityReport(parityRows)
}

if (unmatchedCases.length > 0) {
  console.error(
    `\nBenchmark cases do not match across the two ports, so ${unmatchedCases.length} case(s) went ` +
      "uncompared. Keep branchingShapes() identical in maze/bench and frontend/bench.",
  )
  for (const entry of unmatchedCases) {
    console.error(`  ${entry}`)
  }
  process.exit(1)
}

writeJsonReport(goReport, frontendReport, parityRows)

const breachedRows = parityRows.filter((row) => row.breached)
if (breachedRows.length > 0) {
  console.error(
    `\nParity check failed: ${breachedRows.length} case(s) diverged beyond ` +
      `z ${parityMinZ}. The Go and TypeScript ` +
      `generators are no longer producing the same maze distribution.`,
  )
  process.exit(1)
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

    if (
      line.startsWith("goos:") ||
      line.startsWith("goarch:") ||
      line.startsWith("pkg:") ||
      line.startsWith("cpu:")
    ) {
      metadata.push(line)
    }
  }

  return { groups, metadata, name: "Go" }
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
  }

  return { groups, metadata: [], name: "TypeScript" }
}

// printLegend explains the columns in place. Densities are reported per cell so cases of different
// areas can be compared, but that form is unreadable on its own — junction counts are integers, so a
// per-cell figure is always some multiple of 1/area, and 0.01429 at area 70 is not a small fraction
// but exactly one junction. The legend prints every run because that conversion is the first thing
// anyone needs and the last thing anyone remembers.
function printLegend() {
  console.info("Reading the benchmark report")

  printLegendSection("Benchmark tables")

  printLegendEntry(
    "Case, Level:",
    "Case is the grid shape being measured. Level is the game level that normally uses that area; " +
      "level 0 means the case is synthetic and not tied to a playable level.",
  )
  printLegendEntry(
    "Skew:",
    "long side / short side. 1 is square; larger values are flatter or taller. Compare rows sharing a " +
      "level to see how shape affects the same maze area.",
  )
  printLegendEntry(
    "Preferred:",
    "yes means this is the shape normally chosen when there is enough screen room. '-' means it is a " +
      "fallback shape for constrained viewports.",
  )
  printLegendEntry(
    "Bias(%), Max corr.:",
    "generator inputs, not results. In normal gameplay they are dependent on level area: the level " +
      "sets the area, and that area sets the navigation profile bias and max corridor.",
  )
  printLegendEntry(
    "Junctions/cell:",
    "average branching density. Higher values mean more decision points. Whole junctions are " +
      "Junctions/cell x area, so 0.01429 x 70 is exactly one junction.",
  )
  printLegendEntry(
    "p5, p95:",
    "low and high ends of normal branching variation for the same case. p5 is the easier, " +
      "less-branchy 5% end; p95 is the harder, more-branchy 5% end.",
  )
  printLegendEntry(
    "stddev:",
    "typical spread in the junctions-per-cell share. Multiply by area to estimate the usual " +
      "junction-count swing; 0.010 at area 100 is about 1 junction.",
  )
  printLegendEntry(
    "Dead ends/cell:",
    "cells with only one exit. Use it as a sanity check beside Junctions/cell; both should usually move " +
      "together because every maze is a spanning tree.",
  )
  printLegendEntry(
    "ns/op:",
    "generation time. Compare it within the same language and same case across commits. Do not compare " +
      "Go ns/op directly against TypeScript ns/op.",
  )

  printLegendSection("Parity check")

  printLegendEntry(
    "z:",
    "parity distance between Go and TypeScript. Under 2 is normal random noise; above 3.5 is treated " +
      "as likely implementation drift.",
  )
  printLegendEntry(
    "Difference:",
    "Go Junctions/cell minus TypeScript Junctions/cell. Positive means Go produced more branching for " +
      "that case; negative means TypeScript did.",
  )
  printLegendEntry(
    "Status:",
    "ok means the gap fits normal benchmark noise. DIVERGED means the two ports likely stopped " +
      "producing the same maze distribution.",
  )
  console.info("")
}

function printLegendSection(title) {
  console.info(`\n${title}`)
}

// printLegendEntry wraps one entry to legendLineWidth, hanging the continuation under the text
// rather than the label. Wrapping is computed instead of hand-broken so the entries above stay
// editable prose — hand-wrapped strings drift out of alignment the first time anyone reworks a
// sentence, and the misalignment is invisible until the report is run.
function printLegendEntry(label, text) {
  const indent = " ".repeat(legendLabelWidth)
  const limit = legendLineWidth - legendLabelWidth
  const lines = []
  let current = ""

  for (const word of text.split(/\s+/)) {
    if (current && current.length + word.length + 1 > limit) {
      lines.push(current)
      current = word
      continue
    }

    current = current ? `${current} ${word}` : word
  }

  if (current) {
    lines.push(current)
  }

  // The blank line separating entries is prefixed outside the padded label: inside it, the newline
  // counts toward padEnd and every first line lands one column left of its own continuations.
  const head = `  ${label} `.padEnd(legendLabelWidth)

  console.info(
    `\n${lines.map((line, index) => (index === 0 ? head : indent) + line).join("\n")}`,
  )
}

// groupCaveat records how a table relates to real play. Declared as a function rather than a const
// map because the report prints before this point in the file, where a const would still be in its
// temporal dead zone.
function groupCaveat(groupName) {
  if (
    groupName === "BenchmarkMazeBranching" ||
    groupName === "BenchmarkMazeBranchingByShape"
  ) {
    return (
      "Shape sweep: compare rows sharing a level to see whether viewport-driven shape changes alter " +
      "branching. Area and bias are dependent at a given level, so rows with the same area keep the " +
      "same bias and max corridor."
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

// withShapeComparison keys rows by case and adds the grid's skew.
//
// It briefly carried a "vs pref %" column too — each shape's junction density against the shape a
// real level would be given. That was dropped as uninterpretable rather than merely noisy: at area
// 100 the reference is 0.17 junctions per maze, so a one-junction difference reads as +580% and
// swings by 130 points between identical runs, while a genuine null reads as -0.1732% with four
// significant figures of false precision. The shape question it existed to answer is settled and
// recorded; the raw densities for a given area sit on adjacent rows for anyone who wants to compare.
function withShapeComparison(summaries) {
  const entries = summaries.map((summary) => {
    const parsed = parseCaseName(summary.Case)

    // Case becomes the row key and Runs is dropped: console.table labels the key column "(index)",
    // so keying by name replaces both that column and the Case column, and the run count is already
    // stated once in the line above the table. Runs stays on the summary itself, since the parity
    // z-score divides by it.
    const { Case, Level, Preferred, Runs, ...rest } = summary
    void Runs

    // Non-preferred rows render as "-" rather than an empty cell, so the column reads as
    // answered-and-negative rather than missing. The summary keeps "" for the JSON artifact, where a
    // placeholder would only be something every reader had to strip before testing the flag.
    return [
      Case,
      {
        "Level": Level,
        "Skew": parsed ? formatNumber(parsed.skew) : "",
        "Preferred": Preferred === "yes" ? Preferred : "-",
        ...rest,
      },
    ]
  })

  return Object.fromEntries(entries)
}

// parseCaseName reads the area and shape back out of a case label. The labels are built from those
// numbers in both benches, so deriving them here needs no extra reported metric.
function parseCaseName(name) {
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

// printCaseTable renders a case-keyed table with the key column headed "Case" instead of "(index)".
// Rows are keyed by case name so console.table shows the name in that column rather than a row
// number, but the label itself is fixed inside console.table with no option to set it — so the one
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

function printStandaloneReport(title, report) {
  console.info(title)
  for (const line of report.metadata) {
    console.info(line)
  }

  for (const [groupName, group] of report.groups) {
    console.info(`\n${groupName}`)
    printGroupCaveat(groupName)
    console.info(`${report.name} — ${group.iterations} mazes per case`)
    printCaseTable(withShapeComparison(group.summaries))
  }
}

function printComparisonReport(goReport, frontendReport) {
  console.info("Tapoo maze branching benchmark report")
  for (const line of goReport.metadata) {
    console.info(line)
  }

  for (const [groupName, goGroup] of goReport.groups) {
    const frontendGroup = frontendReport.groups.get(groupName)
    if (!frontendGroup) {
      continue
    }

    console.info(`\n${groupName}`)
    printGroupCaveat(groupName)

    // The sample count belongs here rather than in a column of identical values, and per table
    // rather than shared, so a run with mismatched counts is visible instead of averaged over.
    console.info(`Go — ${goGroup.iterations} mazes per case`)
    printCaseTable(withShapeComparison(goGroup.summaries))
    console.info(`TypeScript — ${frontendGroup.iterations} mazes per case`)
    printCaseTable(withShapeComparison(frontendGroup.summaries))
  }
}

// compareImplementations measures how far apart the two ports' junction densities sit, per case.
// Junction density alone is gated: dead-end density is not an independent signal, since a spanning
// tree's degree budget is fixed by cell count, so suppressing branch points converts both into
// corridor and the two metrics move together by construction.
function compareImplementations(goReport, frontendReport) {
  const rows = []
  const unmatched = []

  for (const [groupName, goGroup] of goReport.groups) {
    const frontendGroup = frontendReport.groups.get(groupName)
    if (!frontendGroup) {
      unmatched.push(`${groupName} — whole group missing from TypeScript`)
      continue
    }

    const frontendByCase = new Map(
      frontendGroup.summaries.map((summary) => [summary.Case, summary]),
    )

    for (const goSummary of goGroup.summaries) {
      const frontendSummary = frontendByCase.get(goSummary.Case)
      if (!frontendSummary) {
        unmatched.push(`${groupName}/${goSummary.Case} — missing from TypeScript`)
        continue
      }

      frontendByCase.delete(goSummary.Case)
      rows.push(compareCase(groupName, goSummary, frontendSummary))
    }

    for (const leftover of frontendByCase.keys()) {
      unmatched.push(`${groupName}/${leftover} — missing from Go`)
    }
  }

  for (const groupName of frontendReport.groups.keys()) {
    if (!goReport.groups.has(groupName)) {
      unmatched.push(`${groupName} — whole group missing from Go`)
    }
  }

  return { rows, unmatched }
}

// compareCase scores one case. The standard error of the difference between two independent means is
// the root of their summed variances over the sample count, which is what turns a raw gap into a
// figure comparable across cases whose spreads differ by an order of magnitude.
function compareCase(groupName, goSummary, frontendSummary) {
  const goMean = Number(goSummary["Junctions/cell"])
  const frontendMean = Number(frontendSummary["Junctions/cell"])
  const goStddev = Number(goSummary.stddev)
  const frontendStddev = Number(frontendSummary.stddev)
  const samples = Math.min(Number(goSummary.Runs), Number(frontendSummary.Runs))

  const difference = goMean - frontendMean
  const standardError = Math.sqrt(
    (goStddev * goStddev + frontendStddev * frontendStddev) / samples,
  )
  const zScore = standardError > 0 ? Math.abs(difference) / standardError : 0
  const resolutionFloor =
    parityMinResolutionMultiple * reportedResolution(Math.max(goMean, frontendMean))
  const breached = zScore > parityMinZ && Math.abs(difference) > resolutionFloor

  return {
    breached,
    case: goSummary.Case,
    difference,
    frontendMean,
    goMean,
    group: groupName,
    samples,
    zScore,
  }
}

function printParityReport(rows) {
  console.info("\nGo vs TypeScript parity (junctions/cell)")
  console.info(
    `Flagged above z ${parityMinZ}, ignoring gaps under ${parityMinResolutionMultiple} times the ` +
      "reported precision.",
  )
  // Keyed by case for the same reason as the tables above: the name is the row's identity, so it
  // belongs in the key column rather than beside a row number. The group name is dropped — one sweep
  // survives, so the prefix named nothing the case did not. The JSON still carries it.
  printCaseTable(
    Object.fromEntries(
      rows.map((row) => [
        row.case,
        {
          "Go": formatNumber(row.goMean),
          "TypeScript": formatNumber(row.frontendMean),
          "Difference": formatNumber(row.difference),
          "z": formatNumber(row.zScore),
          "Status": row.breached ? "DIVERGED" : "ok",
        },
      ]),
    ),
  )

  const worst = rows.reduce(
    (highest, row) => (row.zScore > highest.zScore ? row : highest),
    rows[0],
  )
  console.info(
    `Widest gap: ${worst.case} at z ${formatNumber(worst.zScore)} ` +
      `(${formatNumber(worst.difference)} junctions/cell).`,
  )
}

// writeJsonReport persists the run so it can be compared against other commits. The console tables
// are unreadable as history: without this, telling whether a number moved means opening two CI logs
// and reading them side by side.
function writeJsonReport(goReport, frontendReport, parityRows) {
  const report = {
    commit: process.env.GITHUB_SHA ?? null,
    generatedAt: new Date().toISOString(),
    iterations: benchmarkIterations,
    metadata: goReport?.metadata ?? [],
    parity: parityRows.map((row) => ({
      breached: row.breached,
      case: row.case,
      difference: row.difference,
      frontendMean: row.frontendMean,
      goMean: row.goMean,
      group: row.group,
      samples: row.samples,
      zScore: row.zScore,
    })),
    go: serializeGroups(goReport),
    typescript: serializeGroups(frontendReport),
  }

  // Resolved before logging: the path is relative to the working directory rather than to this
  // script, so the bare name alone does not say which directory the run actually wrote to.
  const writtenPath = resolve(reportOutputPath)
  writeFileSync(writtenPath, `${JSON.stringify(report, null, 2)}\n`)
  console.info(`\nWrote ${writtenPath}`)
}

function serializeGroups(report) {
  if (!report) {
    return null
  }

  return Object.fromEntries(
    [...report.groups].map(([groupName, group]) => [
      groupName,
      { iterations: group.iterations, summaries: group.summaries },
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

  const [, group, name, iterations, nsPerOp, metricText] = match
  const metrics = parseReportedMetrics(metricText)

  // Key order is display order: console.table renders keys as inserted. Inputs first, then the
  // headline outcome with its own spread beside it, then the cross-check, then run cost — so a row
  // reads left to right as "these knobs produced this branching".
  return {
    group,
    iterations: Number(iterations),
    summary: {
      "Case": name,
      "Level": formatNumber(metrics.level),
      "Preferred": Number(metrics.preferred) === 1 ? "yes" : "",
      "Bias (%)": formatNumber(metrics.bias),
      "Max corridor": formatNumber(metrics.maxCorridor),
      "Junctions/cell": formatNumber(metrics["junctions/cell"]),
      "p5": formatNumber(metrics["junction-p5"]),
      "p95": formatNumber(metrics["junction-p95"]),
      "stddev": formatNumber(metrics["junction-stddev"]),
      "Dead ends/cell": formatNumber(metrics["deadEnds/cell"]),
      "ns/op": formatNumber(nsPerOp),
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
    "Preferred": summary.Preferred,
    "Bias (%)": formatNumber(summary.Bias),
    "Max corridor": formatNumber(summary["Max corridor"]),
    "Junctions/cell": formatNumber(summary["Junctions/cell"]),
    "p5": formatNumber(summary.p5),
    "p95": formatNumber(summary.p95),
    "stddev": formatNumber(summary.stddev),
    "Dead ends/cell": formatNumber(summary["Dead ends/cell"]),
    "ns/op": formatNumber(summary["ns/op"]),
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
