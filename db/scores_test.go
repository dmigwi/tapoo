// +build dbtests

package db

import (
	"os"
	"reflect"
	"strings"
	"testing"

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
		user      *UserInfor
		errSubStr string
	}

	td := []testData{
		{
			testName:  "create_duplicate_game_level_entry",
			uuid:      "sample_uuid_value",
			user:      &UserInfor{TapooID: "rghirardi7", Level: 98},
			errSubStr: "Duplicate entry 'rghirardi7' for key 'user_id'",
		},
		{
			testName: "create_correct_entry",
			uuid:     "sample_unique_uuid_value",
			user:     &UserInfor{TapooID: "dmigwi", Level: 20},
		},
		{
			testName:  "too_long_user_id",
			uuid:      "sample_unique_uuid_value",
			user:      &UserInfor{TapooID: "this_should_be_greater_than_20_characters", Level: 150},
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
		})
	}
}

// TestGetLevelScore tests the functionality of getLevelScore
func TestGetLevelScore(t *testing.T) {
	type testData struct {
		testName  string
		user      *UserInfor
		errSubStr string
		result    *LevelScoreResponse
	}

	td := []testData{
		{
			testName:  "user_id_does_not_exists",
			user:      &UserInfor{TapooID: "none-existent-ID", Level: 20},
			errSubStr: "'none-existent-ID' user_id provided does not exists",
			result:    nil,
		},
		{
			testName: "fetch_correctly_data_that_already_exists",
			user:     &UserInfor{TapooID: "mmaxwell0", Level: 2},
			result: &LevelScoreResponse{
				TapooID:     "mmaxwell0",
				Email:       "asainsberry4@amazon.com",
				Level:       2,
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

			if (data == nil) && (d.result != nil) {
				t.Fatal("expected a none nil result to be returned but its wasn't")
			}

			if (data != nil) && (d.result == nil) {
				t.Fatal("expected a nil data result to be returned but it wasn't")
			}

			if (data != nil) && (d.result != nil) {
				if data.TapooID != d.result.TapooID {
					t.Fatalf("expected user_id %s but found %s", d.result.TapooID, data.TapooID)
				}

				if data.Email != d.result.Email {
					t.Fatalf("expected email %s but found %s", d.result.Email, data.Email)
				}

				if data.Level != d.result.Level {
					t.Fatalf("expected game level %s but found %s", d.result.Level, data.Level)
				}

				if data.LevelScores != d.result.LevelScores {
					t.Fatalf("expected user_id %s but found %s", d.result.LevelScores, data.LevelScores)
				}
			}
		})
	}
}

// TestGetOrCreateLevelScore tests the functionality of GetOrCreateLevelScore
func TestGetOrCreateLevelScore(t *testing.T) {
	type testData struct {
		testName  string
		user      *UserInfor
		errSubStr string
		result    *LevelScoreResponse
	}

	td := []testData{
		{
			testName:  "user_id_does_not_exists",
			user:      &UserInfor{TapooID: "none-existent-ID", Level: 20},
			errSubStr: "'none-existent-ID' user_id provided does not exists",
			result:    nil,
		},
		{

			testName:  "empty_user_id",
			user:      &UserInfor{TapooID: "", Level: 1},
			errSubStr: "invalid Tapoo ID found : '(empty)'",
			result:    nil,
		},
		{

			testName:  "too_long_user_id_more_than_20_characters",
			user:      &UserInfor{TapooID: "a6a1-b43d84afa437-d3140030-4a5c-4352-9a8a-8fe4d988502-9a8a-8fe4d9", Level: 3},
			errSubStr: "invalid Tapoo ID found : 'a6a1-b43d8... (Too long)'",
			result:    nil,
		},
		{
			testName: "create_and_fetch_newly_created_data",
			user:     &UserInfor{TapooID: "mcruft9", Level: 2},
			result: &LevelScoreResponse{
				TapooID:     "mcruft9",
				Email:       "people@niahub.com",
				Level:       999,
				LevelScores: 78557,
			},
		},
		{
			testName: "fetch_correctly_data_that_already_exists",
			user:     &UserInfor{TapooID: "mmaxwell0", Level: 2},
			result: &LevelScoreResponse{
				TapooID:     "mmaxwell0",
				Email:       "asainsberry4@amazon.com",
				Level:       2,
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

			if (data == nil) && (d.result != nil) {
				t.Fatal("expected a none nil result to be returned but its wasn't")
			}

			if (data != nil) && (d.result == nil) {
				t.Fatal("expected a nil data result to be returned but it wasn't")
			}

			if (data != nil) && (d.result != nil) {
				if data.TapooID != d.result.TapooID {
					t.Fatalf("expected user_id %s but found %s", d.result.TapooID, data.TapooID)
				}

				if data.Email != d.result.Email {
					t.Fatalf("expected email %s but found %s", d.result.Email, data.Email)
				}

				if data.Level != d.result.Level {
					t.Fatalf("expected game level %s but found %s", d.result.Level, data.Level)
				}

				if data.LevelScores != d.result.LevelScores {
					t.Fatalf("expected user_id %s but found %s", d.result.LevelScores, data.LevelScores)
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
		user := &UserInfor{Level: 9}
		data, err := user.GetTopTenLevelScores()

		if err != nil {
			t.Fatalf("expected no error but found: %v", err)
		}

		var foundOrderedScores = make([]uint32, len(data))
		var foundUserIDs = make([]string, len(data))
		var foundEmails = make([]string, len(data))

		for _, v := range data {
			foundOrderedScores = append(foundOrderedScores, v.LevelScores)
			foundUserIDs = append(foundUserIDs, v.TapooID)
			foundEmails = append(foundEmails, v.Email)
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
		user      *UserInfor
		errSubStr string
	}

	td := []testData{
		{
			testName:  "empty_user_id",
			newScore:  326,
			user:      &UserInfor{TapooID: "", Level: 23},
			errSubStr: "invalid Tapoo ID found : '(empty)'",
		},
		{
			testName:  "too_long_user_ID",
			newScore:  326,
			user:      &UserInfor{TapooID: "a6a1-b43d84afa437-d3140030-4a5c-4352-9a8a-8fe4d988502-9a8a-8fe4d9", Level: 23},
			errSubStr: "invalid Tapoo ID found : 'a6a1-b43d8... (Too long)'",
		},
		{
			testName: "correct_values_are_provided",
			newScore: 1000,
			user:     &UserInfor{TapooID: "dmigwi", Level: 1},
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
