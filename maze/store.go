package maze

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
)

// GameProgress describes the last persisted gameplay outcome for the stored level.
type GameProgress int

const (
	// GameProgressInProgress means the player was still working through the stored level.
	GameProgressInProgress GameProgress = iota

	// GameProgressWon means the stored level was completed successfully.
	GameProgressWon

	// GameProgressFail means the stored level ended in a timeout or other failure state.
	GameProgressFail
)

// IsValid reports whether the persisted progress value is one of the supported states.
func (state GameProgress) IsValid() bool {
	switch state {
	case GameProgressInProgress, GameProgressWon, GameProgressFail:
		return true
	default:
		return false
	}
}

// String returns the stable label associated with the stored progress state.
func (state GameProgress) String() string {
	switch state {
	case GameProgressInProgress:
		return "inprogress"
	case GameProgressWon:
		return "won"
	case GameProgressFail:
		return "fail"
	default:
		return fmt.Sprintf("GameProgress(%d)", state)
	}
}

// StoredGameState stores the small amount of runtime state we want to restore on restart.
// Retention values are persisted as normalized fixed-point scores on the range [0, retentionScale],
// where 0 means no retained score and retentionScale means the full starting score was preserved.
// That normalization keeps win-history comparisons fair across levels even though larger mazes
// have more total cells and therefore longer time budgets than earlier levels.
type StoredGameState struct {
	// Level is the most recent level reached before the current process stopped.
	Level int `json:"level"`

	// WallWeight is the preferred maze wall style that should be restored on startup.
	WallWeight WallWeight `json:"wall_weight"`

	// State records whether the stored level was still in progress, won, or failed.
	State GameProgress `json:"state"`

	// LastAttemptRetention tracks the normalized retention from the most recent completed attempt.
	LastAttemptRetention *uint32 `json:"last_attempt_retention,omitempty"`

	// BestWinRetention tracks the strongest normalized retention from any successful clear so far.
	BestWinRetention *uint32 `json:"best_win_retention,omitempty"`
}

// Store handles best-effort persistence for the current level and wall weight.
type Store struct {
	path string
}

// NewStore resolves the local persistence file path for the current UI session.
func NewStore(path string) (*Store, error) {
	if path == "" {
		return nil, errors.New("store path must not be empty")
	}

	return &Store{path: path}, nil
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

	if !state.State.IsValid() {
		return nil, fmt.Errorf("invalid stored game state: %s", state.State)
	}

	if state.LastAttemptRetention != nil && *state.LastAttemptRetention > retentionScale {
		return nil, fmt.Errorf("invalid stored last attempt retention: %d", *state.LastAttemptRetention)
	}

	if state.BestWinRetention != nil && *state.BestWinRetention > retentionScale {
		return nil, fmt.Errorf("invalid stored best win retention: %d", *state.BestWinRetention)
	}

	// The retention pair is only meaningful together, and gameplay always moves both at once: a win
	// records the attempt and may raise the best, a loss records a zero attempt. A file carrying one
	// without the other therefore came from outside the game, and restoring it split would leave the
	// win summary describing a best clear with no previous attempt to compare against. Drop both so
	// "no previous record" always means "no records at all", which the summary reports as a first win.
	if (state.LastAttemptRetention == nil) != (state.BestWinRetention == nil) {
		state.LastAttemptRetention = nil
		state.BestWinRetention = nil
	}

	return &state, nil
}

// ResumeLevel resolves which level should be loaded on the next startup.
// Won states advance to the following level, while failed and in-progress states retry the same level.
func (state StoredGameState) ResumeLevel() int {
	if state.State == GameProgressWon {
		return state.Level + 1
	}

	return state.Level
}

// Save encodes and writes the current runtime state to disk.
func (stateStore *Store) Save(state StoredGameState) error {
	encodedState, err := encodePersistedGameState(state)
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

	encoded := storeEncodingPrefix + encodeStorePayload(plainText)
	return []byte(encoded), nil
}

// decodePersistedGameState reverses the local store encoding and returns the recovered state.
func decodePersistedGameState(encodedState []byte) (StoredGameState, error) {
	encodedPayload := string(encodedState)

	plainText, err := decodeStorePayload(encodedPayload)
	if err != nil {
		return StoredGameState{}, err
	}

	var state StoredGameState
	if unmarshalErr := json.Unmarshal(plainText, &state); unmarshalErr != nil {
		return StoredGameState{}, unmarshalErr
	}

	return state, nil
}

// encodeStorePayload obscures the persisted JSON with the shared password before base64 encoding it.
func encodeStorePayload(plainText []byte) string {
	return base64.StdEncoding.EncodeToString(xorStorePayload(plainText))
}

// decodeStorePayload supports both the current password-based format and the legacy base64 payload.
func decodeStorePayload(encodedPayload string) ([]byte, error) {
	if after, ok := strings.CutPrefix(encodedPayload, storeEncodingPrefix); ok {
		encodedPayload = after
		cipherText, err := base64.StdEncoding.DecodeString(encodedPayload)
		if err != nil {
			return nil, err
		}

		return xorStorePayload(cipherText), nil
	}

	return base64.StdEncoding.DecodeString(encodedPayload)
}

// xorStorePayload applies the shared passKey across the payload bytes to keep saved state less casual to edit.
func xorStorePayload(payload []byte) []byte {
	passKey := []byte(storeBlendKey)
	encoded := make([]byte, len(payload))

	for index, value := range payload {
		encoded[index] = value ^ passKey[index%len(passKey)]
	}

	return encoded
}
