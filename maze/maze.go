package maze

// visitedCells represents the cells whose numbers are mapped to their respective addresses.
// It is used in creating and navigating through the maze.
var visitedCells = map[int]cellAddress{}

// Dimensions defines the actual number of cells that make up the maze along the vertical and
// the horizontal edges. Length represents the number of the cells along the horizontal
// edge while Width represents the number of the cells along the vertical edge.
type Dimensions struct {
	Length int
	Width  int
}

// generateMaze converts the created grid view playing field into a series on paths and walls.
// The Maze is created such that only a single path can exists between the starting point and
// and the goal.
func (config *Dimensions) generateMaze(intensity int) ([][]string, []int, []int, error) {
	var (
		neighbors []int
		randPos   int

		maze, err  = config.createPlayingField(intensity)
		startPos   = config.getStartPosition()
		finalPos   = []int{1, startPos}
		currentPos = startPos
		cellsPath  = []int{startPos}
	)

	visitedCells[currentPos] = config.getCellAddress(currentPos)

	cellsPath = append(cellsPath, currentPos)

	if err != nil {
		return [][]string{},
			config.getCellAddress(startPos).MiddleCenter,
			config.getCellAddress(finalPos[1]).MiddleCenter,
			err
	}

	for len(visitedCells) < (config.Length * config.Width) {
		for {
			neighbors = config.getPresentNeighbors(currentPos)

			if len(neighbors) > 0 {
				break
			}

			cellsPath = cellsPath[:len(cellsPath)-1]
			currentPos = cellsPath[len(cellsPath)-1]
		}

		randPos = neighbors[getRandomNo(len(neighbors))]

		if _, ok := visitedCells[randPos]; !ok {
			visitedCells[randPos] = config.getCellAddress(randPos)

			config.createPath(maze[:], currentPos, randPos)
			cellsPath = append(cellsPath, randPos)

			if len(cellsPath) > finalPos[0] {
				finalPos[:][1] = randPos
				finalPos[:][0] = len(cellsPath)
			}

			currentPos = randPos
		}
	}

	err = config.optimizeMaze(intensity, maze[:])

	return maze,
		config.getCellAddress(startPos).MiddleCenter,
		config.getCellAddress(finalPos[1]).MiddleCenter,
		err
}

// createPath creates a path on the common wall between the current and the new cell.
// A path is created by replacing the wall characters with the respective number of blank spaces.
// Wall characters are defined by the intensity value used while creating the grid view.
func (config *Dimensions) createPath(maze [][]string, currentCellNo, newCellNo int) {
	var (
		addr = config.getCellAddress(currentCellNo)

		neighbors = config.getCellNeighbors(currentCellNo)
	)

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
func (config *Dimensions) getPresentNeighbors(cellNo int) []int {
	var (
		ok           bool
		presentCells []int

		neighbors = config.getCellNeighbors(cellNo)
	)

	for _, neighbor := range []int{neighbors.Bottom, neighbors.Left, neighbors.Right, neighbors.Top} {
		if _, ok = visitedCells[neighbor]; !ok && neighbor != 0 {
			presentCells = append(presentCells, neighbor)
		}
	}

	return presentCells
}

// getStartPosition returns the cell which becomes the maze traversal starting position.
// The starting position can only be a cell along the  maze edges i.e. has less than four
// neighbors. When getStartPosition is called, all cells are have no common paths to other cells.
func (config *Dimensions) getStartPosition() int {
	var (
		neighbors  []int
		randCellNo int
	)

	for {
		randCellNo = getRandomNo((config.Length * config.Width) + 1)

		neighbors = config.getPresentNeighbors(randCellNo)

		if len(neighbors) < 4 && randCellNo != 0 {
			return randCellNo
		}
	}
}

// optimizeMaze replaces some wall characters so as the maze can
// be more clear and sharp when printed on the terminal.
func (config *Dimensions) optimizeMaze(intensity int, maze [][]string) error {
	var (
		addr  cellAddress
		chars []string
		err   error
	)

	if chars, err = getWallCharacters(intensity); err != nil {
		return err
	}

	for cell := 1; cell <= (config.Length * config.Width); cell++ {
		addr = config.getCellAddress(cell)

		config.replaceChar(addr.BottomRight, chars[2], maze)
		config.replaceChar(addr.TopRight, chars[2], maze)
	}

	return nil
}

// replaceChar switches left and right wall character with a top and bottom wall character.
func (config *Dimensions) replaceChar(point []int, replChar string, maze [][]string) {
	var (
		elemTop, elemBottom = "", ""

		lenTop, lenBottom = false, false
	)
	// checks if the top point in relation to the given point can be calculated
	if point[0]-1 > 0 {
		topPoint := []int{point[0] - 1, point[1]}
		elemTop = maze[topPoint[0]][topPoint[1]]
		lenTop = true
	}

	// checks if the bottom point in relation to the given point can be calculated
	if point[0]+1 <= (config.Width * 2) {
		bottomPoint := []int{point[0] + 1, point[1]}
		elemBottom = maze[bottomPoint[0]][bottomPoint[1]]
		lenBottom = true
	}

	switch {
	case !lenTop && lenBottom && isSpaceFound(elemBottom):
		maze[point[0]][point[1]] = replChar

	case lenTop && !lenBottom && isSpaceFound(elemTop):
		maze[point[0]][point[1]] = replChar

	case lenTop && lenBottom && isSpaceFound(elemBottom) && isSpaceFound(elemTop):
		maze[point[0]][point[1]] = replChar
	}
}
