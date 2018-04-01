package db

import (
	"database/sql"
	"testing"
	"time"

	. "github.com/smartystreets/goconvey/convey"
)

// TestCreateUser tests the functionality of createUser
func TestCreateUser(t *testing.T) {
	Convey("TestCreateUser: Given the UserInfor when creating a user with", t, func() {
		Convey("values containing unescaped characters, a value that implements an error"+
			" interface should be returned", func() {
			user := &UserInfor{Level: 23, TapooID: "sample id"}
			err := user.createUser("f538ab54-1692-41bf-9a9a-7a9a5808e086")

			So(err, ShouldNotBeNil)
			So(err, ShouldImplement, (*error)(nil))
			So(err.Error(), ShouldContainSubstring, "sql error")
		})

		Convey("values that have no invalid characters, a nil error value should"+
			" be returned", func() {
			user := &UserInfor{Level: 1, TapooID: "9a9a-7a9a5808e086", Email: "test@naihub.com"}
			err := user.createUser("f538ab54-1692-41bf-9a9a-7a9a5808e086")

			So(err, ShouldBeNil)

			data, err := user.getUser()

			So(err, ShouldBeNil)
			So(data.TapooID, ShouldEqual, "9a9a-7a9a5808e086")
			So(data.Email, ShouldEqual, "test@naihub.com")
		})
	})
}

// TestGetUser tests the functionality of
func TestGetUser(t *testing.T) {
	errFunc := func(user *UserInfor, errMsg string) {
		data, err := user.getUser()

		So(err, ShouldNotBeNil)
		So(data, ShouldBeNil)
		So(err, ShouldImplement, (*error)(nil))
		So(err.Error(), ShouldContainSubstring, errMsg)
	}

	Convey("TestGetUser: Given the UserInfor when fetching a user with", t, func() {
		Convey("values containing unescaped characters, a value that implements an error"+
			" interface should be returned", func() {
			user := &UserInfor{Level: 23, TapooID: "sample id"}

			errFunc(user, "sql error")
		})

		Convey("the tapoo id provided that does not exist, a value that implements an error"+
			" interface should be returned", func() {
			user := &UserInfor{Level: 23, TapooID: "fake_sample_id"}

			errFunc(user, "sql error: missing records")
		})

		Convey("the values used are properly escaped and the tapoo id exists in the db, "+
			"a nil error value should be returned", func() {
			user := &UserInfor{Level: 18, TapooID: "GzlWAL0mP"}

			data, err := user.getUser()

			So(err, ShouldBeNil)
			So(data.CreatedAt, ShouldHappenBefore, time.Now())
			So(data.UpdateAt, ShouldHappenBefore, time.Now())
			So(data.Email, ShouldEqual, "ckumaar0@tripod.com")
			So(data.TapooID, ShouldEqual, "GzlWAL0mP")
		})
	})
}

// TestGetOrCreateUser tests the functionality of GetOrCreateUser
func TestGetOrCreateUser(t *testing.T) {
	errFunc := func(user *UserInfor, errMsg string) {
		data, err := user.GetOrCreateUser()

		So(err, ShouldNotBeNil)
		So(data, ShouldBeNil)
		So(err, ShouldImplement, (*error)(nil))
		So(err.Error(), ShouldContainSubstring, errMsg)
	}

	Convey("TestGetOrCreateUser: Given the UserInfor when fetching or creating"+
		" a user with", func() {
		Convey("the tapoo ID empty, a value that implements an error interface"+
			" should be returned", func() {
			user := &UserInfor{TapooID: ""}

			errFunc(user, "invalid Tapoo ID found : ''(empty)")
		})

		Convey("the tapoo ID longer that 64 characters, a value that implements an error"+
			"interface should be returned", func() {
			user := &UserInfor{TapooID: "2af80406-5be2-4569-afba-b14e861-2af81406-5b42-893d-afba-6734grywu"}

			errFunc(user, "invalid Tapoo ID found : '2af80-5be2...'(Too long)")
		})

		Convey("the email longer than 64 characters, a value that implements an error"+
			" interface should be returned", func() {
			user := &UserInfor{TapooID: "SWfddew34",
				Email: "2af80406-5be2-4569-afba-b14e861-2af81406-5b42-893d-a3f@niahub.com"}

			errFunc(user, "invalid Email found : '2af80-5be2...'(Too long)")
		})

		Convey("the db connection that is invalid, a value that implements an error"+
			" interface should be returned", func() {
			copyOfDb := db
			user := &UserInfor{TapooID: "SWfddew34"}

			db = new(sql.DB)
			data, err := user.GetOrCreateUser()
			db = copyOfDb

			So(err, ShouldNotBeNil)
			So(data, ShouldBeNil)
			So(err, ShouldImplement, (*error)(nil))
			So(err.Error(), ShouldContainSubstring, "invalid db connection found")
		})

		Convey("the correct user infor used and the database connection is not invalid"+
			" the error value returned should be a nil value", func() {
			user := &UserInfor{TapooID: "FANVZWeOq2"}
			data, err := user.GetOrCreateUser()

			So(err, ShouldBeNil)
			So(data.Email, ShouldEqual, "test.user@naihub.com")
			So(data.TapooID, ShouldEqual, "FANVZWeOq2")
			So(data.CreatedAt, ShouldHappenBefore, time.Now())
			So(data.UpdateAt, ShouldHappenBefore, time.Now())
		})
	})
}

