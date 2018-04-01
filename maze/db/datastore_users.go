package db

import (
	"fmt"
	"strings"
	"time"

	uuid "github.com/satori/go.uuid"
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

// UserInfoResponse defines the expected response of a user infor request.
type UserInfoResponse struct {
	CreatedAt time.Time `db:"created_at"`
	Email     string    `db:"email"`
	TapooID   string    `db:"id"`
	UpdateAt  time.Time `db:"updated_at"`
}

// createUser creates a new user using the tapoo ID provided.
// A user can optional choose to visit the online website with there tapoo ID to
// update there emails and other extra information
func (u *UserInfor) createUser(uuid string) error {
	query := `INSERT INTO users (uuid, id, email) VALUES (?, ?, ?);`

	return execPrepStmts(nil, noReturnVal, query, uuid, u.TapooID, u.Email)
}

// getUser checks if the tapoo ID provided exists in the users information records.
func (u *UserInfor) getUser() (*UserInfoResponse, error) {
	query := `SELECT id, email, created_at, updated_at WHERE id = ?;`

	var user UserInfoResponse

	err := execPrepStmts(&user, singleRow, query, u.TapooID)

	return &user, err
}

// GetOrCreateUser creates the new user with provided tapoo ID provided if the
// tapoo ID provided does not exists. Email used can be empty or not.
func (u *UserInfor) GetOrCreateUser() (*UserInfoResponse, error) {
	switch {
	case len(u.TapooID) == 0:
		return nil, fmt.Errorf(invalidData, "Tapoo ID", u.TapooID+"(empty)")

	case len(u.TapooID) > 64:
		return nil, fmt.Errorf(invalidData, "Tapoo ID", u.TapooID[:10]+".... (Too long)")

	case len(u.Email) > 64:
		return nil, fmt.Errorf(invalidData, "Email", u.Email[:10]+".... (Too long)")
	}

	u4, err := uuid.NewV4()
	if err != nil {
		return nil, errGenUUID
	}

	err = u.createUser(u4.String())

	switch {
	case strings.Contains(err.Error(), "duplicate"):
	default:
		return nil, err
	}

	return u.getUser()
}

// UpdateUser should update the tapoo user information.
// While updating a user, the email should not be empty otherwise
// an error will be returned.
func (u *UserInfor) UpdateUser() error {
	switch {
	case len(u.TapooID) == 0:
		return fmt.Errorf(invalidData, "Tapoo ID", u.TapooID+"(empty)")

	case len(u.TapooID) > 64:
		return fmt.Errorf(invalidData, "Tapoo ID", u.TapooID[:10]+".... (Too long)")

	case len(u.Email) == 0:
		return fmt.Errorf(invalidData, "Email", u.Email+"(empty)")

	case len(u.Email) > 64:
		return fmt.Errorf(invalidData, "Email", u.Email[:10]+".... (Too long)")
	}

	query := `UPDATE users SET email = ? WHERE id = ?;`

	return execPrepStmts(nil, noReturnVal, query, u.Email, u.TapooID)
}

// execPrepStmts executes the Prepared statement for the sql queries.
func execPrepStmts(resp interface{}, queryType int, sqlQuery string, val ...string) error {
	stmt, err := db.Prepare(sqlQuery)
	if err != nil {
		return err
	}

	switch queryType {
	case noReturnVal:
		_, err = stmt.Exec(val)

	case singleRow:
		err = stmt.QueryRow(val).Scan(resp)

	case multiRows:
		resp, err = stmt.Query(val)
	}

	if err != nil {
		return err
	}

	return stmt.Close()
}
