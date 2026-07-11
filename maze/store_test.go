package maze_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dmigwi/tapoo/maze"
)

func TestStore(t *testing.T) {
	t.Parallel()

	t.Run("saves and loads persisted game state from the configured store directory", func(t *testing.T) {
		t.Parallel()

		tempDir := t.TempDir()
		storePath := filepath.Join(tempDir, ".tapoo.store")

		gameStore, errStore := maze.NewStore(storePath)
		if errStore != nil {
			t.Fatalf("new store returned error: %v", errStore)
		}

		if err := gameStore.Save(maze.StoredGameState{
			Level:      7,
			WallWeight: maze.WallWeightBold,
			State:      maze.GameProgressWon,
		}); err != nil {
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

		if state.State != maze.GameProgressWon {
			t.Fatalf("unexpected stored progress state: got %s want %s", state.State, maze.GameProgressWon)
		}

		if _, err := os.Stat(storePath); err != nil {
			t.Fatalf("expected store file to exist at %s: %v", storePath, err)
		}
	})

	t.Run("returns an error when the store file does not exist", func(t *testing.T) {
		t.Parallel()

		tempDir := t.TempDir()
		storePath := filepath.Join(tempDir, ".tapoo.store")

		gameStore, err := maze.NewStore(storePath)
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

	t.Run("returns an error when stored data is invalid", func(t *testing.T) {
		t.Parallel()

		tempDir := t.TempDir()
		storePath := filepath.Join(tempDir, ".tapoo.store")
		if err := os.WriteFile(storePath, []byte("not-valid-store-data"), 0o600); err != nil {
			t.Fatalf("write invalid store file: %v", err)
		}

		gameStore, err := maze.NewStore(storePath)
		if err != nil {
			t.Fatalf("new store returned error: %v", err)
		}

		_, err = gameStore.Load()
		if err == nil {
			t.Fatal("expected load to fail for invalid stored data")
		}
	})

	t.Run("returns an error when stored values fail validation", func(t *testing.T) {
		t.Parallel()

		tempDir := t.TempDir()
		storePath := filepath.Join(tempDir, ".tapoo.store")

		gameStore, errStore := maze.NewStore(storePath)
		if errStore != nil {
			t.Fatalf("new store returned error: %v", errStore)
		}

		if err := gameStore.Save(maze.StoredGameState{
			Level:      0,
			WallWeight: maze.WallWeight(99),
			State:      maze.GameProgress(99),
		}); err != nil {
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

	t.Run("advances won progress to the next level without a hard ceiling", func(t *testing.T) {
		t.Parallel()

		state := maze.StoredGameState{
			Level:      30000,
			WallWeight: maze.WallWeightRegular,
			State:      maze.GameProgressWon,
		}

		if got := state.ResumeLevel(); got != 30001 {
			t.Fatalf("unexpected resumed level: got %d want %d", got, 30001)
		}
	})
}
