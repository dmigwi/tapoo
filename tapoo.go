package main

import (
	"github.com/dmigwi/tapoo/maze"
	_ "github.com/dmigwi/tapoo/maze/db"
)

// Main defines where the program executions starts
func main() {
	maze.Start()
}
