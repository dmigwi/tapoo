package maze

import (
	"errors"
	"fmt"
	"slices"
)

// Dimensions defines the actual number of cells that make up the maze.
// NumCols is the number of cells along the horizontal edge (columns).
// NumRows is the number of cells along the vertical edge (rows).
type Dimensions struct {
	NumCols       int
	NumRows       int
	StartPosition [2]int
	FinalPosition [2]int
}

// pathStep stores the DFS stack entry for the current maze path.
// moveDirection is the direction used to enter this cell.
// corridorLength is the number of consecutive moves taken in that same direction.
type pathStep struct {
	cellNo         int
	moveDirection  direction
	corridorLength int
}

// GenerateMaze converts the created grid view playing field into a series on paths and walls.
// The Maze is created such that only a single path can exists between the starting point and
// and the goal.
func (config *Dimensions) GenerateMaze(weight WallWeight) ([][]string, error) {
	totalCells, errValidate := config.validateMazeGenerationInputs(weight)
	if errValidate != nil {
		config.resetPositions()
		return nil, errValidate
	}

	// Maze size controls how strongly generation should resist long straight corridors.
	navigationProfile := GetNavigationProfile(*config)

	// The visited set is scoped to a single generation so repeated runs do not leak traversal state.
	visitedCells := make([]bool, totalCells+1)
	startPos, errStart := config.getStartPosition()
	if errStart != nil {
		config.resetPositions()
		return nil, fmt.Errorf("select maze start position: %w", errStart)
	}

	// DFS starts from a random edge cell and grows a spanning tree from there.
	longestPathLength, finalCell := 1, startPos
	cellsPath := []pathStep{{cellNo: startPos}}
	currentPos, visitedCount := startPos, 1

	maze, err := config.CreatePlayingField(weight)
	if err != nil {
		return nil, err
	}

	startAddr := config.GetCellAddress(startPos)
	config.StartPosition = [2]int{startAddr.MiddleCenter[0], startAddr.MiddleCenter[1]}

	visitedCells[currentPos] = true

	for visitedCount < totalCells {
		var neighbors []int

		// Walk backward until we find the next branch that still has an unvisited exit.
		cellsPath, currentPos, neighbors, err = config.backtrackToBranch(cellsPath, visitedCells)
		if err != nil {
			config.resetPositions()
			return nil, err
		}

		// Corridor shaping happens here; the returned cell still preserves DFS behavior.
		nextChoice, nextChoiceErr := config.chooseNextCell(
			neighbors, cellsPath[len(cellsPath)-1], navigationProfile, visitedCells,
		)
		if nextChoiceErr != nil {
			config.resetPositions()
			return nil, fmt.Errorf("select next maze cell: %w", nextChoiceErr)
		}

		if visitedCells[nextChoice.cellNo] {
			continue
		}

		visitedCells[nextChoice.cellNo] = true
		visitedCount++

		config.createPath(maze, currentPos, nextChoice.cellNo)
		cellsPath = append(cellsPath, nextChoice)

		// The deepest point reached from the chosen start becomes the player's target cell.
		if len(cellsPath) > longestPathLength {
			finalCell, longestPathLength = nextChoice.cellNo, len(cellsPath)
		}
	}

	finalAddr := config.GetCellAddress(finalCell)
	config.FinalPosition = [2]int{finalAddr.MiddleCenter[0], finalAddr.MiddleCenter[1]}

	if positionErr := config.validateGeneratedPositions(); positionErr != nil {
		config.resetPositions()
		return nil, positionErr
	}

	config.optimizeMaze(weight, maze)
	return maze, nil
}

