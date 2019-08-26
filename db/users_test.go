// +build dbtests

package db

import (
	"strings"
	"testing"
	"time"
)

// TestCreateUser tests the functionality of createUser
func TestCreateUser(t *testing.T) {
	type testData struct {
		testName  string
		user      *UserInfo
		errSubStr string
	}

	td := []testData{
		{
			testName:  "duplicate_user_id",
			user:      &UserInfo{TapooID: "dmigwi"},
			errSubStr: "Duplicate entry 'dmigwi'",
		},
		{
			testName:  "empty_user_id",
			user:      &UserInfo{TapooID: ""},
			errSubStr: "empty Tapoo ID",
		},
		{
			testName:  "too_long_user_id",
			user:      &UserInfo{TapooID: "this-is-a-very-long-user-id"},
			errSubStr: "too long Tapoo ID",
		},
		{
			testName: "too_long_email",
			user: &UserInfo{
				TapooID: "prince-charles",
				Email:   "charles-philip-arthur-george-mountbatten-windsor@royalfamily.co.uk",
			},
			errSubStr: "too long Email",
		},
		{
			testName: "pass_correct_parameters",
			user:     &UserInfo{TapooID: "msupaS"},
		},
	}

	for _, d := range td {
		t.Run(d.testName, func(t *testing.T) {
			err := d.user.createUser()
			if (err == nil) && d.errSubStr != "" {
				t.Fatalf("expected no error but found: %v", err)
			}

			if (err != nil) && strings.Contains(err.Error(), d.errSubStr) {
				t.Fatalf("expected error to contain (%v) but found (%v)", d.errSubStr, err)
			}

			if err == nil {
				// User creation must have been successful.
				newUser := &UserInfo{TapooID: d.user.TapooID}
				data, err := newUser.getUser()
				if (err != nil) || (data == nil) {
					t.Fatalf("expect the user creation to have been successful but it wasn't: %v", err)
				}

				if data.User.Email != d.user.Email {
					t.Fatalf("expected the user id to be %s but found %s", d.user.Email, data.User.Email)
				}

				var timeNow = time.Now()
				if timeNow.After(data.CreatedAt) {
					t.Fatalf("expected the user to have been created before %v but was created on %v", timeNow, data.CreatedAt)
				}
				if timeNow.After(data.UpdateAt) {
					t.Fatalf("expected the user to have been updated before %v but was updated on %v", timeNow, data.UpdateAt)
				}
			}
		})
	}
}

// TestGetUser tests the functionality of getUser
func TestGetUser(t *testing.T) {
	type testData struct {
		testName  string
		user      *UserInfo
		errSubStr string
		result    UserInfoResponse
	}

	td := []testData{
		{
			testName:  "empty_user_id",
			user:      &UserInfo{TapooID: ""},
			errSubStr: "missing Tapoo ID",
		},
		{
			testName:  "too_long_user_id",
			user:      &UserInfo{TapooID: "this-is-a-very-long-user-id"},
			errSubStr: "too long Tapoo ID",
		},
		{
			testName:  "missing_user_id",
			user:      &UserInfo{TapooID: "fake_sample_id"},
			errSubStr: "missing Tapoo ID",
		},
		{
			testName: "fetch_using_correct_parameters",
			user:     &UserInfo{TapooID: "dmigwi"},
			result: UserInfoResponse{
				User: UserInfo{
					TapooID: "dmigwi",
					Email:   "dmigwi@niahub.com",
				},
			},
		},
	}

	for _, d := range td {
		t.Run(d.testName, func(t *testing.T) {
			data, err := d.user.getUser()
			if (err == nil) && d.errSubStr != "" {
				t.Fatalf("expected no error but found: %v", err)
			}

			if (err != nil) && strings.Contains(err.Error(), d.errSubStr) {
				t.Fatalf("expected error to contain (%v) but found (%v)", d.errSubStr, err)
			}

			if data != nil {
				if data.User.TapooID != d.result.User.TapooID {
					t.Fatalf("expected the user id to be %s but found %s", d.result.User.TapooID, data.User.TapooID)
				}
				if data.User.Email != d.result.User.Email {
					t.Fatalf("expected the user id to be %s but found %s", d.result.User.Email, data.User.Email)
				}

				var timeNow = time.Now()
				if timeNow.After(data.CreatedAt) {
					t.Fatalf("expected the user to have been created before %v but was created on %v", timeNow, data.CreatedAt)
				}
				if timeNow.After(data.UpdateAt) {
					t.Fatalf("expected the user to have been updated before %v but was updated on %v", timeNow, data.UpdateAt)
				}
			}
		})
	}
}

