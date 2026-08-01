package maze_test

import (
	"math"
	"slices"
	"strings"
	"testing"

	"github.com/dmigwi/tapoo/maze"
)

// benchmarkWarmupIterations is the discarded generations each case runs before timing starts, so no
// case is privileged by happening to run after the caches are already warm.
const benchmarkWarmupIterations = 20

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
		// Areas carrying several shapes are skew ladders: same area means the same navigation profile,
		// so the whole profile is pinned and only the aspect ratio moves. Any spread within a ladder is
		// grid geometry acting alone. The ladders sit at four points down the bias range (100, 57, 28,
		// 0) because the shape effect is not constant — it is largest where the bias is working hardest
		// to suppress branching, and nearly absent once the bias is off.
		{name: "area70_10x7", cols: 10, rows: 7},
		{name: "area70_7x10", cols: 7, rows: 10},

		{name: "area100_10x10", cols: 10, rows: 10},
		{name: "area100_20x5", cols: 20, rows: 5},
		{name: "area100_25x4", cols: 25, rows: 4},
		{name: "area100_50x2", cols: 50, rows: 2},

		{name: "area280_40x7", cols: 40, rows: 7},
		{name: "area280_20x14", cols: 20, rows: 14},

		{name: "area400_20x20", cols: 20, rows: 20},
		{name: "area400_40x10", cols: 40, rows: 10},
		{name: "area400_80x5", cols: 80, rows: 5},
		{name: "area400_100x4", cols: 100, rows: 4},

		{name: "area600_25x24", cols: 25, rows: 24},
		{name: "area600_30x20", cols: 30, rows: 20},
		{name: "area600_60x10", cols: 60, rows: 10},

		{name: "area900_30x30", cols: 30, rows: 30},
		{name: "area900_60x15", cols: 60, rows: 15},
		{name: "area900_90x10", cols: 90, rows: 10},
		{name: "area900_150x6", cols: 150, rows: 6},

		{name: "area1600_40x40", cols: 40, rows: 40},
		{name: "area1600_80x20", cols: 80, rows: 20},
		{name: "area1600_160x10", cols: 160, rows: 10},
		{name: "area1600_400x4", cols: 400, rows: 4},
	}
}

// levelForArea finds the game level whose target area matches this case, by asking the production
// function rather than restating its seed and step. A case that stops matching any level means the
// area formula moved, which is worth seeing in the table rather than discovering later.
func levelForArea(area int) int {
	for level := 1; level <= 10_000; level++ {
		target := maze.GenerateMazeArea(level)
		if target == area {
			return level
		}
		if target > area {
			break
		}
	}

	return 0
}

// roomyViewport is large enough that GetMazeDimensions is never constrained by screen room, so what
// it returns is the shape the selector prefers on merit rather than the best that happened to fit.
func roomyViewport() maze.Dimensions {
	return maze.Dimensions{NumCols: 500, NumRows: 500}
}

// isPreferredShape asks the production selector whether this is the grid a level would actually be
// given. It is answered here, in Go, rather than by restating the squarest-fit rule in the report:
// a third copy of that rule would keep agreeing with itself after this one changed.
func isPreferredShape(config maze.Dimensions) bool {
	level := levelForArea(config.NumCols * config.NumRows)
	if level == 0 {
		return false
	}

	selected, err := maze.GetMazeDimensions(level, roomyViewport())
	if err != nil {
		return false
	}

	return (selected.NumCols == config.NumCols && selected.NumRows == config.NumRows) ||
		(selected.NumCols == config.NumRows && selected.NumRows == config.NumCols)
}

// branchingSample is one generated maze reduced to the two densities the sweep reports. It mirrors
// BranchingSample in frontend/bench, so both ports measure the same pair per maze.
type branchingSample struct {
	junctionFraction float64
	deadEndFraction  float64
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

	// sampleOnce is shared by the warm-up and the timed loop so both do identical work. Warming only
	// generation would leave the counting pass cold, and at these areas that pass dominates: a warm-up
	// that skips it barely moves the first case's ns/op.
	sampleOnce := func() branchingSample {
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

		return branchingSample{
			junctionFraction: float64(junctions) / float64(totalCells),
			deadEndFraction:  float64(deadEnds) / float64(totalCells),
		}
	}

	// Discarded warm-up, so the first case does not absorb cold-cache and branch-predictor cost and
	// read slower than an identical case later in the sweep. b.Loop excludes anything before it from
	// the timer, so this costs wall-clock only.
	for range benchmarkWarmupIterations {
		sampleOnce()
	}

	for b.Loop() {
		sample := sampleOnce()
		junctionFractions = append(junctionFractions, sample.junctionFraction)
		deadEndFractions = append(deadEndFractions, sample.deadEndFraction)
	}

	junctions := summarize(junctionFractions)
	deadEnds := summarize(deadEndFractions)

	b.ReportMetric(float64(levelForArea(totalCells)), "level")
	preferred := 0.0
	if isPreferredShape(config) {
		preferred = 1
	}
	b.ReportMetric(preferred, "preferred")
	b.ReportMetric(float64(profile.LeastNeighborsBias), "bias")
	b.ReportMetric(float64(profile.MaxCorridorLength), "maxCorridor")
	b.ReportMetric(junctions.mean, "junctions/cell")
	b.ReportMetric(junctions.stddev, "junction-stddev")
	b.ReportMetric(junctions.low, "junction-p5")
	b.ReportMetric(junctions.high, "junction-p95")
	b.ReportMetric(deadEnds.mean, "deadEnds/cell")
}

// countOpenExits reports how many logical neighbors are reachable through open wall segments.
func countOpenExits(config maze.Dimensions, grid [][]string, cellNo int) int {
	address := config.GetCellAddress(cellNo)
	neighbors := config.GetCellNeighbors(cellNo)
	open := 0

	isOpen := func(point [2]int) bool {
		return strings.TrimSpace(grid[point[0]][point[1]]) == ""
	}

	if neighbors.Bottom != 0 && isOpen(address.BottomCenter) {
		open++
	}
	if neighbors.Left != 0 && isOpen(address.MiddleLeft) {
		open++
	}
	if neighbors.Right != 0 && isOpen(address.MiddleRight) {
		open++
	}
	if neighbors.Top != 0 && isOpen(address.TopCenter) {
		open++
	}

	return open
}

// BenchmarkMazeBranching sweeps grid shapes under the profile GetNavigationProfile derives,
// which is the only combination the game can produce. Area and bias are not independent inputs —
// both follow from the level — so a sweep that varied them separately would report states no round
// can reach, and a number that cannot occur in production cannot be used to judge production.
//
//	go test ./maze/bench -run '^$' -bench BenchmarkMazeBranching -benchtime 100x
//
// The cost is that this cannot attribute anything to the bias on its own: it moves only because area
// does. Attribution belongs in the test suite, where TestJunctionDensityFollowsBiasMixture pins the
// bias at a fixed grid and asserts the response curve. That arrangement is counterfactual by
// necessity, which is exactly why it is an assertion made once rather than a metric reported forever.
func BenchmarkMazeBranching(b *testing.B) {
	for _, benchCase := range branchingShapes() {
		b.Run(benchCase.name, func(b *testing.B) {
			config := maze.Dimensions{NumCols: benchCase.cols, NumRows: benchCase.rows}
			measureBranching(b, config, maze.GetNavigationProfile(config))
		})
	}
}
