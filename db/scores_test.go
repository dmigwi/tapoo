// +build dbtests

package db

import (
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/dmigwi/tapoo/db/utils"
	"github.com/go-sql-driver/mysql"
)

// TestMain sets up the test environment by loading the mock data.
func TestMain(m *testing.M) {
	withErrorExit := func(err error) {
		if err != nil {
			panic(err)
		}
	}

	config, err := utils.GetDBConfig()
	withErrorExit(err)

	withErrorExit(config.DbConn.Ping())

	// drop the users and the scores tables if they exist
	_, err = config.DbConn.Query("DROP TABLE IF EXISTS scores, users;")
	withErrorExit(err)

	// recreate the tables
	err = config.CheckTablesExit()
	withErrorExit(err)

	// load mock data users mock data
	loadData := func(filePath, table string) error {
		mysql.RegisterLocalFile(filePath)
		_, err = config.DbConn.Exec(`LOAD DATA LOCAL INFILE '` + filePath +
			`' INTO TABLE ` + table +
			` FIELDS TERMINATED BY ',' LINES TERMINATED BY '\n' IGNORE 1 LINES;`)
		return err
	}

	withErrorExit(loadData("sampleData/users.csv", "users"))
	withErrorExit(loadData("sampleData/scores.csv", "scores"))

	os.Exit(m.Run())
}

