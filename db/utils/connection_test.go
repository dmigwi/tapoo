package db

import (
	"os"
	"testing"
	"strconv"
	"reflect"
)

// TestGetEnvVars tests the functionality of getEnvVars
func TestGetEnvVars(t *testing.T) {
	config := new(dbConfig)
	expectedConfig := &dbConfig {
		dbHost: "localhost",
		dbName: "tapoo",
		dbUserName: "admin",
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
		envKey string
		envValue string
		isError bool
		expectedC *dbConfig
	}

	td := []testData {
		{
			envKey: "",
			envValue: "",
			isError: true,
			expectedC: new(dbConfig),
		},
		{
			envKey: "TAPOO_DB_NAME",
			envValue: expectedConfig.dbName,
			isError: true,
			expectedC: new(dbConfig),
		},
		{
			envKey: "TAPOO_DB_USER_NAME",
			envValue: expectedConfig.dbUserName,
			isError: true,
			expectedC: new(dbConfig),
		},
		{
			envKey: "TAPOO_DB_USER_PASSWORD",
			envValue: expectedConfig.dbUserPassword,
			isError: true,
			expectedC: new(dbConfig),
		},
		{
			envKey: "TAPOO_DB_HOST",
			envValue: expectedConfig.dbHost,
			isError: false,
			expectedC: expectedConfig,
		},
	}

	for i, data := range td {
		t.Run("Test_"+strconv.Itoa(i), func(t *testing.T) {
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