// chooseNextCell selects the next unvisited neighbor while applying the configured corridor
// length cap and least-neighbors bias. The returned choice preserves the DFS spanning-tree
// behavior.
func (config *Dimensions) chooseNextCell(
	neighbors []int, currentState pathStep, profile NavigationProfile, visitedCells []bool,
) (pathStep, error) {
	var (
		allCount    int
		lengthCount int

		// These fixed-size arrays avoid per-step heap growth while we score up to four neighbors.
		allChoices        [mazeEdgeNeighborCount]pathStep
		withinLengthLimit [mazeEdgeNeighborCount]pathStep
	)

	for _, neighbor := range neighbors {
		straightLength := 1
		nextDirection := config.directionBetween(currentState.cellNo, neighbor)

		if nextDirection == currentState.moveDirection {
			straightLength += currentState.corridorLength
		}

		choice := pathStep{
			cellNo:         neighbor,
			moveDirection:  nextDirection,
			corridorLength: straightLength,
		}
		allChoices[allCount] = choice
		allCount++

		// Caps how long a straight run can go before being forced to bend.
		if straightLength <= profile.MaxCorridorLength {
			withinLengthLimit[lengthCount] = choice
			lengthCount++
		}
	}

	// Start with every valid neighbor, then narrow down only if the profile says this corridor is too long.
	choices := allChoices[:allCount]
	if lengthCount > 0 {
		choices = withinLengthLimit[:lengthCount]
	}

	if len(choices) > 1 {
		biasRoll, err := secureRandomIndex(percentScale)
		if err != nil {
			return pathStep{}, err
		}

		if biasRoll < profile.LeastNeighborsBias {
			// Prefer the candidate with the fewest remaining unvisited neighbors of its own. A
			// low-neighbor-count cell gets "used up" cleanly by visiting it now, leaving nothing
			// behind for some later, unrelated branch to claim and retroactively turn this cell
			// into a junction. This is the mechanism that actually controls branching — unlike
			// corridor length, neighbor count directly predicts whether a cell will be orphaned.
			var (
				leastPopulatedCount int
				fewestRemaining     = mazeEdgeNeighborCount + 1
				leastPopulated      [mazeEdgeNeighborCount]pathStep
			)

			for _, choice := range choices {
				remaining := len(config.getPresentNeighbors(choice.cellNo, visitedCells))
				switch {
				case remaining < fewestRemaining:
					fewestRemaining = remaining
					leastPopulated[0] = choice
					leastPopulatedCount = 1
				case remaining == fewestRemaining:
					leastPopulated[leastPopulatedCount] = choice
					leastPopulatedCount++
				}
			}
			choices = leastPopulated[:leastPopulatedCount]
		}
	}

	// A final random pick keeps mazes of the same size from following the same local path every run.
	nextChoiceIndex, err := secureRandomIndex(len(choices))
	if err != nil {
		return pathStep{}, err
	}

	return choices[nextChoiceIndex], nil
}

// validateMazeGenerationInputs checks the generation inputs before any traversal state is allocated.
func (config *Dimensions) validateMazeGenerationInputs(weight WallWeight) (int, error) {
	if !weight.IsValid() {
		return 0, fmt.Errorf(
			"invalid wall weight: %s. allowed values are %s, %s, and %s",
			weight, WallWeightRegular, WallWeightMedium, WallWeightBold,
		)
	}

	if config.NumCols <= 0 || config.NumRows <= 0 {
		return 0, fmt.Errorf(
			"invalid maze dimensions: numCols=%d numRows=%d. both values must be greater than zero",
			config.NumCols, config.NumRows,
		)
	}

	totalCells := config.NumCols * config.NumRows
	if totalCells < minPlayableMazeCells {
		return 0, fmt.Errorf(
			"invalid maze dimensions: numCols=%d numRows=%d. at least two cells are required to create distinct endpoints",
			config.NumCols,
			config.NumRows,
		)
	}

	return totalCells, nil
}

// resetPositions clears the generated maze endpoints before returning a generation error.
func (config *Dimensions) resetPositions() {
	config.StartPosition = [2]int{}
	config.FinalPosition = [2]int{}
}

// validateGeneratedPositions ensures a generated maze exposes two distinct endpoints for gameplay.
func (config *Dimensions) validateGeneratedPositions() error {
	if slices.Equal(config.StartPosition[:], config.FinalPosition[:]) {
		return fmt.Errorf(
			"generate maze: start and final positions must differ (numCols=%d numRows=%d)",
			config.NumCols, config.NumRows,
		)
	}
	return nil
}

// createPath creates a path on the common wall between the current and the new cell.
// A path is created by replacing the wall characters with the respective number of blank spaces.
// Wall characters are defined by the wall weight used while creating the grid view.
func (config *Dimensions) createPath(maze [][]string, currentCellNo, newCellNo int) {
	addr := config.GetCellAddress(currentCellNo)
	neighbors := config.GetCellNeighbors(currentCellNo)

	switch newCellNo {
	case neighbors.Bottom:
		maze[addr.BottomCenter[0]][addr.BottomCenter[1]] = "   "

	case neighbors.Left:
		maze[addr.MiddleLeft[0]][addr.MiddleLeft[1]] = " "

	case neighbors.Right:
		maze[addr.MiddleRight[0]][addr.MiddleRight[1]] = " "

	case neighbors.Top:
		maze[addr.TopCenter[0]][addr.TopCenter[1]] = "   "
	}
}

