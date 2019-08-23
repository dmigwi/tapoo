package db

import (
	"fmt"
	"strings"
	"time"

	"github.com/dmigwi/tapoo/db/utils"
	uuid "github.com/satori/go.uuid"
)

// UserInfor defines the default data that should identify every user
// that is playing the tapoo game and the level they currently playing.
type UserInfor struct {
	TapooID string
	Email   string
	Level   uint32
}

// LevelScoreResponse defines the expected response of a request made to scores.
type LevelScoreResponse struct {
	TapooID     string    `json:"user_id"`
	Email       string    `json:"email"`
	Level       uint32    `json:"game_level"`
	LevelScores uint32    `json:"level_scores"`
	CreatedAt   time.Time `json:"created_at"`
	UpdateAt    time.Time `json:"updated_at"`
}

const invalidData = "datastore: invalid %s found is '%v'"

// createLevelScore creates a new level with a default score value of zero.
// This method should always be executed everytime a user moves to a new level.
func (u *UserInfor) createLevelScore(uuid string) error {
	_, _, err := execPrepStmts(noReturnVal, utils.InsertScores, uuid,
		u.TapooID, u.Level)
	return err
}

// getLevelScore fetches the level scores for the provided tapoo user ID.
// This method should return data if the user want to try out the specific level again.
func (u *UserInfor) getLevelScore() (*LevelScoreResponse, error) {
	_, row, err := execPrepStmts(singleRow, utils.SelectScoresByLevelAndUserID,
		u.TapooID, u.Level)
	if err != nil {
		return nil, err
	}

	var s LevelScoreResponse
	err = row.Scan(&s.TapooID, &s.Level, &s.LevelScores, &s.CreatedAt, &s.UpdateAt)

	return &s, err
}

// GetOrCreateLevelScore fetches or creates data about the user for the specific level.
// This methods is called every time a new game starts for every level except
// the training level (level 0).
func (u *UserInfor) GetOrCreateLevelScore() (*LevelScoreResponse, error) {
	if u.Level < 0 {
		return nil, fmt.Errorf(invalidData, "game level", u.Level)
	}

	if err := u.validateUserID(); err != nil {
		return err
	}

	switch u.createLevelScore(uuid.NewV4().String()) {
	case nil:
	default:
		if !strings.Contains(err.Error(), "Duplicate entry") {
			// Returned a different error other than "Duplicate entry"
			return nil, err
		}
	}

	return u.getLevelScore()
}

// GetTopTenLevelScores fetches the top Top Ten high scores for the provided level.
func (u *UserInfor) GetTopTenLevelScores() ([]*LevelScoreResponse, error) {
	topScores := make([]*LevelScoreResponse, 0)
	if u.Level < 0 {
		return topScores, fmt.Errorf(invalidData, "game level", u.Level)
	}

	rows, _, err := execPrepStmts(multiRows, utils.SelectTopTenScores, u.Level)
	if err != nil {
		return topScores, err
	}

	for rows.Next() {
		s := new(LevelScoreResponse)

		err = rows.Scan(&s.TapooID, &s.Email, &s.Level, &s.LevelScores, &s.CreatedAt, &s.UpdateAt)
		if err != nil {
			return topScores, err
		}

		topScores = append(topScores, s)
	}

	return topScores, rows.Err()
}

// UpdateLevelScore updates the user scores for the provided level.
// This method should only be invoked when the specific level is completed successfully.
// If a level is not completed successfully no scores update made and thus the
// users status quo for the specific level remains.
func (u *UserInfor) UpdateLevelScore(levelScores int32) error {
	switch {
	case u.Level < 0:
		return fmt.Errorf(invalidData, "game level", u.Level)

	case levelScores < 0:
		return fmt.Errorf(invalidData, "level scores", levelScores)
	}

	if err := u.validateUserID(); err != nil {
		return err
	}

	_, _, err := execPrepStmts(noReturnVal, utils.UpdateScoresByLevelAndUserID,
		levelScores, u.TapooID, u.Level)
	return err
}
