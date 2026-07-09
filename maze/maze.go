package maze

import (
	"fmt"
	"slices"
)

// Dimensions defines the actual number of cells that make up the maze along the vertical and
// the horizontal edges. Length represents the number of the cells along the horizontal
// edge while Width represents the number of the cells along the vertical edge.
type Dimensions struct {
	Length        int
	Width         int
	StartPosition [2]int
	FinalPosition [2]int
}

// GenerateMaze converts the created grid view playing field into a series on paths and walls.
// The Maze is created such that only a single path can exists between the starting point and
// and the goal.
func (config *Dimensions) GenerateMaze(weight WallWeight) ([][]string, error) {
	if !weight.IsValid() {
		config.resetPositions()

		return [][]string{}, fmt.Errorf(
			"invalid wall weight: %s. allowed values are %s, %s, and %s",
			weight, WallWeightRegular, WallWeightMedium, WallWeightBold,
		)
	}

	if config.Length <= 0 || config.Width <= 0 {
		config.resetPositions()

		return [][]string{}, fmt.Errorf(
			"invalid maze dimensions: length=%d width=%d. both values must be greater than zero",
			config.Length, config.Width,
		)
	}

	totalCells := config.Length * config.Width
	// The visited set is scoped to a single generation so repeated runs do not leak traversal state.
	visitedCells := make([]bool, totalCells+1)
	startPos := config.getStartPosition()

	longestPathLength, finalCell := 1, startPos
	cellsPath, currentPos, visitedCount := []int{startPos}, startPos, 1

	maze, err := config.CreatePlayingField(weight)
	if err != nil {
		return [][]string{}, err
	}

	startAddr := config.GetCellAddress(startPos)
	config.StartPosition = [2]int{startAddr.MiddleCenter[0], startAddr.MiddleCenter[1]}

	visitedCells[currentPos] = true

	for visitedCount < totalCells {
		var neighbors []int

		for {
			neighbors = config.getPresentNeighbors(currentPos, visitedCells)

			if len(neighbors) > 0 {
				break
			}

			// Dead ends trigger backtracking through the current DFS path until a branch point is found.
			cellsPath = cellsPath[:len(cellsPath)-1]
			currentPos = cellsPath[len(cellsPath)-1]
		}

		nextCell := neighbors[getRandomNo(len(neighbors))]
		if visitedCells[nextCell] {
			continue
		}

		visitedCells[nextCell] = true
		visitedCount++

		config.createPath(maze, currentPos, nextCell)
		cellsPath = append(cellsPath, nextCell)

		// The longest discovered path from the start becomes the end goal for the player.
		if len(cellsPath) > longestPathLength {
			finalCell, longestPathLength = nextCell, len(cellsPath)
		}

		currentPos = nextCell
	}

	finalAddr := config.GetCellAddress(finalCell)
	config.FinalPosition = [2]int{finalAddr.MiddleCenter[0], finalAddr.MiddleCenter[1]}

	if errValidate := config.validateGeneratedPositions(); errValidate != nil {
		config.resetPositions()

		return [][]string{}, errValidate
	}

	config.optimizeMaze(weight, maze)

	return maze, nil
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
			"generate maze: start and final positions must differ (length=%d width=%d)",
			config.Length, config.Width,
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

// getStartPosition returns the cell which becomes the maze traversal starting position.
// The starting position can only be a cell along the  maze edges i.e. has less than four
// neighbors. When getStartPosition is called, all cells are have no common paths to other cells.
func (config *Dimensions) getStartPosition() int {
	totalCells := config.Length * config.Width
	for {
		randCellNo := getRandomNo(totalCells) + 1

		// Edge cells have fewer than four neighbors, which guarantees the player starts on the maze boundary.
		if countNeighbors(config.GetCellNeighbors(randCellNo)) < mazeEdgeNeighborCount {
			return randCellNo
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
	for cell := 1; cell <= (config.Length * config.Width); cell++ {
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
	if (point[0] + 1) <= (config.Width * cellSpan) {
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
