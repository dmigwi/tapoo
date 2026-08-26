import { describe, expect, it } from "vitest"

import {
  branchingDistributionRows,
  caseDefinitionRows,
  costModelRows,
  minWinSpeedRows,
  realSummaries,
  renderBenchmarkCharts,
  routeGeometryRows,
  sensitivityCaseName,
  validationSummary,
} from "../../parity-harness/bench-report.mjs"

const realCaseNames = ["area70_10x7", "area100_10x10"]

const summaries = [
  {
    "Case": "area70_10x7",
    "Level": 1,
    "Preferred": "yes",
    "Bias (%)": 100,
    "Max corridor": 10,
    "Junctions/maze": 0.18,
    "Deg3/maze": 0.18,
    "Deg4/maze": 0,
    "%Deg4": 0,
    "Zero-J%": 84,
    "Dead ends/maze": 2.18,
    "Junctions/cell": 0.0025,
    "p5": 0,
    "p95": 0.0143,
    "stddev": 0.0054,
    "PathLen": 68.2,
    "Path-p5": 65,
    "Path-p95": 70,
    "Path%": 97.43,
    "Backtrack": 1.8,
    "Backtrack-p5": 0,
    "Backtrack-p95": 5,
    "WorstBranch": 1.2,
    "WorstBranch-p5": 0,
    "WorstBranch-p95": 4,
    "Budget": 70,
    "Headroom": 1.8,
  },
  {
    "Case": sensitivityCaseName,
    "Level": 0,
    "Preferred": "",
    "Bias (%)": 100,
    "Max corridor": 10,
    "Junctions/maze": 0,
    "Deg3/maze": 0,
    "Deg4/maze": 0,
    "%Deg4": 0,
    "Zero-J%": 100,
    "Dead ends/maze": 2,
    "Junctions/cell": 0,
    "p5": 0,
    "p95": 0,
    "stddev": 0,
    "PathLen": 25,
    "Path-p5": 25,
    "Path-p95": 25,
    "Path%": 100,
    "Backtrack": 0,
    "Backtrack-p5": 0,
    "Backtrack-p95": 0,
    "WorstBranch": 0,
    "WorstBranch-p5": 0,
    "WorstBranch-p95": 0,
    "Budget": 25,
    "Headroom": 0,
  },
  {
    "Case": "area100_10x10",
    "Level": 7,
    "Preferred": "yes",
    "Bias (%)": 80,
    "Max corridor": 10,
    "Junctions/maze": 1,
    "Deg3/maze": 1,
    "Deg4/maze": 0,
    "%Deg4": 0,
    "Zero-J%": 0,
    "Dead ends/maze": 3,
    "Junctions/cell": 0.01,
    "p5": 0,
    "p95": 0.02,
    "stddev": 0.01,
    "PathLen": 98.01,
    "Path-p5": 99,
    "Path-p95": 100,
    "Path%": 98.01,
    "Backtrack": 1.99,
    "Backtrack-p5": 0,
    "Backtrack-p95": 1,
    "WorstBranch": 1.99,
    "WorstBranch-p5": 0,
    "WorstBranch-p95": 1,
    "Budget": 100,
    "Headroom": 1.99,
  },
]

describe("bench report helpers", () => {
  it("excludes the sensitivity case from real report tables", () => {
    expect(realSummaries(summaries).map((summary) => summary.Case)).toEqual(realCaseNames)
    expect(Object.keys(caseDefinitionRows(summaries))).toEqual(realCaseNames)
    expect(Object.keys(branchingDistributionRows(summaries))).toEqual(realCaseNames)
    expect(Object.keys(routeGeometryRows(summaries))).toEqual(realCaseNames)
    expect(Object.keys(costModelRows(summaries))).toEqual(realCaseNames)
    expect(Object.keys(minWinSpeedRows(summaries))).toEqual(realCaseNames)
  })

  it("formats route geometry rows with structural route metrics", () => {
    expect(routeGeometryRows(summaries).area70_10x7).toEqual({
      "Path Len (Cells)": 68.2,
      "Path P5 (Cells)": 65,
      "Path P95 (Cells)": 70,
      "Path (%)": 97.43,
      "W-Branch (Depth)": 1.2,
      "W-Branch P5 (Depth)": 0,
      "W-Branch P95 (Depth)": 4,
      "Error Margin (Cells)": 1.8,
      "W-Branch (% of Margin)": 66.67,
    })
  })

  it("formats cost model rows with batching error budget and cost projections", () => {
    expect(costModelRows(summaries).area70_10x7).toEqual({
      "Budget (Decay)": 70,
      "Batching (Turns)": 69,
      "Error Budget (Turns)": 1,
      "Error Budget (%)": 1.4,
      "W-Branch Cost (Turns)": "1 - 2",
      "Explore-All Cost (Turns)": "2 - 3",
    })
  })

  it("formats minimum winning speed rows with conservative break-even speed", () => {
    expect(minWinSpeedRows(summaries).area70_10x7).toEqual({
      "Conservative (No Batching) Min Win Speed": "0.9871",
    })
  })

  it("reports only the conservative minimum winning speed reference line", () => {
    expect(minWinSpeedRows(summaries).area100_10x10).toEqual({
      "Conservative (No Batching) Min Win Speed": "0.9900",
    })
  })

  it("renders the conservative minimum winning speed chart", () => {
    const svg = renderBenchmarkCharts({
      groups: new Map([["BenchmarkMazeBranching", { summaries }]]),
    })

    expect(svg).toContain("Conservative (No Batching) Min Win Speed")
  })

  it("formats case definitions separately from branching results", () => {
    expect(caseDefinitionRows(summaries).area70_10x7).toEqual({
      "Level": 1,
      "Grid": "10x7",
      "Area (Cells)": 70,
      "Skew (Ratio)": 1.429,
      "Preferred": "yes",
      "Bias (%)": 100,
      "Max Corridor (Cells)": 10,
    })
  })

  it("keeps branching table columns in their report display order", () => {
    expect(branchingDistributionRows(summaries).area70_10x7).toEqual({
      "Junctions/Maze": 0.18,
      "Degree-3/Maze": 0.18,
      "Degree-4/Maze": 0,
      "Degree-4 (%)": 0,
      "Dead Ends/Maze": 2.18,
      "Zero-Junction (%)": 84,
      "Junctions/Cell": 0.0025,
      "P5": 0,
      "P95": 0.0143,
      "stddev": 0.0054,
    })
  })

  it("reports structural validation failure if either port flags invalid mazes", () => {
    const validReport = {
      validationByCase: new Map([["area70_10x7", { failures: 0, total: 2 }]]),
    }
    const invalidReport = {
      validationByCase: new Map([["area100_10x10", { failures: 1, total: 2 }]]),
    }

    expect(validationSummary([validReport]).matched).toBe(true)
    expect(validationSummary([validReport, invalidReport])).toEqual({
      invalid: [{ caseName: "area100_10x10", failures: 1, total: 2 }],
      matched: false,
      total: 4,
    })
  })
})