// getPresentNeighbors returns a slice of the neigboring cells associated with the cell number provided.
// Only neighboring cells with no common paths to others cells that are returned. i.e. Non-Visited Cells.
func (config *Dimensions) getPresentNeighbors(cellNo int, visitedCells []bool) []int {
	neighbors := config.GetCellNeighbors(cellNo)
	presentCells := make([]int, 0, mazeEdgeNeighborCount)

	// Only unvisited neighbors are eligible so the maze remains a spanning tree with one unique route between cells.
	if neighbors.Bottom != 0 && !visitedCells[neighbors.Bottom] {
		presentCells = append(presentCells, neighbors.Bottom)
	}

	if neighbors.Left != 0 && !visitedCells[neighbors.Left] {
		presentCells = append(presentCells, neighbors.Left)
	}

	if neighbors.Right != 0 && !visitedCells[neighbors.Right] {
		presentCells = append(presentCells, neighbors.Right)
	}

	if neighbors.Top != 0 && !visitedCells[neighbors.Top] {
		presentCells = append(presentCells, neighbors.Top)
	}

	return presentCells
}

// backtrackToBranch rewinds the DFS stack until it finds a cell with at least one unvisited neighbor.
func (config *Dimensions) backtrackToBranch(cellsPath []pathStep, visitedCells []bool) ([]pathStep, int, []int, error) {
	for len(cellsPath) > 0 {
		currentPos := cellsPath[len(cellsPath)-1].cellNo
		neighbors := config.getPresentNeighbors(currentPos, visitedCells)
		if len(neighbors) > 0 {
			return cellsPath, currentPos, neighbors, nil
		}

		// Dead ends trigger backtracking through the current DFS path until a branch point is found.
		cellsPath = cellsPath[:len(cellsPath)-1]
	}

	return nil, 0, nil, errors.New("generate maze: no unvisited neighbors available during traversal")
}

// directionBetween identifies how traversal would move from the current cell into the chosen neighbor.
func (config *Dimensions) directionBetween(currentCell, nextCell int) direction {
	neighbors := config.GetCellNeighbors(currentCell)

	switch nextCell {
	case neighbors.Top:
		return directionUp
	case neighbors.Bottom:
		return directionDown
	case neighbors.Left:
		return directionLeft
	case neighbors.Right:
		return directionRight
	default:
		return directionNone
	}
}

// getStartPosition returns the cell which becomes the maze traversal starting position.
// The starting position can only be a cell along the  maze edges i.e. has less than four
// neighbors. When getStartPosition is called, all cells are have no common paths to other cells.
func (config *Dimensions) getStartPosition() (int, error) {
	totalCells := config.NumCols * config.NumRows
	for {
		randCellNo, err := secureRandomIndex(totalCells)
		if err != nil {
			return 0, err
		}

		randCellNo++

		// Edge cells have fewer than four neighbors, which guarantees the player starts on the maze boundary.
		if countNeighbors(config.GetCellNeighbors(randCellNo)) < mazeEdgeNeighborCount {
			return randCellNo, nil
		}
	}
}

// optimizeMaze replaces some wall characters so as the maze can
// be more clear and sharp when printed on the terminal.
func (config *Dimensions) optimizeMaze(weight WallWeight, maze [][]string) {
	chars, err := getWallCharacters(weight)
	if err != nil {
		panic(err)
	}

	// Corner cleanup swaps in horizontal glyphs where two open passages meet for a cleaner terminal render.
	for cell := 1; cell <= (config.NumCols * config.NumRows); cell++ {
		addr := config.GetCellAddress(cell)

		config.replaceChar(addr.BottomRight, chars[2], maze)
		config.replaceChar(addr.TopRight, chars[2], maze)
	}
}

// replaceChar switches left and right wall character with a top and bottom wall character.
func (config *Dimensions) replaceChar(point [2]int, replChar string, maze [][]string) {
	elemTop, elemBottom := "", ""
	lenTop, lenBottom := false, false

	// checks if the top point in relation to the given point can be calculated
	if (point[0] - 1) > 0 {
		elemTop = maze[point[0]-1][point[1]]
		lenTop = true
	}

	// checks if the bottom point in relation to the given point can be calculated
	if (point[0] + 1) <= (config.NumRows * cellSpan) {
		elemBottom = maze[point[0]+1][point[1]]
		lenBottom = true
	}

	x, y := point[0], point[1]
	switch {
	case !lenTop && lenBottom && isSpaceFound(elemBottom):
		maze[x][y] = replChar

	case lenTop && !lenBottom && isSpaceFound(elemTop):
		maze[x][y] = replChar

	case lenTop && lenBottom && isSpaceFound(elemBottom) && isSpaceFound(elemTop):
		maze[x][y] = replChar
	}
}

func countNeighbors(neighbors CellNeighbors) int {
	count := 0

	if neighbors.Bottom != 0 {
		count++
	}

	if neighbors.Left != 0 {
		count++
	}

	if neighbors.Right != 0 {
		count++
	}

	if neighbors.Top != 0 {
		count++
	}

	return count
}
