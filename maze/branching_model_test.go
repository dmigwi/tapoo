package maze_test

import (
	"math"
	"testing"

	"github.com/dmigwi/tapoo/maze"
)

// biasCurveSamples is the mazes generated per bias level. The per-level standard deviation is about
// 0.010, so this holds the standard error near 0.0007 - an order of magnitude under the ~0.009 step
// between adjacent levels, which is what lets the monotonicity check below be strict.
const biasCurveSamples = 200

// meanJunctionFraction reports the average share of cells with 3+ open exits at one bias level. The
// caller passes the grid by value and it is copied again here, so each sweep step carves into its
// own Dimensions rather than sharing the start and target positions GenerateMaze writes back.
func meanJunctionFraction(t *testing.T, grid maze.Dimensions, bias int) float64 {
	t.Helper()

	config := grid
	totalCells := config.NumCols * config.NumRows
	profile := maze.NavigationProfile{MaxCorridorLength: 7, LeastNeighborsBias: bias}

	var sum float64
	for range biasCurveSamples {
		grid, err := config.GenerateMazeWithProfile(maze.WallWeightRegular, profile)
		if err != nil {
			t.Fatalf("GenerateMazeWithProfile returned error: %v", err)
		}

		junctions := 0
		for cellNo := 1; cellNo <= totalCells; cellNo++ {
			if countOpenExits(config, grid, cellNo) >= 3 {
				junctions++
			}
		}
		sum += float64(junctions) / float64(totalCells)
	}

	return sum / float64(biasCurveSamples)
}

// rSquared reports how much of the variance in actual the predicted values explain.
func rSquared(actual, predicted []float64) float64 {
	var mean float64
	for _, value := range actual {
		mean += value
	}
	mean /= float64(len(actual))

	var residual, total float64
	for i, value := range actual {
		residual += (value - predicted[i]) * (value - predicted[i])
		total += (value - mean) * (value - mean)
	}

	return 1 - residual/total
}

// fitExponential returns the best least-squares a*exp(k*x), fitted in log space. It exists to be
// rejected: without a rival model, "the curve fits a line" says little, since a high R^2 alone is
// easy to reach on any smooth monotonic series.
func fitExponential(x, y []float64) []float64 {
	var sumX, sumLogY, sumXX, sumXLogY float64
	for i := range x {
		logY := math.Log(y[i])
		sumX += x[i]
		sumLogY += logY
		sumXX += x[i] * x[i]
		sumXLogY += x[i] * logY
	}

	count := float64(len(x))
	slope := (count*sumXLogY - sumX*sumLogY) / (count*sumXX - sumX*sumX)
	intercept := math.Exp((sumLogY - slope*sumX) / count)

	predicted := make([]float64, len(x))
	for i := range x {
		predicted[i] = intercept * math.Exp(slope*x[i])
	}

	return predicted
}

// TestJunctionDensityFollowsBiasMixture pins the shape of the bias-to-density relationship, not just
// its direction. chooseNextCell rolls a Bernoulli(p) coin per decision point to pick between two
// policies, so by the law of total expectation the density has to be a convex combination of the two
// pure-policy outcomes - linear in p, with a small p(1-p) term because consecutive decisions are not
// independent. This asserts that form holds, and that a decaying exponential does not, which is the
// claim a bare monotonicity check would miss: several wrong models are also monotonic.
//
// Endpoints are measured rather than hardcoded, so the test states a relationship instead of
// memorising today's numbers. This is now the only place the bias curve is measured: the benchmark
// sweeps only states the game can reach, and a bias sweep at a fixed grid is not one of them.
func TestJunctionDensityFollowsBiasMixture(t *testing.T) {
	t.Parallel()

	// The grid stays fixed and square for the whole sweep. Fixed because GetNavigationProfile derives
	// the profile from area alone, so a derived sweep would move area and bias together and could not
	// attribute the curve to either. Square because skew is not neutral either: at full bias a skewed
	// grid branches measurably more than a square of the same area. This matches the grid and corridor
	// cap the benchmark's area400_20x20 case uses, so the two remain directly comparable.
	grid := maze.Dimensions{NumCols: 20, NumRows: 20}

	biasLevels := []float64{}
	densities := []float64{}
	for bias := 0; bias <= 100; bias += 10 {
		biasLevels = append(biasLevels, float64(bias)/100)
		densities = append(densities, meanJunctionFraction(t, grid, bias))
	}

	// Every step has to fall. The gap between levels is roughly 13x the standard error, so a
	// genuine reversal here means the knob stopped working rather than a sampling accident.
	for i := 1; i < len(densities); i++ {
		if densities[i] >= densities[i-1] {
			t.Fatalf(
				"expected junction density to fall as bias rises: bias=%.0f%% gave %v, bias=%.0f%% gave %v",
				biasLevels[i-1]*100, densities[i-1], biasLevels[i]*100, densities[i],
			)
		}
	}

	unbiased, fullyBiased := densities[0], densities[len(densities)-1]
	if unbiased < fullyBiased*4 {
		t.Fatalf(
			"expected full bias to cut junction density several-fold: bias=0 gave %v, bias=100 gave %v",
			unbiased, fullyBiased,
		)
	}

	// The mixture endpoints are measured, so only the interior points are being predicted.
	chord := make([]float64, len(biasLevels))
	for i, p := range biasLevels {
		chord[i] = (1-p)*unbiased + p*fullyBiased
	}

	// One free parameter for the interaction term, fitted against the chord's residuals.
	var numerator, denominator float64
	for i, p := range biasLevels {
		weight := p * (1 - p)
		numerator += (densities[i] - chord[i]) * weight
		denominator += weight * weight
	}
	interaction := numerator / denominator

	mixture := make([]float64, len(biasLevels))
	for i, p := range biasLevels {
		mixture[i] = chord[i] + interaction*p*(1-p)
	}

	// Thresholds sit well below what the model actually achieves (chord ~0.993, mixture ~0.9997,
	// exponential ~0.78), so sampling noise cannot trip them but a change of shape will.
	chordFit := rSquared(densities, chord)
	mixtureFit := rSquared(densities, mixture)
	exponentialFit := rSquared(densities, fitExponential(biasLevels, densities))

	if chordFit < 0.98 {
		t.Fatalf("expected a near-linear mixture of the two pure policies: chord R^2=%v", chordFit)
	}

	if mixtureFit < 0.995 {
		t.Fatalf(
			"expected one p(1-p) interaction term to account for the remaining bow: mixture R^2=%v (chord R^2=%v)",
			mixtureFit, chordFit,
		)
	}

	// The interaction is a correction, not the main effect; a sign flip or a large value would mean
	// the mixture reading is wrong even though R^2 stayed high.
	if interaction <= 0 || interaction > (unbiased-fullyBiased)/2 {
		t.Fatalf(
			"expected a small positive interaction term: got %v across a range of %v",
			interaction, unbiased-fullyBiased,
		)
	}

	if exponentialFit > chordFit-0.1 {
		t.Fatalf(
			"expected the mixture to beat a decaying exponential decisively: exponential R^2=%v chord R^2=%v",
			exponentialFit, chordFit,
		)
	}
}
