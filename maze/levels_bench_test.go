package maze_test

import (
	"fmt"
	"math"
	"slices"
	"testing"

	"github.com/dmigwi/tapoo/maze"
)

// branchingCase is one maze shape in the sweep, named by area so the grouping is readable in the
// benchmark output.
type branchingCase struct {
	name string
	cols int
	rows int
}

// branchingShapes lists the shapes that separate the navigation knobs from grid geometry. Cases
// sharing an area hold the whole navigation profile constant while varying the row count, which is
// the only way to see grid shape acting on its own: LeastNeighborsBias is derived from area alone,
// so no configuration can vary the knob with the grid held fixed.
func branchingShapes() []branchingCase {
	return []branchingCase{
		{name: "area70/10x7", cols: 10, rows: 7},
		{name: "area70/7x10", cols: 7, rows: 10},
		{name: "area70/35x2", cols: 35, rows: 2},
		{name: "area280/40x7", cols: 40, rows: 7},
		{name: "area280/20x14", cols: 20, rows: 14},
		{name: "area1600/40x40", cols: 40, rows: 40},
		{name: "area1600/160x10", cols: 160, rows: 10},
	}
}

// distribution holds the figures a mean alone would hide: spread, and the two tails.
type distribution struct {
	mean   float64
	stddev float64
	low    float64
	high   float64
}

// summarize reduces one sample set to its distribution. A knob that widens variance without moving
// the mean, or one that only bites on unlucky layouts, is invisible in an average but plain here.
func summarize(samples []float64) distribution {
	if len(samples) == 0 {
		return distribution{}
	}

	var summary distribution
	for _, sample := range samples {
		summary.mean += sample
	}
	summary.mean /= float64(len(samples))

	for _, sample := range samples {
		summary.stddev += (sample - summary.mean) * (sample - summary.mean)
	}
	summary.stddev = math.Sqrt(summary.stddev / float64(len(samples)))

	sorted := slices.Clone(samples)
	slices.Sort(sorted)
	summary.low = sorted[len(sorted)*5/100]
	summary.high = sorted[len(sorted)*95/100]

	return summary
}

// measureBranching samples one grid-and-profile pairing and reports the distribution it produces.
// These are measurements, not assertions: generation is random, so any single maze proves nothing,
// and a pass/fail threshold on the mean would be either loose enough to miss real drift or tight
// enough to flake. Reporting instead gives benchstat something to compare across commits, and prints
// each knob beside its outcome so a knob that moves nothing is visible in the same table.
func measureBranching(b *testing.B, config maze.Dimensions, profile maze.NavigationProfile) {
	b.Helper()

	totalCells := config.NumCols * config.NumRows
	junctionFractions := make([]float64, 0, b.N)
	deadEndFractions := make([]float64, 0, b.N)

	for b.Loop() {
		grid, err := config.GenerateMazeWithProfile(maze.WallWeightRegular, profile)
		if err != nil {
			b.Fatalf("GenerateMazeWithProfile returned error: %v", err)
		}

		junctions, deadEnds := 0, 0
		for cellNo := 1; cellNo <= totalCells; cellNo++ {
			switch exits := countOpenExits(config, grid, cellNo); {
			case exits >= 3:
				junctions++
			case exits == 1:
				deadEnds++
			}
		}

		junctionFractions = append(junctionFractions, float64(junctions)/float64(totalCells))
		deadEndFractions = append(deadEndFractions, float64(deadEnds)/float64(totalCells))
	}

	junctions := summarize(junctionFractions)
	deadEnds := summarize(deadEndFractions)

	b.ReportMetric(float64(profile.LeastNeighborsBias), "bias")
	b.ReportMetric(float64(profile.MaxCorridorLength), "maxCorridor")
	b.ReportMetric(junctions.mean, "junctions/cell")
	b.ReportMetric(junctions.stddev, "junction-stddev")
	b.ReportMetric(junctions.low, "junction-p5")
	b.ReportMetric(junctions.high, "junction-p95")
	b.ReportMetric(deadEnds.mean, "deadEnds/cell")
}

// BenchmarkMazeBranchingByShape sweeps grid shapes under the profile GetNavigationProfile derives,
// which is what players actually get.
//
//	go test ./maze -run '^$' -bench BenchmarkMazeBranching -benchtime 200x
//
// Its bias column therefore moves only because area does — the two cannot be separated here, so read
// this as the shipped scaling curve rather than the knob's effect. BenchmarkMazeBranchingByBias
// below is what isolates the knob.
func BenchmarkMazeBranchingByShape(b *testing.B) {
	for _, benchCase := range branchingShapes() {
		b.Run(benchCase.name, func(b *testing.B) {
			config := maze.Dimensions{NumCols: benchCase.cols, NumRows: benchCase.rows}
			measureBranching(b, config, maze.GetNavigationProfile(config))
		})
	}
}

// BenchmarkMazeBranchingByBias holds the grid and the corridor cap fixed and moves only the
// least-neighbors bias, which is the one arrangement that attributes a change to that knob. The
// resulting curve is near-linear rather than inverse: junction density falls by roughly 0.0009 per
// bias point across the whole range, a ~12x reduction end to end, and full bias leaves a floor of
// about 2 junctions per maze rather than none.
func BenchmarkMazeBranchingByBias(b *testing.B) {
	config := maze.Dimensions{NumCols: 20, NumRows: 14}

	for bias := 0; bias <= 100; bias += 10 {
		b.Run(fmt.Sprintf("bias%03d", bias), func(b *testing.B) {
			measureBranching(b, config, maze.NavigationProfile{
				MaxCorridorLength:  8,
				LeastNeighborsBias: bias,
			})
		})
	}
}
