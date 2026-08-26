package maze_test

import (
	"encoding/json"
	"fmt"
	"hash/fnv"
	"math"
	"os"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/dmigwi/tapoo/maze"
)

// benchmarkWarmupIterations is the discarded generations each case runs before timing starts, so no
// case is privileged by happening to run after the caches are already warm.
const benchmarkWarmupIterations = 20
const benchmarkRenderCellStep = 2

// benchmarkHashesMarker prefixes one stdout line per case listing every timed sample's maze
// adjacency hash, mirroring frontend/bench/maze-test.benchmark.ts's TAPOO_BENCH_REPORT: marker-line
// convention. b.ReportMetric only carries a single float64 per (name, run), so it cannot carry this
// list — parity-harness/bench-report.mjs scans stdout for this prefix instead.
const benchmarkHashesMarker = "TAPOO_BENCH_HASHES:"
const benchmarkValidationMarker = "TAPOO_BENCH_VALIDATION:"

// configuredBenchmarkSeed reads the shared cross-language seed parity-harness/bench-report.mjs derives and
// forwards to both ports each run, so the same maze sequence is generated on both sides. Defaults to
// 1 so this benchmark still runs deterministically when invoked directly (go test ./maze/bench ...)
// without going through the parity-harness report entrypoint.
func configuredBenchmarkSeed() int {
	configuredValue := os.Getenv("TAPOO_BENCH_SEED")
	if configuredValue == "" {
		return 1
	}

	seed, err := strconv.Atoi(configuredValue)
	if err != nil {
		panic(fmt.Sprintf("TAPOO_BENCH_SEED must be an integer, got: %s", configuredValue))
	}

	return seed
}

// configuredBenchmarkIterations reads the sample count parity-harness/bench-report.mjs also passes via
// -benchtime Nx, so the warm-up cap below can match it exactly. b.N cannot be used for this: it stays
// 1 throughout when using the newer b.Loop() API (verified directly) rather than reflecting the
// -benchtime target, so the actual count has to come from this env var instead. Defaults to
// benchmarkWarmupIterations itself when unset (e.g. go test ./maze/bench -bench ... run directly,
// without going through the parity-harness report entrypoint), which keeps every warm-up sample running as it always did.
func configuredBenchmarkIterations() int {
	configuredValue := os.Getenv("TAPOO_BENCH_ITERATIONS")
	if configuredValue == "" {
		return benchmarkWarmupIterations
	}

	iterations, err := strconv.Atoi(configuredValue)
	if err != nil || iterations <= 0 {
		panic(fmt.Sprintf("TAPOO_BENCH_ITERATIONS must be a positive integer, got: %s", configuredValue))
	}

	return iterations
}

// newXorshift128Generator returns a small, deterministic maze.PRNGGenerator for tests — the same
// algorithm as maze/maze_test.go's newXorshift128Generator and frontend/app/maze.test.ts's
// createXorshift128Generator (standard 4-word xorshift128, uint32 throughout so every shift is
// logical/zero-filling, matching JS's >>> bit for bit). Duplicated rather than imported because Go
// test files aren't part of an importable package API, even across two directories that both happen
// to declare `package maze_test`.
func newXorshift128Generator(seed int) maze.PRNGGenerator {
	x := uint32(seed)
	if x == 0 {
		x = 1
	}
	y, z, w := uint32(362436069), uint32(521288629), uint32(88675123)

	return func(limit int) (int, error) {
		if limit <= 0 {
			return 0, nil
		}

		t := x ^ (x << 11)
		x, y, z = y, z, w
		w = (w ^ (w >> 19)) ^ (t ^ (t >> 8))
		return int(w % uint32(limit)), nil
	}
}

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

		{name: "area130_13x10", cols: 13, rows: 10},

		{name: "area180_18x10", cols: 18, rows: 10},

		{name: "area280_40x7", cols: 40, rows: 7},
		{name: "area280_20x14", cols: 20, rows: 14},

		{name: "area400_20x20", cols: 20, rows: 20},
		{name: "area400_40x10", cols: 40, rows: 10},
		{name: "area400_80x5", cols: 80, rows: 5},
		{name: "area400_100x4", cols: 100, rows: 4},

		{name: "area500_25x20", cols: 25, rows: 20},

		{name: "area600_25x24", cols: 25, rows: 24},
		{name: "area600_30x20", cols: 30, rows: 20},
		{name: "area600_60x10", cols: 60, rows: 10},

		{name: "area750_30x25", cols: 30, rows: 25},

		{name: "area900_30x30", cols: 30, rows: 30},
		{name: "area900_45x20", cols: 45, rows: 20},
		{name: "area900_60x15", cols: 60, rows: 15},
		{name: "area900_90x10", cols: 90, rows: 10},
		{name: "area900_150x6", cols: 150, rows: 6},

		{name: "area1100_44x25", cols: 44, rows: 25},

		{name: "area1260_42x30", cols: 42, rows: 30},

		{name: "area1500_50x30", cols: 50, rows: 30},

		{name: "area1600_40x40", cols: 40, rows: 40},
		{name: "area1600_80x20", cols: 80, rows: 20},
		{name: "area1600_160x10", cols: 160, rows: 10},
		{name: "area1600_400x4", cols: 400, rows: 4},

		// sensitivityCaseName runs through this exact same sweep, not a separate synthetic check — see
		// its own comment below for why.
		{name: sensitivityCaseName, cols: 5, rows: 5},
	}
}