// TestCreateLevelScore tests the functionality of createLevelScore
func TestCreateLevelScore(t *testing.T) {
	type testData struct {
		testName  string
		uuid      string
		user      *UserInfo
		errSubStr string
	}

	td := []testData{
		{
			testName:  "create_duplicate_game_level_entry",
			uuid:      "sample_uuid_value",
			user:      &UserInfo{TapooID: "rghirardi7", Level: 98},
			errSubStr: "Duplicate entry 'rghirardi7' for key 'user_id'",
		},
		{
			testName: "create_correct_entry",
			uuid:     "sample_unique_uuid_value",
			user:     &UserInfo{TapooID: "dmigwi", Level: 20},
		},
		{
			testName:  "too_long_user_id",
			uuid:      "sample_unique_uuid_value",
			user:      &UserInfo{TapooID: "this_should_be_greater_than_20_characters", Level: 150},
			errSubStr: "'user_id' value provided exceeds 20 characters",
		},
	}

	for _, d := range td {
		t.Run(d.testName, func(t *testing.T) {
			err := d.user.createLevelScore(d.uuid)
			if (err == nil) && d.errSubStr != "" {
				t.Fatalf("expected no error but found: %v", err)
			}

			if (err != nil) && strings.Contains(err.Error(), d.errSubStr) {
				t.Fatalf("expected error to contain (%v) but found (%v)", d.errSubStr, err)
			}

			if err != nil {
				// Creating a new Level entry must have been successful.
				newUser := &UserInfo{TapooID: d.user.TapooID, Level: d.user.Level}
				data, err := newUser.getLevelScore()

				if err != nil {
					t.Fatalf("expected no error but found %v", err)
				}

				if data.User.TapooID != d.user.TapooID {
					t.Fatalf("expected user_id %s but found %s", d.user.TapooID, data.User.TapooID)
				}

				if data.User.Email != d.user.Email {
					t.Fatalf("expected email %s but found %s", d.user.Email, data.User.Email)
				}

				if data.User.Level != d.user.Level {
					t.Fatalf("expected game level %d but found %d", d.user.Level, data.User.Level)
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

// TestGetLevelScore tests the functionality of getLevelScore
func TestGetLevelScore(t *testing.T) {
	type testData struct {
		testName  string
		user      *UserInfo
		errSubStr string
		result    LevelScoreResponse
	}

	td := []testData{
		{
			testName:  "user_id_does_not_exists",
			user:      &UserInfo{TapooID: "none-existent-ID", Level: 20},
			errSubStr: "'none-existent-ID' user_id provided does not exists",
		},
		{
			testName: "fetch_correctly_data_that_already_exists",
			user:     &UserInfo{TapooID: "mmaxwell0", Level: 2},
			result: LevelScoreResponse{
				User: UserInfo{
					TapooID: "mmaxwell0",
					Email:   "asainsberry4@amazon.com",
					Level:   2,
				},
				LevelScores: 785578,
			},
		},
	}

	for _, d := range td {
		t.Run(d.testName, func(t *testing.T) {
			data, err := d.user.getLevelScore()
			if (err == nil) && d.errSubStr != "" {
				t.Fatalf("expected no error but found: %v", err)
			}

			if (err != nil) && strings.Contains(err.Error(), d.errSubStr) {
				t.Fatalf("expected error to contain (%v) but found (%v)", d.errSubStr, err)
			}

			if data != nil {
				if data.User.TapooID != d.result.User.TapooID {
					t.Fatalf("expected user_id %s but found %s", d.result.User.TapooID, data.User.TapooID)
				}

				if data.User.Email != d.result.User.Email {
					t.Fatalf("expected email %s but found %s", d.result.User.Email, data.User.Email)
				}

				if data.User.Level != d.result.User.Level {
					t.Fatalf("expected game level %d but found %d", d.result.User.Level, data.User.Level)
				}

				if data.LevelScores != d.result.LevelScores {
					t.Fatalf("expected user_id %d but found %d", d.result.LevelScores, data.LevelScores)
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

// TestGetOrCreateLevelScore tests the functionality of GetOrCreateLevelScore
func TestGetOrCreateLevelScore(t *testing.T) {
	type testData struct {
		testName  string
		user      *UserInfo
		errSubStr string
		result    LevelScoreResponse
	}

	td := []testData{
		{
			testName:  "user_id_does_not_exists",
			user:      &UserInfo{TapooID: "none-existent-ID", Level: 20},
			errSubStr: "'none-existent-ID' user_id provided does not exists",
		},
		{

			testName:  "empty_user_id",
			user:      &UserInfo{TapooID: "", Level: 1},
			errSubStr: "invalid Tapoo ID found : '(empty)'",
		},
		{

			testName:  "too_long_user_id_more_than_20_characters",
			user:      &UserInfo{TapooID: "a6a1-b43d84afa437-d3140030-4a5c-4352-9a8a-8fe4d988502-9a8a-8fe4d9", Level: 3},
			errSubStr: "invalid Tapoo ID found : 'a6a1-b43d8... (Too long)'",
		},
		{
			testName: "create_and_fetch_newly_created_data",
			user:     &UserInfo{TapooID: "mcruft9", Level: 2},
			result: LevelScoreResponse{
				User: UserInfo{
					TapooID: "mcruft9",
					Email:   "people@niahub.com",
					Level:   999,
				},
				LevelScores: 78557,
			},
		},
		{
			testName: "fetch_correctly_data_that_already_exists",
			user:     &UserInfo{TapooID: "mmaxwell0", Level: 2},
			result: LevelScoreResponse{
				User: UserInfo{
					TapooID: "mmaxwell0",
					Email:   "asainsberry4@amazon.com",
					Level:   2,
				},
				LevelScores: 785578,
			},
		},
	}

	for _, d := range td {
		t.Run(d.testName, func(t *testing.T) {
			data, err := d.user.getLevelScore()
			if (err == nil) && d.errSubStr != "" {
				t.Fatalf("expected no error but found: %v", err)
			}

			if (err != nil) && strings.Contains(err.Error(), d.errSubStr) {
				t.Fatalf("expected error to contain (%v) but found (%v)", d.errSubStr, err)
			}

			if data != nil {
				if data.User.TapooID != d.result.User.TapooID {
					t.Fatalf("expected user_id %s but found %s", d.result.User.TapooID, data.User.TapooID)
				}

				if data.User.Email != d.result.User.Email {
					t.Fatalf("expected email %s but found %s", d.result.User.Email, data.User.Email)
				}

				if data.User.Level != d.result.User.Level {
					t.Fatalf("expected game level %d but found %d", d.result.User.Level, data.User.Level)
				}

				if data.LevelScores != d.result.LevelScores {
					t.Fatalf("expected user_id %d but found %d", d.result.LevelScores, data.LevelScores)
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

// TestGetTopTenScores tests the functionality of GetTopTenScores
func TestGetTopTenScores(t *testing.T) {
	// Expected details for the top ten resultset on level 9.
	expectedUserIDs := []string{"akenson8", "aedgeworth5", "mcruft9"}
	expectedEmails := []string{"admin@niahub.com", "sgravell1@europa.eu", "people@niahub.com"}
	expectedScores := []uint32{586611, 480669, 120159}

	t.Run("top_ten_resultset_on_level_9", func(t *testing.T) {
		user := &UserInfo{Level: 9}
		data, err := user.GetTopTenLevelScores()

		if err != nil {
			t.Fatalf("expected no error but found: %v", err)
		}

		var foundOrderedScores = make([]uint32, len(data))
		var foundUserIDs = make([]string, len(data))
		var foundEmails = make([]string, len(data))

		for _, v := range data {
			foundOrderedScores = append(foundOrderedScores, v.LevelScores)
			foundUserIDs = append(foundUserIDs, v.User.TapooID)
			foundEmails = append(foundEmails, v.User.Email)
		}

		if !reflect.DeepEqual(foundUserIDs, expectedUserIDs) {
			t.Fatalf("expected the list of user_id to be (%v) but found (%v)", expectedUserIDs, foundUserIDs)
		}

		if !reflect.DeepEqual(foundEmails, expectedEmails) {
			t.Fatalf("expected the list of emails to be (%v) but found (%v)", expectedEmails, foundEmails)
		}

		if !reflect.DeepEqual(foundOrderedScores, expectedScores) {
			t.Fatalf("expected the list of scores to be (%v) but found (%v)", expectedScores, foundOrderedScores)
		}
	})
}

// TestUpdateLevelScores tests the functionality of UpdateLevelScores
func TestUpdateLevelScores(t *testing.T) {
	type testData struct {
		testName  string
		newScore  uint32
		user      *UserInfo
		errSubStr string
	}

	td := []testData{
		{
			testName:  "empty_user_id",
			newScore:  326,
			user:      &UserInfo{TapooID: "", Level: 23},
			errSubStr: "invalid Tapoo ID found : '(empty)'",
		},
		{
			testName:  "too_long_user_ID",
			newScore:  326,
			user:      &UserInfo{TapooID: "a6a1-b43d84afa437-d3140030-4a5c-4352-9a8a-8fe4d988502-9a8a-8fe4d9", Level: 23},
			errSubStr: "invalid Tapoo ID found : 'a6a1-b43d8... (Too long)'",
		},
		{
			testName:  "update_zero_level_score",
			newScore:  0,
			user:      &UserInfo{TapooID: "dmigwi", Level: 12},
			errSubStr: "cannot update a zero level score",
		},
		{
			testName: "correct_values_are_provided",
			newScore: 1000,
			user:     &UserInfo{TapooID: "dmigwi", Level: 1},
		},
	}

	for _, d := range td {
		t.Run(d.testName, func(t *testing.T) {
			err := d.user.UpdateLevelScore(d.newScore)
			if (err == nil) && d.errSubStr != "" {
				t.Fatalf("expected no error but found: %v", err)
			}

			if (err != nil) && strings.Contains(err.Error(), d.errSubStr) {
				t.Fatalf("expected error to contain (%v) but found (%v)", d.errSubStr, err)
			}
		})
	}
}