// TestGetOrCreateUser tests the functionality of GetOrCreateUser
func TestGetOrCreateUser(t *testing.T) {
	type testData struct {
		testName  string
		user      *UserInfo
		errSubStr string
		result    UserInfoResponse
	}

	td := []testData{
		{
			testName:  "empty_user_id",
			user:      &UserInfo{TapooID: ""},
			errSubStr: "invalid Tapoo ID found : '(empty)'",
		},
		{
			testName:  "too_long_user_id",
			user:      &UserInfo{TapooID: "this-is-a-very-long-user-id"},
			errSubStr: "too long Tapoo ID",
		},
		{
			testName: "too_long_email",
			user: &UserInfo{
				TapooID: "prince-charles",
				Email:   "charles-philip-arthur-george-mountbatten-windsor@royalfamily.co.uk",
			},
			errSubStr: "too long Email",
		},
		{
			testName: "fetch_newly_created_user_without_email",
			user:     &UserInfo{TapooID: "user_without_email"},
			result: UserInfoResponse{
				User: UserInfo{TapooID: "user_without_email"},
			},
		},
		{
			testName: "fetch_newly_created_user_with_email",
			user:     &UserInfo{TapooID: "user_with_email", Email: "new.email@test.co.ke"},
			result: UserInfoResponse{
				User: UserInfo{TapooID: "user_with_email", Email: "new.email@test.co.ke"},
			},
		},
		{
			testName: "fetch_using_correct_parameters",
			user:     &UserInfo{TapooID: "dmigwi"},
			result: UserInfoResponse{
				User: UserInfo{
					TapooID: "dmigwi",
					Email:   "dmigwi@niahub.com",
				},
			},
		},
	}

	for _, d := range td {
		t.Run(d.testName, func(t *testing.T) {
			data, err := d.user.getUser()
			if (err == nil) && d.errSubStr != "" {
				t.Fatalf("expected no error but found: %v", err)
			}

			if (err != nil) && strings.Contains(err.Error(), d.errSubStr) {
				t.Fatalf("expected error to contain (%v) but found (%v)", d.errSubStr, err)
			}

			if data != nil {
				if data.User.TapooID != d.result.User.TapooID {
					t.Fatalf("expected the user id to be %s but found %s", d.result.User.TapooID, data.User.TapooID)
				}
				if data.User.Email != d.result.User.Email {
					t.Fatalf("expected the user id to be %s but found %s", d.result.User.Email, data.User.Email)
				}

				var timeNow = time.Now()
				if timeNow.After(data.CreatedAt) {
					t.Fatalf("expected the user to have been created before %v but was created on %v", timeNow, data.CreatedAt)
				}
				if timeNow.After(data.UpdateAt) {
					t.Fatalf("expected the user to have been updated before %v but was updated on %v", timeNow, data.UpdateAt)
				}
			}
		})
	}
}

// TestUpdateUser tests the functionality of UpdateUser
func TestUpdateUser(t *testing.T) {
	type testData struct {
		testName  string
		user      *UserInfo
		errSubStr string
	}

	td := []testData{
		{
			testName:  "duplicate_user_id",
			user:      &UserInfo{TapooID: "dmigwi"},
			errSubStr: "Duplicate entry 'dmigwi'",
		},
		{
			testName:  "empty_user_id",
			user:      &UserInfo{TapooID: ""},
			errSubStr: "empty Tapoo ID",
		},
		{
			testName:  "too_long_user_id",
			user:      &UserInfo{TapooID: "this-is-a-very-long-user-id"},
			errSubStr: "too long Tapoo ID",
		},
		{
			testName: "too_long_email",
			user: &UserInfo{
				TapooID: "prince-charles",
				Email:   "charles-philip-arthur-george-mountbatten-windsor@royalfamily.co.uk",
			},
			errSubStr: "too long Email",
		},
		{
			testName:  "empty_email",
			user:      &UserInfo{TapooID: "rghirardi7"},
			errSubStr: "empty_email",
		},
		{
			testName:  "update_a_missing_user_id",
			user:      &UserInfo{TapooID: "ironman", Email: "iron.man@gamer.net"},
			errSubStr: "missing_user_id",
		},
		{
			testName: "correct_parameters_are_used",
			user:     &UserInfo{TapooID: "rghirardi7", Email: "iron.man@gamer.net"},
		},
	}

	for _, d := range td {
		t.Run(d.testName, func(t *testing.T) {
			err := d.user.UpdateUserEmail()
			if (err == nil) && d.errSubStr != "" {
				t.Fatal("expected an error but found none")
			}

			if (err != nil) && strings.Contains(err.Error(), d.errSubStr) {
				t.Fatalf("expected error to contain (%v) but found (%v)", d.errSubStr, err)
			}

			if err == nil {
				// Update must have been successful.
				newUser := &UserInfo{TapooID: d.user.TapooID}
				data, err := newUser.getUser()
				if (err != nil) || (data == nil) {
					t.Fatalf("expect the email update to have been successful but it wasn't: %v", err)
				}

				if data.User.Email != d.user.Email {
					t.Fatalf("expected the user id to be %s but found %s", d.user.Email, data.User.Email)
				}

				var timeNow = time.Now()
				if timeNow.After(data.CreatedAt) {
					t.Fatalf("expected the user to have been created before %v but was created on %v", timeNow, data.CreatedAt)
				}
				if timeNow.After(data.UpdateAt) {
					t.Fatalf("expected the user to have been updated before %v but was updated on %v", timeNow, data.UpdateAt)
				}
			}
		})
	}
}

