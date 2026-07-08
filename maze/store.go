package maze

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
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

// encodePersistedGameState serializes the state and wraps it in authenticated encryption.
// Bcrypt is intentionally not used here because it is one-way and cannot support decoding.
func encodePersistedGameState(state StoredGameState) ([]byte, error) {
	plainText, errJSON := json.Marshal(state)
	if errJSON != nil {
		return nil, errJSON
	}

	block, errBlock := aes.NewCipher(storeCipherKey())
	if errBlock != nil {
		return nil, errBlock
	}

	gcm, errCypher := cipher.NewGCM(block)
	if errCypher != nil {
		return nil, errCypher
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}

	cipherText := gcm.Seal(nonce, nonce, plainText, nil)
	encoded := base64.StdEncoding.EncodeToString(cipherText)

	return []byte(encoded), nil
}

// decodePersistedGameState reverses the local store encoding and returns the recovered state.
func decodePersistedGameState(encodedState []byte) (StoredGameState, error) {
	cipherText, errDecode := base64.StdEncoding.DecodeString(string(encodedState))
	if errDecode != nil {
		return StoredGameState{}, errDecode
	}

	block, errBlock := aes.NewCipher(storeCipherKey())
	if errBlock != nil {
		return StoredGameState{}, errBlock
	}

	gcm, errCypher := cipher.NewGCM(block)
	if errCypher != nil {
		return StoredGameState{}, errCypher
	}

	nonceSize := gcm.NonceSize()
	if len(cipherText) < nonceSize {
		return StoredGameState{}, errors.New("stored data is too short")
	}

	nonce, encryptedPayload := cipherText[:nonceSize], cipherText[nonceSize:]
	plainText, errOpen := gcm.Open(nil, nonce, encryptedPayload, nil)
	if errOpen != nil {
		return StoredGameState{}, errOpen
	}

	var state StoredGameState
	if err := json.Unmarshal(plainText, &state); err != nil {
		return StoredGameState{}, err
	}

	return state, nil
}

// storeCipherKey derives a stable symmetric key from static application constants.
func storeCipherKey() []byte {
	sum := sha256.Sum256(fmt.Appendf(nil, "tapoo|%s|%s|%d|%d|%d", intro, website, seed, diff, maxLevel))
	return sum[:]
}
