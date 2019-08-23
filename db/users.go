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
)

// UserInfoResponse defines the expected response from users.
type UserInfoResponse struct {
	TapooID   string    `json:"id"`
	Email     string    `json:"email"`
	CreatedAt time.Time `json:"created_at"`
	UpdateAt  time.Time `json:"updated_at"`
}

// createUser creates a new user using the tapoo ID provided.
func (u *UserInfor) createUser() error {
	_, _, err := execPrepStmts(noReturnVal, utils.InsertUsers, u.TapooID, u.Email)
	return err
}

// getUser checks if the tapoo ID provided exists in users table.
func (u *UserInfor) getUser() (*UserInfoResponse, error) {
	_, row, err := execPrepStmts(singleRow, utils.SelectUserByID, u.TapooID)
	if err != nil {
		return nil, err
	}

	var d UserInfoResponse
	err = row.Scan(&d.TapooID, &d.Email, &d.CreatedAt, &d.UpdateAt)

	return &d, err
}

// GetOrCreateUser creates the new user with tapoo ID provided.
// Email used can be empty or not.
func (u *UserInfor) GetOrCreateUser() (*UserInfoResponse, error) {
	if err := u.validateUserID(); err != nil {
		return err
	}

	if len(u.Email) > utils.MAX_EMAIL_LENGTH {
		return nil, fmt.Errorf(invalidData, "Email", u.Email[:10]+"... (Too long)")
	}

	switch u.createUser() {
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
func (u *UserInfor) UpdateUser() error {
	switch {
	case len(u.Email) == 0:
		return fmt.Errorf(invalidData, "Email", "missing")

	case len(u.Email) > utils.MAX_EMAIL_LENGTH:
		return fmt.Errorf(invalidData, "Email", u.Email[:10]+"... (Too long)")
	}

	if err := u.validateUserID(); err != nil {
		return err
	}

	_, _, err := execPrepStmts(noReturnVal, utils.UpdateUserEmailByID, u.Email, u.TapooID)
	return err
}

// execPrepStmts executes the Prepared statement for the sql queries.
func execPrepStmts(queryType int, sqlQuery string, val ...interface{}) (*sql.Rows, *sql.Row, error) {
	db := utils.GetDBConfig()
	stmt, err := db.Prepare(sqlQuery)
	if err != nil {
		return nil, nil, err
	}

	defer stmt.Close()

	switch queryType {
	case noReturnVal:
		_, err = db.Exec(sqlQuery, val...)
		return nil, nil, err

	case singleRow:
		row := db.QueryRow(sqlQuery, val...)
		return nil, row, nil

	case multiRows:
		rows, err := db.Query(sqlQuery, val...)
		return rows, nil, err

	default:
		return nil, nil,
			fmt.Errorf(invalidData, "query type", queryType)
	}
}

// validateUserID assertains the user ID values is not empty of past the required
// characters.
func (u *UserInfor) validateUserID() error {
	switch {
	case len(u.TapooID) == 0:
		return fmt.Errorf(invalidData, "Tapoo ID", "missing")

	case len(u.TapooID) > utils.MAX_TAPOO_ID_LENGTH:
		return fmt.Errorf(invalidData, "Tapoo ID", u.TapooID[:10]+"... (Too long)")
	}

	return nil
}
