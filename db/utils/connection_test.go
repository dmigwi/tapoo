// +build dbtests

package utils

import (
	"os"
	"reflect"
	"testing"
)

func TestCreateDbConnection(t *testing.T) {
	t.Run("fetch_db_connection_with_envVars_present", func(t *testing.T) {
		var newConfig = new(DbConfig)
		err := newConfig.createDbConnection()
		if err == nil {
			t.Fatal("expected an error but found none")
		} else if err.Error() != "db connection config missing" {
			t.Fatalf("expected to find error (db connection config missing) but found %v", err)
		}
	})

	t.Run("fetch_db_connection_with_envVars_present", func(t *testing.T) {
		var newConfig = new(DbConfig)

		err := newConfig.getEnvVars()
		if err != nil {
			t.Fatalf("expected no error but found %v", err)
		}

		err = newConfig.createDbConnection()
		if err != nil {
			t.Fatalf("expected no error but found %v", err)
		}
	})
}

func TestCheckTablesExit(t *testing.T) {
	// drop the users and the scores tables if they exist
	t.Run("drop_all_tables", func(t *testing.T) {
		_, err := config.DbConn.Query("DROP TABLE IF EXISTS scores, users;")
		if err != nil {
			t.Fatalf("expected no error but found %v", err)
		}
	})

	t.Run("create_the_tables", func(t *testing.T) {
		err := config.CheckTablesExit()
		if err != nil {
			t.Fatalf("expected no error but found %v", err)
		}
	})
}

// TestGetEnvVars tests the functionality of getEnvVars
func TestGetEnvVars(t *testing.T) {
	config := new(DbConfig)
	expectedConfig := &DbConfig{
		dbHost:         "localhost",
		dbName:         "test-tapoo",
		dbUserName:     "admin",
		dbUserPassword: "admin",
	}

	// unsetEnvVars removes the db configurations environment variables
	unsetEnvVars := func() {
		os.Unsetenv("TAPOO_DB_NAME")
		os.Unsetenv("TAPOO_DB_USER_NAME")
		os.Unsetenv("TAPOO_DB_USER_PASSWORD")
		os.Unsetenv("TAPOO_DB_HOST")
	}

	unsetEnvVars()

	type testData struct {
		testName  string
		envKey    string
		envValue  string
		isError   bool
		expectedC *DbConfig
	}

	td := []testData{
		{
			testName:  "missing_configuration_(empty_params)",
			envKey:    "",
			envValue:  "",
			isError:   true,
			expectedC: new(DbConfig),
		},
		{
			testName:  "add_TAPOO_DB_NAME",
			envKey:    "TAPOO_DB_NAME_(1st_param)",
			envValue:  expectedConfig.dbName,
			isError:   true,
			expectedC: new(DbConfig),
		},
		{
			testName:  "add_TAPOO_DB_USER_NAME_(2nd_param)",
			envKey:    "TAPOO_DB_USER_NAME",
			envValue:  expectedConfig.dbUserName,
			isError:   true,
			expectedC: new(DbConfig),
		},
		{
			testName:  "add_TAPOO_DB_USER_PASSWORD_(3rd_param)",
			envKey:    "TAPOO_DB_USER_PASSWORD",
			envValue:  expectedConfig.dbUserPassword,
			isError:   true,
			expectedC: new(DbConfig),
		},
		{
			testName:  "add_TAPOO_DB_HOST_(4th_param)",
			envKey:    "TAPOO_DB_HOST",
			envValue:  expectedConfig.dbHost,
			isError:   false,
			expectedC: expectedConfig,
		},
	}

	for _, data := range td {
		t.Run("Test_"+data.testName, func(t *testing.T) {
			os.Setenv(data.envKey, data.envValue)

			err := config.getEnvVars()

			if (err == nil) && data.isError {
				t.Fatal("expected an error but none was returned")
			}

			if (err != nil) && !data.isError {
				t.Fatalf("expected no error but the following was returned %f", err)
			}

			if !reflect.DeepEqual(config, data.expectedC) {
				t.Fatal("the returned config did not match the expected config values")
			}
		})
	}

	// clear all the set variables.
	unsetEnvVars()
}
