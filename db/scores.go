package db

import (
	"fmt"
	"strings"
	"time"

	"github.com/dmigwi/tapoo/db/utils"
	uuid "github.com/satori/go.uuid"
)

// LevelScoreResponse defines the expected response of a request made to scores.
type LevelScoreResponse struct {
	User        UserInfo
	LevelScores uint32    `json:"level_scores"`
	CreatedAt   time.Time `json:"created_at"`
	UpdateAt    time.Time `json:"updated_at"`
}

// createLevelScore creates a new level with a default score value of zero.
// This method should always be executed everytime a user moves to a new level.
func (u *UserInfo) createLevelScore(uuid string) error {
	_, _, err := execPrepStmts(noReturnVal, utils.InsertScores, uuid,
		u.TapooID, u.Level)
	return err
}

// getLevelScore fetches the level scores for the provided tapoo user ID.
// This method should return data if the user want to try out the specific level again.
func (u *UserInfo) getLevelScore() (*LevelScoreResponse, error) {
	_, row, err := execPrepStmts(singleRow, utils.SelectScoresByUserIDAndLevel,
		u.TapooID, u.Level)
	if err != nil {
		return nil, err
	}

	var s LevelScoreResponse
	err = row.Scan(&s.User.TapooID, &s.User.Level, &s.LevelScores, &s.CreatedAt, &s.UpdateAt)

	return &s, err
}

// GetOrCreateLevelScore fetches or creates data about the user for the specific level.
// This methods is called every time a new game starts for every level except
// the training level (level 0).
func (u *UserInfo) GetOrCreateLevelScore() (*LevelScoreResponse, error) {
	if err := u.validateUserID(); err != nil {
		return nil, err
	}

	err := u.createLevelScore(uuid.NewV4().String())
	switch err {
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
func (u *UserInfo) GetTopTenLevelScores() ([]*LevelScoreResponse, error) {
	topScores := make([]*LevelScoreResponse, 0)
	rows, _, err := execPrepStmts(multiRows, utils.SelectTopTenScores, u.Level)
	if err != nil {
		return topScores, err
	}

	for rows.Next() {
		s := new(LevelScoreResponse)

		err = rows.Scan(&s.User.TapooID, &s.User.Email, &s.User.Level, &s.LevelScores, &s.CreatedAt, &s.UpdateAt)
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
func (u *UserInfo) UpdateLevelScore(levelScores uint32) error {
	if levelScores == 0 {
		return fmt.Errorf(invalidData, "level score", "zero (0)")
	}

	if err := u.validateUserID(); err != nil {
		return err
	}

	_, _, err := execPrepStmts(noReturnVal, utils.UpdateScoresByUserIDAndLevel,
		levelScores, u.TapooID, u.Level)
	return err
}
