package db

import (
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	uuid "github.com/satori/go.uuid"
)

// UserInfor defines the default data that should identify every user
// that is playing the tapoo game.
type UserInfor struct {
	Level   int
	TapooID string
	Email   string
}

// LevelScoreResponse defines the expected response of a level score request.
type LevelScoreResponse struct {
	CreatedAt  time.Time `db:"created_at"`
	Email      string    `db:"email"`
	HighScores int       `db:"high_scores"`
	Level      int       `db:"game_level"`
	TapooID    string    `db:"user_id"`
	UpdateAt   time.Time `db:"updated_at"`
}

const invalidData = "datastore: invalid %s found : '%v'"

var errGenUUID = errors.New("datastore: generating a new UUID failed")

// createLevelScore creates a new level with a default score of zero.
// This function should always be executed everytime a user moves to a new level.
func (u *UserInfor) createLevelScore(uuid string) error {
	query := `INSERT INTO scores (uuid, game_level, user_id) VALUES (?, ?, ?);`

	return execPrepStmts(nil, noReturnVal, query, uuid, strconv.Itoa(u.Level), u.TapooID)
}

// getLevelScore fetches and returns the level scores for the provided tapoo user ID.
// This method should return data if the user want to try out the specific level again.
func (u *UserInfor) getLevelScore() (*LevelScoreResponse, error) {
	query := `SELECT created_at, high_scores, game_level, user_id, updated_at` +
		` FROM scores WHERE user_id = ? and game_level = ?;`

	var scores LevelScoreResponse

	err := execPrepStmts(&scores, singleRow, query, u.TapooID, strconv.Itoa(u.Level))
	if err != nil {
		return nil, err
	}

	return &scores, nil
}

// GetOrCreateLevelScore fetches or creates data about the user for the specific level.
// This methods is called every time a new game starts for every level except the training level.
func (u *UserInfor) GetOrCreateLevelScore() (*LevelScoreResponse, error) {
	switch {
	case u.Level < 0:
		return nil, fmt.Errorf(invalidData, "game level", u.Level)

	case len(u.TapooID) == 0:
		return nil, fmt.Errorf(invalidData, "Tapoo ID", u.TapooID+"(empty)")

	case len(u.TapooID) > 64:
		return nil, fmt.Errorf(invalidData, "Tapoo ID", u.TapooID[:10]+".... (Too long)")
	}

	u2, err := uuid.NewV4()
	if err != nil {
		return nil, errGenUUID
	}

	err = u.createLevelScore(u2.String())

	switch {
	case strings.Contains(err.Error(), "duplicate"):
	default:
		return nil, err
	}

	return u.getLevelScore()
}

// GetTopFiveScores fetches the top five high scores for the provided level.
func (u *UserInfor) GetTopFiveScores() ([]*LevelScoreResponse, error) {
	topScores := make([]*LevelScoreResponse, 0)

	if u.Level < 0 {
		return topScores, fmt.Errorf(invalidData, "game level", u.Level)
	}

	query := `SELECT s.created_at, s.high_scores, s.game_level, s.user_id,` +
		` s.updated_at, u.email FROM scores s users u WHERE s.game_level = ? ` +
		`and s.user_id = u.id ORDER BY s.high_scores DESC LIMIT 5;`

	var r interface{}

	err := execPrepStmts(&r, multiRows, query, strconv.Itoa(u.Level))
	if err != nil {
		return topScores, err
	}

	newRows := r.(sql.Rows)
	rows := &newRows

	// max of 5 result sets expected
	for rows.NextResultSet() {
		scores := new(LevelScoreResponse)

		err = rows.Scan(scores)
		if err != nil {
			return topScores, err
		}

		topScores = append(topScores, scores)
	}

	return topScores, rows.Err()
}

// UpdateLevelScore updates the user high scores for the provided level.
// This method should only be invoked when the specific level is completed successfully.
// If a level is not completed successfully no scores update that is made and thus the
// users status quo for the specific level remains.
func (u *UserInfor) UpdateLevelScore(highScores int) error {
	switch {
	case u.Level < 0:
		return fmt.Errorf(invalidData, "game level", u.Level)

	case highScores < 0:
		return fmt.Errorf(invalidData, "high scores", highScores)

	case len(u.TapooID) == 0:
		return fmt.Errorf(invalidData, "Tapoo ID", u.TapooID+"(empty)")

	case len(u.TapooID) > 64:
		return fmt.Errorf(invalidData, "Tapoo ID", u.TapooID[:10]+".... (Too long)")
	}

	query := `UPDATE scores SET high_scores = ? WHERE user_id = ? and game_level = ?;`

	return execPrepStmts(nil, noReturnVal, query, strconv.Itoa(highScores), u.TapooID, strconv.Itoa(u.Level))
}
