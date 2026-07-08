package maze_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dmigwi/tapoo/maze"
)

//nolint:paralleltest // These black-box tests use t.Chdir to exercise the store in the active working directory.
func TestStore(t *testing.T) {
	//nolint:paralleltest // This subtest mutates the process working directory via t.Chdir.
	t.Run("saves and loads persisted game state from the working directory", func(t *testing.T) {
		tempDir := t.TempDir()
		restoreWorkingDir(t, tempDir)

		gameStore, errStore := maze.NewStore()
		if errStore != nil {
			t.Fatalf("new store returned error: %v", errStore)
		}

		if err := gameStore.Save(7, maze.WallWeightBold); err != nil {
			t.Fatalf("save returned error: %v", err)
		}

		state, errLoad := gameStore.Load()
		if errLoad != nil {
			t.Fatalf("load returned error: %v", errLoad)
		}

		if state.Level != 7 {
			t.Fatalf("unexpected stored level: got %d want %d", state.Level, 7)
		}

		if state.WallWeight != maze.WallWeightBold {
			t.Fatalf("unexpected stored wall weight: got %s want %s", state.WallWeight, maze.WallWeightBold)
		}

		storeFile := filepath.Join(tempDir, ".tapoo.store")
		if _, err := os.Stat(storeFile); err != nil {
			t.Fatalf("expected store file to exist at %s: %v", storeFile, err)
		}
	})

	//nolint:paralleltest // This subtest mutates the process working directory via t.Chdir.
	t.Run("returns an error when the store file does not exist", func(t *testing.T) {
		tempDir := t.TempDir()
		restoreWorkingDir(t, tempDir)

		gameStore, err := maze.NewStore()
		if err != nil {
			t.Fatalf("new store returned error: %v", err)
		}

		_, err = gameStore.Load()
		if err == nil {
			t.Fatal("expected load to fail when the store file is missing")
		}

		if !os.IsNotExist(err) {
			t.Fatalf("expected a not-exist error, got %v", err)
		}
	})

	//nolint:paralleltest // This subtest mutates the process working directory via t.Chdir.
	t.Run("returns an error when stored data is invalid", func(t *testing.T) {
		tempDir := t.TempDir()
		restoreWorkingDir(t, tempDir)

		storeFile := filepath.Join(tempDir, ".tapoo.store")
		if err := os.WriteFile(storeFile, []byte("not-valid-store-data"), 0o600); err != nil {
			t.Fatalf("write invalid store file: %v", err)
		}

		gameStore, err := maze.NewStore()
		if err != nil {
			t.Fatalf("new store returned error: %v", err)
		}

		_, err = gameStore.Load()
		if err == nil {
			t.Fatal("expected load to fail for invalid stored data")
		}
	})

	//nolint:paralleltest // This subtest mutates the process working directory via t.Chdir.
	t.Run("returns an error when stored values fail validation", func(t *testing.T) {
		tempDir := t.TempDir()
		restoreWorkingDir(t, tempDir)

		gameStore, errStore := maze.NewStore()
		if errStore != nil {
			t.Fatalf("new store returned error: %v", errStore)
		}

		if err := gameStore.Save(0, maze.WallWeight(99)); err != nil {
			t.Fatalf("save returned error: %v", err)
		}

		_, err := gameStore.Load()
		if err == nil {
			t.Fatal("expected load to fail for invalid stored values")
		}

		if !strings.Contains(err.Error(), "invalid stored") {
			t.Fatalf("unexpected validation error: %v", err)
		}
	})
}

func restoreWorkingDir(t *testing.T, dir string) {
	t.Helper()

	workingDir, errDir := os.Getwd()
	if errDir != nil {
		t.Fatalf("get working directory: %v", errDir)
	}

	t.Chdir(dir)
	t.Cleanup(func() { t.Chdir(workingDir) })
}
