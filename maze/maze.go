package maze

// Dimensions defines the actual number of cells that make up the maze along the vertical and
// the horizontal edges. Length represents the number of the cells along the horizontal
// edge while Width represents the number of the cells along the vertical edge.
type Dimensions struct {
	Length        int
	Width         int
	StartPosition []int
	FinalPosition []int
}

// GenerateMaze converts the created grid view playing field into a series on paths and walls.
// The Maze is created such that only a single path can exists between the starting point and
// and the goal.
func (config *Dimensions) GenerateMaze(intensity int) ([][]string, error) {
	totalCells := config.Length * config.Width
	// The visited set is scoped to a single generation so repeated runs do not leak traversal state.
	visitedCells := make(map[int]CellAddress, totalCells)

	startPos := config.getStartPosition(visitedCells)

	// finalPos stores [pathLength, cellNumber] so the farthest discovered cell can become the goal.
	finalPos, cellsPath, currentPos := []int{1, startPos}, []int{startPos}, startPos

	maze, err := config.CreatePlayingField(intensity)
	if err != nil {
		return [][]string{}, err
	}

	startAddr := config.GetCellAddress(startPos)
	config.StartPosition = []int{startAddr.MiddleCenter[0], startAddr.MiddleCenter[1]}

	visitedCells[currentPos] = config.GetCellAddress(currentPos)

	for len(visitedCells) < totalCells {
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

		startPos = neighbors[getRandomNo(len(neighbors))]

		if _, ok := visitedCells[startPos]; !ok {
			visitedCells[startPos] = config.GetCellAddress(startPos)

			config.createPath(maze, currentPos, startPos)
			cellsPath = append(cellsPath, startPos)

			// The longest discovered path from the start becomes the end goal for the player.
			if len(cellsPath) > finalPos[0] {
				finalPos[1], finalPos[0] = startPos, len(cellsPath)
			}

			currentPos = startPos
		}
	}

	finalAddr := config.GetCellAddress(finalPos[1])
	config.FinalPosition = []int{finalAddr.MiddleCenter[0], finalAddr.MiddleCenter[1]}

	config.optimizeMaze(intensity, maze)

	return maze, nil
}

// createPath creates a path on the common wall between the current and the new cell.
// A path is created by replacing the wall characters with the respective number of blank spaces.
// Wall characters are defined by the intensity value used while creating the grid view.
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
func (config *Dimensions) getPresentNeighbors(cellNo int, visitedCells map[int]CellAddress) []int {
	neighbors := config.GetCellNeighbors(cellNo)
	presentCells := make([]int, 0, mazeEdgeNeighborCount)

	// Only unvisited neighbors are eligible so the maze remains a spanning tree with one unique route between cells.
	for _, neighbor := range []int{neighbors.Bottom, neighbors.Left, neighbors.Right, neighbors.Top} {
		if _, ok := visitedCells[neighbor]; !ok && neighbor != 0 {
			presentCells = append(presentCells, neighbor)
		}
	}

	return presentCells
}

// getStartPosition returns the cell which becomes the maze traversal starting position.
// The starting position can only be a cell along the  maze edges i.e. has less than four
// neighbors. When getStartPosition is called, all cells are have no common paths to other cells.
func (config *Dimensions) getStartPosition(visitedCells map[int]CellAddress) int {
	totalCells := config.Length * config.Width
	for {
		randCellNo := getRandomNo(totalCells) + 1

		neighbors := config.getPresentNeighbors(randCellNo, visitedCells)

		// Edge cells have fewer than four neighbors, which guarantees the player starts on the maze boundary.
		if len(neighbors) < mazeEdgeNeighborCount {
			return randCellNo
		}
	}
}

// optimizeMaze replaces some wall characters so as the maze can
// be more clear and sharp when printed on the terminal.
func (config *Dimensions) optimizeMaze(intensity int, maze [][]string) {
	chars, err := getWallCharacters(intensity)
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