// TestExecPrepStmts tests the functionality of execPrepStmts
func TestExecPrepStmts(t *testing.T) {
	type testData struct {
		testName  string
		queryType int
		query     string
		params    []interface{}
		errSubStr string
		rowsCount int
		rowCount  int
	}

	td := []testData{
		{
			testName:  "invalid_query_type",
			queryType: 50,
			query:     "SELECT * FROM users;",
			params:    []interface{}{""},
			errSubStr: "invalid queryType found : '50'",
		},
		{
			testName:  "query_missing_some_arguments",
			queryType: singleRow,
			query:     "SELECT email FROM users WHERE id = ?",
			errSubStr: "sql: expected 0 arguments, got 1",
		},
		{
			testName:  "query_having_extra_arguments",
			queryType: singleRow,
			query:     "SELECT email FROM users WHERE id LIKE ?;",
			params:    []interface{}{"d", "a"},
			errSubStr: "sql: expected 1 arguments, got 2",
		},
		{
			testName:  "query_with_syntax_error",
			queryType: singleRow,
			query:     "SELECT email users WHERE id LIKE ?;",
			params:    []interface{}{"d"},
			errSubStr: "Error 1064: You have an error in your SQL syntax;",
		},
		{
			testName:  "incorrect_noReturn_query_type_set",
			queryType: noReturnVal,
			query:     "SELECT email FROM users LIMIT 3",
			params:    []interface{}{""},
			errSubStr: "invalid query type 0 set",
		},
		{
			testName:  "incorrect_singleRow_query_type_set",
			queryType: singleRow,
			query:     "SELECT email FROM users LIMIT 3;",
			params:    []interface{}{""},
			errSubStr: "invalid query type 1 set",
		},
		{
			testName:  "incorrect_multiRow_query_type_set",
			queryType: singleRow,
			query:     "SELECT email FROM users LIMIT 1;",
			params:    []interface{}{""},
			errSubStr: "invalid query type 2 set",
		},
		{
			testName:  "correct_noReturn_query_type_set",
			queryType: noReturnVal,
			query:     "UPDATE scores SET scores = ? WHERE game_level = ? and user_id = ?;",
			params:    []interface{}{1000000, 74, "dmigwi"},
		},
		{
			testName:  "correct_singleRow_query_type_set",
			queryType: singleRow,
			query:     "SELECT email FROM users WHERE id = ?",
			params:    []interface{}{"dmigwi"},
			rowCount:  1,
		},
		{
			testName:  "correct_multiRow_query_type_set",
			queryType: multiRows,
			query:     "SELECT * FROM users;",
			params:    []interface{}{""},
			rowsCount: 10,
		},
	}

	for _, d := range td {
		t.Run(d.testName, func(t *testing.T) {
			rows, row, err := execPrepStmts(d.queryType, d.query, d.params)
			if (err == nil) && d.errSubStr != "" {
				t.Fatal("expected an error but found none")
			}

			if (err != nil) && strings.Contains(err.Error(), d.errSubStr) {
				t.Fatalf("expected error to contain (%v) but found (%v)", d.errSubStr, err)
			}

			if row != nil && d.rowCount != 1 {
				t.Fatal("expected to find one row but none was returned")
			}

			if rows != nil {
				count := 0
				for rows.Next() {
					count++
				}

				if count != d.rowsCount {
					t.Fatalf("expect to find rows %d but found %d", d.rowsCount, count)
				}
			}
		})
	}
}
