package db

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/dmigwi/tapoo/db/utils"
)

const (
	// noReturnVal indicates the sql query being executed should not
	// return any value. Return value not expected.
	noReturnVal int = iota

	// singleRow indicates the sql query bieng executed should only
	// return a single row of the expected result set.
	singleRow

	// multiRows indicates the sql query being executed should return
	// multiple rows of the expected result set.
	multiRows

	//MaxEmailLength defines the maximum number of characters that can make up
	// an email.
	MaxEmailLength = 64

	// MaxTapooIDLength defines the maximum number of characters that can make
	// up a username/tapoo ID.
	MaxTapooIDLength = 20

	invalidData = "db: invalid %s found '%v'"
)

// UserInfo defines the default data that should identify every user
// that is playing the tapoo game and the level they currently playing.
type UserInfo struct {
	TapooID string `json:"user_id"`
	Email   string `json:"email,omitempty"`
	Level   uint16 `json:"game_level,omitempty"`
}

// UserInfoResponse defines the expected response from users.
type UserInfoResponse struct {
	User      UserInfo
	CreatedAt time.Time `json:"created_at"`
	UpdateAt  time.Time `json:"updated_at"`
}

// createUser creates a new user using the tapoo ID provided.
func (u *UserInfo) createUser() error {
	_, _, err := execPrepStmts(noReturnVal, utils.InsertUsers, u.TapooID, u.Email)
	return err
}

// getUser checks if the tapoo ID provided exists in users table.
func (u *UserInfo) getUser() (*UserInfoResponse, error) {
	_, row, err := execPrepStmts(singleRow, utils.SelectUserByID, u.TapooID)
	if err != nil {
		return nil, err
	}

	var d UserInfoResponse
	err = row.Scan(&d.User.TapooID, &d.User.Email, &d.CreatedAt, &d.UpdateAt)

	return &d, err
}

// GetOrCreateUser creates the new user with tapoo ID provided.
// Email used can be empty but not greater than length defined by MaxEmailLength.
func (u *UserInfo) GetOrCreateUser() (*UserInfoResponse, error) {
	if err := u.validateUserID(); err != nil {
		return nil, err
	}

	if err := u.validateMaxEmailLength(); err != nil {
		return nil, err
	}

	err := u.createUser()
	switch err {
	case nil:
	default:
		if !strings.Contains(err.Error(), "Duplicate entry") {
			// Returned a different error other than "Duplicate entry"
			return nil, err
		}
	}

	return u.getUser()
}

// UpdateUser should update the tapoo user information, the email should not be
// empty otherwise an error will be returned.
func (u *UserInfo) UpdateUser() error {
	if err := u.validateUserID(); err != nil {
		return err
	}

	if len(u.Email) == 0 {
		return fmt.Errorf(invalidData, "Email", "is missing")
	}

	if err := u.validateMaxEmailLength(); err != nil {
		return err
	}

	_, _, err := execPrepStmts(noReturnVal, utils.UpdateUserEmailByID, u.Email, u.TapooID)
	return err
}

// execPrepStmts executes the Prepared statement for the sql queries.
func execPrepStmts(queryType int, sqlQuery string, val ...interface{}) (*sql.Rows, *sql.Row, error) {
	dbConfig, err := utils.GetDBConfig()
	if err != nil {
		return nil, nil, err
	}

	// Check if db connection was actually set
	if dbConfig.DbConn == nil {
		return nil, nil, fmt.Errorf("missing a valid db connection")
	}

	stmt, err := dbConfig.DbConn.Prepare(sqlQuery)
	if err != nil {
		return nil, nil, err
	}

	defer stmt.Close()

	switch queryType {
	case noReturnVal:
		_, err = dbConfig.DbConn.Exec(sqlQuery, val...)
		return nil, nil, err

	case singleRow:
		row := dbConfig.DbConn.QueryRow(sqlQuery, val...)
		return nil, row, nil

	case multiRows:
		rows, err := dbConfig.DbConn.Query(sqlQuery, val...)
		return rows, nil, err

	default:
		return nil, nil,
			fmt.Errorf(invalidData, "query type", queryType)
	}
}

// validateUserID assertains the user ID values is not empty of past the required
// characters.
func (u *UserInfo) validateUserID() error {
	switch {
	case len(u.TapooID) == 0:
		return fmt.Errorf(invalidData, "Tapoo ID", "is missing")

	case len(u.TapooID) > MaxTapooIDLength:
		userIDLengthErr := fmt.Sprintf("exceeds %d characters", MaxTapooIDLength)
		return fmt.Errorf(invalidData, "Tapoo ID ("+u.TapooID[:10]+"...)", userIDLengthErr)
	default:
		return nil
	}
}

// validateMaxEmailLength assertains that the email character length doesn't exceed
// length defined by MaxEmailLength.
func (u *UserInfo) validateMaxEmailLength() error {
	if len(u.Email) > MaxEmailLength {
		emailLengthErr := fmt.Sprintf("exceeds %d characters", MaxEmailLength)
		return fmt.Errorf(invalidData, "Email ("+u.Email[:10]+"...)", emailLengthErr)
	}
	return nil
}
