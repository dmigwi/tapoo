package main

import (
	"fmt"
	"os"

	"github.com/dmigwi/tapoo/maze"
)

const (
	// versionMajor is the semantic major version for the Go terminal runtime.
	versionMajor = 1

	// versionMinor is the semantic minor version for the Go terminal runtime.
	versionMinor = 1

	// versionPatch is the semantic patch version for the Go terminal runtime.
	versionPatch = 1
)

// appVersion returns the semantic version for the Go terminal runtime.
func appVersion() string {
	return fmt.Sprintf("v%d.%d.%d", versionMajor, versionMinor, versionPatch) // output vX.X.X
}

// main defines where the program executions start.
func main() {
	if err := maze.Start(appVersion()); err != nil {
		// Write the startup/runtime error once and exit with a failing status for the shell.
		if _, writeErr := fmt.Fprintln(os.Stderr, err); writeErr != nil {
			os.Exit(1)
		}

		os.Exit(1)
	}
}