// TestUpdateUser tests the functionality of UpdateUser
func TestUpdateUser(t *testing.T) {
	errFunc := func(user *UserInfor, errMsg string) {
		err := user.UpdateUser()

		So(err, ShouldNotBeNil)
		So(err, ShouldImplement, (*error)(nil))
		So(err.Error(), ShouldContainSubstring, errMsg)
	}

	Convey("TestUpdateUser: Given the UserInfor while updating the user with", t, func() {
		Convey("the an empty tapoo id, a value that implements the error interface is"+
			" returned", func() {
			user := &UserInfor{TapooID: "", Email: "sample_user@naihub.com"}

			errFunc(user, "invalid Tapoo ID found : ''(empty)")
		})

		Convey("the tapoo id having more that 64 characters, a value that implements"+
			" the error interface is returned", func() {
			user := &UserInfor{Email: "sample_user@naihub.com",
				TapooID: "2af80406-5be2-4569-afba-b14e861-2af81406-5b42-893d-afba-6734grywu"}

			errFunc(user, "invalid Tapoo ID found : '2af80406-5...'(Too long)")
		})

		Convey("the an empty email, a value that implements the error interface is"+
			" returned", func() {
			user := &UserInfor{TapooID: "f80406-5be2", Email: ""}

			errFunc(user, "invalid Email found : ''(empty)")
		})

		Convey("the email having more that 64 characters, a value that implements"+
			" the error interface is returned", func() {
			user := &UserInfor{TapooID: "SWfddew34",
				Email: "2af80406-5be2-4569-afba-b14e861-2af81406-5b42-893d-a3f@niahub.com"}

			errFunc(user, "invalid Email found : '2af80-5be2...'(Too long)")
		})

		Convey("the values having invalid characters, a value that implements an error"+
			" interface should be returned", func() {
			user := &UserInfor{TapooID: "f80406 5be2", Email: "sample_user@naihub.com"}

			errFunc(user, "sql query error")
		})

		Convey("the correct values used, a nil value error should be returned", func() {
			user := &UserInfor{TapooID: "Vf2TqN5MB", Email: "sample_user@naihub.com"}
			err := user.UpdateUser()

			So(err, ShouldBeNil)

			data, err := user.getUser()

			So(err, ShouldBeNil)
			So(data.Email, ShouldEqual, "sample_user@naihub.com")
			So(data.TapooID, ShouldEqual, "Vf2TqN5MB")
		})
	})
}

// TestExecPrepStmts tests the functionality of execPrepStmts
func TestExecPrepStmts(t *testing.T) {
	errFunc := func(err error, errMsg string) {
		So(err, ShouldNotBeNil)
		So(err, ShouldImplement, (*error)(nil))
		So(err.Error(), ShouldContainSubstring, errMsg)
	}

	Convey("TestExecPrepStmts: Given a query and it other metadata with", func() {
		Convey("an invalid database connection a value that implements and error interface should be returned", func() {
			copyOfDb := db
			db = new(sql.DB)

			err := execPrepStmts(nil, multiRows, "SELECT * FROM users;", "")
			db = copyOfDb

			errFunc(err, "invalid database connection")
		})

		Convey("noReturnVal query having invalid/unescaped characters, a value that "+
			"implements the error interface should be returned", func() {
			err := execPrepStmts(nil, noReturnVal,
				"UPDATE scores SET high_score = ? WHERE game_level = ? and user_id = ?;", "1000", "12", "VZWe  Oq2p")

			errFunc(err, "sql error")
		})

		Convey("singleRow query having invalid/unescaped characters, a value that "+
			"implements the error interface should be returned", func() {
			err := execPrepStmts(nil, singleRow, "SELECT email FROM users WHERE id = ?;", "VZWe  Oq2p")

			errFunc(err, "sql error")
		})

		Convey("singleRow query having no result set data, a value that "+
			"implements the error interface should be returned", func() {
			err := execPrepStmts(nil, singleRow, "SELECT email FROM users WHERE user_id = ?;", "VZWe67346Oq2p")

			errFunc(err, "missing records")
		})

		Convey("multiRows query having invalid/unescaped characters, a value that "+
			"implements the error interface should be returned", func() {
			var r interface{}
			err := execPrepStmts(&r, multiRows, "SELECT email FROM users;", "")

			errFunc(err, "sql error")
		})

		Convey("noReturnVal query having the correct values, should return a nil error value", func() {
			err := execPrepStmts(nil, noReturnVal,
				"UPDATE scores SET high_score = ? WHERE game_level = ? and user_id = ?;", "1000", "12", "VZWeOq2p")

			So(err, ShouldBeNil)

			user := &UserInfor{Level: 12, TapooID: "VZWeOq2p"}
			data, err := user.getLevelScore()

			So(err, ShouldBeNil)
			So(data.HighScores, ShouldEqual, "1000")
		})

		Convey("singleRow query having the correct values, should return the fetched data and a nil error value", func() {
			var row UserInfoResponse

			err := execPrepStmts(&row, singleRow, "SELECT email FROM users WHERE id = ?;", "VZWeOq2p")

			So(err, ShouldBeNil)
			So(row.Email, ShouldEqual, "asainsberry4@amazon.com")
		})

		Convey("multiRows query having the correct values, should return the fetched data and a nil value error", func() {
			var r interface{}
			err := execPrepStmts(&r, multiRows, "SELECT email FROM users LIMIT 5;", "")

			So(err, ShouldBeNil)

			rows := r.(sql.Rows)
			realVal := &rows
			count := 0

			for realVal.NextResultSet() {
				count++
			}

			So(count, ShouldEqual, 5)
		})
	})
}