// sensitivityCaseName is a real benchmark case, generated and hashed through the exact same pipeline
// as every other shape in this sweep, whose only difference is a deliberately offset seed (see
// seedForCase) on this side only. frontend/bench/maze-test.benchmark.ts uses the same shared seed as
// every other case for this name, so the two sides are expected to generate genuinely different
// mazes here and nowhere else — proving, with two real, independent generation runs rather than an
// edited hash, that parity-harness/bench-report.mjs's comparison actually detects real divergence when it
// occurs.
const sensitivityCaseName = "sensitivity_area25_5x5"

// seedForCase returns the shared cross-language seed for every case except sensitivityCaseName, which
// is deliberately offset by 1 on this side only.
func seedForCase(caseName string) int {
	seed := configuredBenchmarkSeed()
	if caseName == sensitivityCaseName {
		return seed + 1
	}

	return seed
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

// Shape-fit statuses reported as the "preferred" metric. Encoded as numbers because b.ReportMetric
// carries float64s; parity-harness/bench-report.mjs maps them back to the labels the table prints.
const (
	shapeTooBig     = -1.0
	shapeFits       = 0.0
	shapeIsSelected = 1.0
)

// baseViewport is the maze-cell grid both ports measure their Preferred column against: 70x45,
// 3150 cells. It is a fixed baseline for the report, not something this port measures — the Go game
// takes its viewport from UI.ViewportSize, which returns termbox character cells directly and never
// sees a pixel.
//
// The number comes from the browser port, where a real display can be named. A 16-inch screen of
// 3456x2234 physical pixels reduces like this:
//   - at devicePixelRatio 2, 3456x2234 physical px is 1728x1117 CSS px;
//   - measured on the page, ten PT Mono sample characters span about 60 CSS px (so 6px per
//     character) and one text row is about 11 CSS px, giving 288 character columns by 101 rows;
//   - getTerminalSize then applies the same insets and scales GetTerminalSize applies here —
//     (288-5)/4 columns and (101-10)/2 rows.
//
// Only the last step is shared. The pixel arithmetic above it is the browser's alone, and this
// package joins the derivation at its output: a character-cell viewport, which is exactly what
// termbox hands the real game. Adopting the browser's figure is what lets both ports put the same
// question to their own selectors; deriving one here from a display this binary cannot observe
// would be inventing a measurement.
//
// An earlier version passed a deliberately huge 500x500 viewport so the selector was never
// constrained. That answered "what would be chosen on merit" rather than what a real screen gets,
// which is the question a reader actually has.
//
// Every level this sweep covers fits 3150 cells by area, so a too-big row is a statement about the
// row's aspect ratio rather than its size: 400x4 needs 400 columns where 70 exist, while 40x40 of
// the same area is playable.
func baseViewport() maze.Dimensions {
	return maze.Dimensions{NumCols: 70, NumRows: 45}
}

// shapeFitStatus asks the production selector what baseViewport would do with this grid's level. It
// is answered here, in Go, rather than by restating the squarest-fit rule in the report: a third
// copy of that rule would keep agreeing with itself after this one changed.
//
// Three outcomes, because two could not distinguish them: the level does not fit this display at
// all, it fits but the selector picks a different shape for it, or it is the shape the selector
// picks. A row can be unselected while the shape the selector *would* pick is absent from the sweep
// — the sweep is a geometry ladder, not a catalogue of production choices — so an area with no
// selected row is expected rather than a gap to fill.
func shapeFitStatus(config maze.Dimensions) float64 {
	level := levelForArea(config.NumCols * config.NumRows)
	if level == 0 {
		return shapeFits
	}

	selected, err := maze.GetMazeDimensions(level, baseViewport())
	if err != nil {
		return shapeTooBig
	}

	// Orientation is part of the answer, not noise to normalise away. Accepting a rotation here
	// marked both 10x7 and 7x10 as selected for area 70, which contradicts the column's own claim to
	// name the shape the selector picks — one shape, not a pair. baseViewport is landscape, so the
	// selector's aspect-mismatch scoring has a definite preference between the two; deferring to it
	// is what makes the tiebreak defined rather than restated here.
	if selected.NumCols == config.NumCols && selected.NumRows == config.NumRows {
		return shapeIsSelected
	}

	// The level fits, but this particular grid may still be wider or taller than the display even
	// when a different arrangement of the same area is playable.
	fits := (config.NumCols <= baseViewport().NumCols && config.NumRows <= baseViewport().NumRows) ||
		(config.NumRows <= baseViewport().NumCols && config.NumCols <= baseViewport().NumRows)
	if !fits {
		return shapeTooBig
	}

	return shapeFits
}

// branchingSample is one generated maze reduced to the two densities the sweep reports, plus its
// decoded-adjacency hash. It mirrors BranchingSample in frontend/bench, so both ports measure the
// same pair per maze and compute the same hash.
type branchingSample struct {
	junctionFraction float64
	deadEndFraction  float64
	junctions        float64
	deadEnds         float64
	degree3          float64
	degree4          float64
	pathLength       float64
	backtrackCells   float64
	worstBranch      float64
	adjacencyHash    string
	validStructure   bool
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
func measureBranching(b *testing.B, caseName string, config maze.Dimensions, profile maze.NavigationProfile) {
	b.Helper()

	totalCells := config.NumCols * config.NumRows
	junctionFractions := make([]float64, 0, b.N)
	deadEndFractions := make([]float64, 0, b.N)
	junctionCounts := make([]float64, 0, b.N)
	deadEndCounts := make([]float64, 0, b.N)
	degree3Counts := make([]float64, 0, b.N)
	degree4Counts := make([]float64, 0, b.N)
	pathLengths := make([]float64, 0, b.N)
	backtrackCells := make([]float64, 0, b.N)
	worstBranches := make([]float64, 0, b.N)
	hashes := make([]string, 0, b.N)
	zeroJunctions := 0
	structuralFailures := 0

	// generator is seeded once per benchmark case and reused across every warm-up/timed sample.
	// seedForCase reads the shared seed parity-harness/bench-report.mjs derives and forwards to both ports
	// each run, so a repeated go test -bench run generates the exact same sequence of mazes as the
	// matching frontend/bench run for this case — except sensitivityCaseName, deliberately offset.
	generator := newXorshift128Generator(seedForCase(caseName))

	// sampleOnce is shared by the warm-up and the timed loop so both do identical work. Warming only
	// generation would leave the counting pass cold, and at these areas that pass dominates: a warm-up
	// that skips it barely moves the first case's ns/op.
	sampleOnce := func() branchingSample {
		grid, err := config.GenerateMazeWithProfile(maze.WallWeightRegular, profile, generator)
		if err != nil {
			b.Fatalf("GenerateMazeWithProfile returned error: %v", err)
		}

		junctions, deadEnds, degree3, degree4 := 0, 0, 0, 0
		for cellNo := 1; cellNo <= totalCells; cellNo++ {
			switch countOpenExits(config, grid, cellNo) {
			case 3:
				junctions++
				degree3++
			case 4:
				junctions++
				degree4++
			case 1:
				deadEnds++
			}
		}

		nav := measureNavigationBurden(config, grid)
		return branchingSample{
			junctionFraction: float64(junctions) / float64(totalCells),
			deadEndFraction:  float64(deadEnds) / float64(totalCells),
			junctions:        float64(junctions),
			deadEnds:         float64(deadEnds),
			degree3:          float64(degree3),
			degree4:          float64(degree4),
			pathLength:       nav.pathLength,
			backtrackCells:   nav.backtrackCells,
			worstBranch:      nav.worstBranch,
			adjacencyHash:    mazeAdjacencyHash(config, grid),
			validStructure:   validMazeStructure(config, grid),
		}
	}

	// Discarded warm-up, so the first case does not absorb cold-cache and branch-predictor cost and
	// read slower than an identical case later in the sweep. b.Loop excludes anything before it from
	// the timer, so this costs wall-clock only. Capped at b.N (mirroring frontend/bench/maze-test.benchmark.ts's
	// identical cap) rather than always running the full benchmarkWarmupIterations: the generator is
	// shared and stateful across warm-up and timed samples alike, so the two ports must draw exactly
	// the same number of warm-up samples or their PRNG state permanently desyncs from that point on —
	// an uncapped side burning more warm-up draws than the other would silently break every later
	// hash comparison, even though the actual maze-generation logic in both is correct.
	warmupCount := min(benchmarkWarmupIterations, configuredBenchmarkIterations())
	for range warmupCount {
		sampleOnce()
	}

	for b.Loop() {
		sample := sampleOnce()
		junctionFractions = append(junctionFractions, sample.junctionFraction)
		deadEndFractions = append(deadEndFractions, sample.deadEndFraction)
		junctionCounts = append(junctionCounts, sample.junctions)
		deadEndCounts = append(deadEndCounts, sample.deadEnds)
		degree3Counts = append(degree3Counts, sample.degree3)
		degree4Counts = append(degree4Counts, sample.degree4)
		pathLengths = append(pathLengths, sample.pathLength)
		backtrackCells = append(backtrackCells, sample.backtrackCells)
		worstBranches = append(worstBranches, sample.worstBranch)
		hashes = append(hashes, sample.adjacencyHash)
		if sample.junctions == 0 {
			zeroJunctions++
		}
		if !sample.validStructure {
			structuralFailures++
		}
	}

	junctions := summarize(junctionFractions)
	deadEnds := summarize(deadEndFractions)
	junctionsPerMaze := summarize(junctionCounts)
	deadEndsPerMaze := summarize(deadEndCounts)
	degree3 := summarize(degree3Counts)
	degree4 := summarize(degree4Counts)
	pathSummary := summarize(pathLengths)
	backtrackSummary := summarize(backtrackCells)
	worstBranchSummary := summarize(worstBranches)

	hashesJSON, err := json.Marshal(hashes)
	if err != nil {
		b.Fatalf("failed to marshal maze adjacency hashes: %v", err)
	}
	// Printed directly (not via b.Log), so it lands on stdout unconditionally rather than only under
	// -v — parity-harness/bench-report.mjs scans plain stdout for this marker the same way it already scans
	// for frontend/bench's TAPOO_BENCH_REPORT: lines.
	fmt.Printf("%s%s:%s\n", benchmarkHashesMarker, caseName, hashesJSON)
	fmt.Printf(
		"%s%s:{\"total\":%d,\"failures\":%d}\n",
		benchmarkValidationMarker,
		caseName,
		len(hashes),
		structuralFailures,
	)

	b.ReportMetric(float64(levelForArea(totalCells)), "level")
	b.ReportMetric(shapeFitStatus(config), "preferred")
	b.ReportMetric(float64(profile.LeastNeighborsBias), "bias")
	b.ReportMetric(float64(profile.MaxCorridorLength), "maxCorridor")
	b.ReportMetric(junctionsPerMaze.mean, "junctions/maze")
	b.ReportMetric(degree3.mean, "deg3/maze")
	b.ReportMetric(degree4.mean, "deg4/maze")
	degree4Pct := 0.0
	if junctionsPerMaze.mean > 0 {
		degree4Pct = degree4.mean / junctionsPerMaze.mean * 100
	}
	b.ReportMetric(degree4Pct, "deg4Pct")
	b.ReportMetric(float64(zeroJunctions)/float64(len(hashes))*100, "zeroJPct")
	b.ReportMetric(deadEndsPerMaze.mean, "deadEnds/maze")
	b.ReportMetric(junctions.mean, "junctions/cell")
	b.ReportMetric(junctions.stddev, "junction-stddev")
	b.ReportMetric(junctions.low, "junction-p5")
	b.ReportMetric(junctions.high, "junction-p95")
	b.ReportMetric(deadEnds.mean, "deadEnds/cell")
	b.ReportMetric(pathSummary.mean, "pathLen")
	b.ReportMetric(pathSummary.low, "path-p5")
	b.ReportMetric(pathSummary.high, "path-p95")
	b.ReportMetric(pathSummary.mean/float64(totalCells)*100, "pathPct")
	b.ReportMetric(backtrackSummary.mean, "backtrack")
	b.ReportMetric(backtrackSummary.low, "backtrack-p5")
	b.ReportMetric(backtrackSummary.high, "backtrack-p95")
	b.ReportMetric(worstBranchSummary.mean, "worstBranch")
	b.ReportMetric(worstBranchSummary.low, "worstBranch-p5")
	b.ReportMetric(worstBranchSummary.high, "worstBranch-p95")
	b.ReportMetric(float64(totalCells), "budget")
	b.ReportMetric(float64(totalCells)-pathSummary.mean, "headroom")
}

type navigationBurden struct {
	pathLength     float64
	backtrackCells float64
	worstBranch    float64
}

func measureNavigationBurden(config maze.Dimensions, grid [][]string) navigationBurden {
	totalCells := config.NumCols * config.NumRows
	startCell := cellNoFromRenderPosition(config, config.StartPosition)
	finalCell := cellNoFromRenderPosition(config, config.FinalPosition)
	pathCells := pathBetweenCells(config, grid, startCell, finalCell)
	onPath := make([]bool, totalCells+1)
	for _, cellNo := range pathCells {
		onPath[cellNo] = true
	}

	return navigationBurden{
		pathLength:     float64(len(pathCells)),
		backtrackCells: float64(totalCells - len(pathCells)),
		worstBranch:    float64(worstOffPathBranch(config, grid, onPath)),
	}
}

func cellNoFromRenderPosition(config maze.Dimensions, position [2]int) int {
	row := (position[0] - 1) / benchmarkRenderCellStep
	col := (position[1] - 1) / benchmarkRenderCellStep
	return row*config.NumCols + col + 1
}

func pathBetweenCells(config maze.Dimensions, grid [][]string, startCell int, finalCell int) []int {
	parent := make([]int, config.NumCols*config.NumRows+1)
	queue := []int{startCell}
	parent[startCell] = -1

	for len(queue) > 0 {
		cellNo := queue[0]
		queue = queue[1:]
		if cellNo == finalCell {
			break
		}
		for _, neighbor := range openNeighborCells(config, grid, cellNo) {
			if parent[neighbor] != 0 {
				continue
			}
			parent[neighbor] = cellNo
			queue = append(queue, neighbor)
		}
	}

	path := []int{}
	for cellNo := finalCell; cellNo > 0; cellNo = parent[cellNo] {
		path = append(path, cellNo)
		if cellNo == startCell {
			break
		}
	}
	return path
}

func worstOffPathBranch(config maze.Dimensions, grid [][]string, onPath []bool) int {
	maxDepth := 0
	seen := make([]bool, len(onPath))

	for pathCell := 1; pathCell < len(onPath); pathCell++ {
		if !onPath[pathCell] {
			continue
		}
		for _, neighbor := range openNeighborCells(config, grid, pathCell) {
			if onPath[neighbor] || seen[neighbor] {
				continue
			}
			maxDepth = max(maxDepth, offPathBranchDepth(config, grid, neighbor, onPath, seen))
		}
	}

	return maxDepth
}

func offPathBranchDepth(config maze.Dimensions, grid [][]string, root int, onPath []bool, seen []bool) int {
	type branchNode struct {
		cellNo int
		depth  int
	}

	maxDepth := 0
	queue := []branchNode{{cellNo: root, depth: 1}}
	seen[root] = true

	for len(queue) > 0 {
		node := queue[0]
		queue = queue[1:]
		maxDepth = max(maxDepth, node.depth)

		for _, neighbor := range openNeighborCells(config, grid, node.cellNo) {
			if onPath[neighbor] || seen[neighbor] {
				continue
			}
			seen[neighbor] = true
			queue = append(queue, branchNode{cellNo: neighbor, depth: node.depth + 1})
		}
	}

	return maxDepth
}

func validMazeStructure(config maze.Dimensions, grid [][]string) bool {
	totalCells := config.NumCols * config.NumRows
	edges := 0
	visited := make([]bool, totalCells+1)
	queue := []int{1}
	visited[1] = true

	for cellNo := 1; cellNo <= totalCells; cellNo++ {
		row := (cellNo - 1) / config.NumCols
		col := (cellNo - 1) % config.NumCols
		mask := adjacencyMask(config, grid, cellNo)

		if row == 0 && mask&1 != 0 {
			return false
		}
		if col == config.NumCols-1 && mask&2 != 0 {
			return false
		}
		if row == config.NumRows-1 && mask&4 != 0 {
			return false
		}
		if col == 0 && mask&8 != 0 {
			return false
		}
		if mask&2 != 0 {
			edges++
		}
		if mask&4 != 0 {
			edges++
		}
	}

	for len(queue) > 0 {
		cellNo := queue[0]
		queue = queue[1:]
		for _, neighbor := range openNeighborCells(config, grid, cellNo) {
			if visited[neighbor] {
				continue
			}
			visited[neighbor] = true
			queue = append(queue, neighbor)
		}
	}

	for cellNo := 1; cellNo <= totalCells; cellNo++ {
		if !visited[cellNo] {
			return false
		}
	}

	return edges == totalCells-1
}

func openNeighborCells(config maze.Dimensions, grid [][]string, cellNo int) []int {
	address := config.GetCellAddress(cellNo)
	neighbors := config.GetCellNeighbors(cellNo)
	open := make([]int, 0, 4)

	isOpen := func(point [2]int) bool {
		return strings.TrimSpace(grid[point[0]][point[1]]) == ""
	}

	if neighbors.Top != 0 && isOpen(address.TopCenter) {
		open = append(open, neighbors.Top)
	}
	if neighbors.Right != 0 && isOpen(address.MiddleRight) {
		open = append(open, neighbors.Right)
	}
	if neighbors.Bottom != 0 && isOpen(address.BottomCenter) {
		open = append(open, neighbors.Bottom)
	}
	if neighbors.Left != 0 && isOpen(address.MiddleLeft) {
		open = append(open, neighbors.Left)
	}

	return open
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

// adjacencyMask reports which of a cell's four directions have an open passage, as a 4-bit mask in a
// fixed Up(1)/Right(2)/Down(4)/Left(8) order — the same open-check countOpenExits uses. This is
// wall-glyph/weight-independent by construction: two mazes carved identically but rendered under
// different WallWeight values produce the identical mask for every cell.
func adjacencyMask(config maze.Dimensions, grid [][]string, cellNo int) int {
	address := config.GetCellAddress(cellNo)
	neighbors := config.GetCellNeighbors(cellNo)

	isOpen := func(point [2]int) bool {
		return strings.TrimSpace(grid[point[0]][point[1]]) == ""
	}

	mask := 0
	if neighbors.Top != 0 && isOpen(address.TopCenter) {
		mask |= 1
	}
	if neighbors.Right != 0 && isOpen(address.MiddleRight) {
		mask |= 2
	}
	if neighbors.Bottom != 0 && isOpen(address.BottomCenter) {
		mask |= 4
	}
	if neighbors.Left != 0 && isOpen(address.MiddleLeft) {
		mask |= 8
	}

	return mask
}

// mazeAdjacencyHash reduces a maze's decoded adjacency (not its glyph rendering) to one hash: every
// cell's adjacencyMask, row-major, as one hex digit each, hashed with FNV-1a 64-bit and formatted to
// match frontend/app/logs.ts's fnv1a64Checksum exactly (0x-prefixed, 16 lowercase hex digits) — Go's
// stdlib [hash/fnv.New64a] was verified to produce byte-identical output to that TypeScript
// implementation for the same input bytes, so the two ports can compare these hashes directly.
func mazeAdjacencyHash(config maze.Dimensions, grid [][]string) string {
	totalCells := config.NumCols * config.NumRows

	var structure strings.Builder
	structure.Grow(totalCells)
	for cellNo := 1; cellNo <= totalCells; cellNo++ {
		structure.WriteString(strconv.FormatInt(int64(adjacencyMask(config, grid, cellNo)), 16))
	}

	h := fnv.New64a()
	h.Write([]byte(structure.String()))
	return fmt.Sprintf("0x%016x", h.Sum64())
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
			measureBranching(b, benchCase.name, config, maze.GetNavigationProfile(config))
		})
	}
}
