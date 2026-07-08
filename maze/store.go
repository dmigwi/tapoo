package maze

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// StoredGameState stores the small amount of runtime state we want to restore on restart.
type StoredGameState struct {
	Level      int        `json:"level"`
	WallWeight WallWeight `json:"wall_weight"`
}

// Store handles best-effort persistence for the current level and wall weight.
type Store struct {
	path string
}

// NewStore resolves the local persistence file in the current working directory.
func NewStore() (*Store, error) {
	workingDir, err := os.Getwd()
	if err != nil {
		return nil, err
	}

	return &Store{path: filepath.Join(workingDir, storeFileName)}, nil
}

// Load returns the persisted game state after decoding and validating it.
func (stateStore *Store) Load() (*StoredGameState, error) {
	encodedState, err := os.ReadFile(stateStore.path)
	if err != nil {
		return nil, err
	}

	state, err := decodePersistedGameState(encodedState)
	if err != nil {
		return nil, err
	}

	if state.Level < 1 {
		return nil, fmt.Errorf("invalid stored level: %d", state.Level)
	}

	if !state.WallWeight.IsValid() {
		return nil, fmt.Errorf("invalid stored wall weight: %s", state.WallWeight)
	}

	return &state, nil
}

// Save encodes and writes the current runtime state to disk.
func (stateStore *Store) Save(level int, weight WallWeight) error {
	encodedState, err := encodePersistedGameState(StoredGameState{
		Level:      level,
		WallWeight: weight,
	})
	if err != nil {
		return err
	}

	return os.WriteFile(stateStore.path, encodedState, 0o600)
}

// encodePersistedGameState serializes the state into a compact, human-safe local store payload.
func encodePersistedGameState(state StoredGameState) ([]byte, error) {
	plainText, err := json.Marshal(state)
	if err != nil {
		return nil, err
	}

	encoded := base64.StdEncoding.EncodeToString(plainText)
	return []byte(encoded), nil
}

// decodePersistedGameState reverses the local store encoding and returns the recovered state.
func decodePersistedGameState(encodedState []byte) (StoredGameState, error) {
	plainText, err := base64.StdEncoding.DecodeString(string(encodedState))
	if err != nil {
		return StoredGameState{}, err
	}

	var state StoredGameState
	if unmarshalErr := json.Unmarshal(plainText, &state); unmarshalErr != nil {
		return StoredGameState{}, unmarshalErr
	}

	return state, nil
}
