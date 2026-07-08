package main

import (
	"fmt"
	"os"

	"github.com/dmigwi/tapoo/maze"
)

// main defines where the program executions start.
func main() {
	if err := maze.Start(); err != nil {
		// Write the startup/runtime error once and exit with a failing status for the shell.
		if _, writeErr := fmt.Fprintln(os.Stderr, err); writeErr != nil {
			os.Exit(1)
		}

		os.Exit(1)
	}
}
