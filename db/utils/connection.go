package db

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
)

// The database connection is genarated here. If required tables do not exits
// they are automatically on db package initialization.

const errMsg = "envVars: %s environment variable is not set"

// dbConfig defines the database configuration.
type dbConfig struct {
	dbHost         string // set from  "TAPOO_DB_HOST" env value
	dbName         string // set from  "TAPOO_DB_NAME" env value
	dbUserName     string // set from  "TAPOO_DB_USER_NAME" env value
	dbUserPassword string // set from  "TAPOO_DB_USER_PASSWORD" env value

	mtx sync.Mutex
	dbConn *sql.DB
}

// Creating the dbConfig instance here guarrantees that only one db connection
// instance that can exist through a running project instance.
var config  *dbConfig

// createDbConnection creates db connection and checks if its active.
func (config *dbConfig) createDbConnection() error {
	db, err := sql.Open("mysql",
		fmt.Sprintf("%s:%s@tcp(%s)/%s?parseTime=true&loc=UTC",
			config.dbUserName, config.dbUserPassword, config.dbHost, config.dbName))
	if err != nil {
		return err
	}

	if err = db.Ping(); err != nil {
		return fmt.Errorf("db connection error: %s", err.Error())
	}

	return nil
}

// CheckTablesExit checks if the users and scores tables exists in the db 
// otherwise they are created.
func (config *dbConfig) CheckTablesExit() error {
	var result string

	queries := map[string]string{ 
		"users": CreateUsersTable, 
		"scores": CreateScoresTable,
	}

	// Table users should always be created before table scores.
	for _, t := range []string{ "users", "scores" } {
		err := config.dbConn.QueryRow(CheckTableExist, config.dbName, t).Scan(&result)
		if err == nil {
			continue
		}

		if strings.Contains(err.Error(), "no rows in result set") {
			_, err = config.dbConn.Query(queries[t])
		}

		if err != nil {
			return err
		}

		fmt.Printf("Table '%s' successfully created \n", t)
	}

	return nil
}

// getEnvVars fetches the database configuration from the set environment variables.
// An error message is returned if any of the environment is found missing.
func (config *dbConfig) getEnvVars() error {
	var ok bool
	var dbName, dbUserName, dbUserPassword, dbHost string

	if dbName, ok = os.LookupEnv("TAPOO_DB_NAME"); !ok {
		return fmt.Errorf(errMsg, "TAPOO_DB_NAME")
	}

	if dbUserName, ok = os.LookupEnv("TAPOO_DB_USER_NAME"); !ok {
		return fmt.Errorf(errMsg, "TAPOO_DB_USER_NAME")
	}

	if dbUserPassword, ok = os.LookupEnv("TAPOO_DB_USER_PASSWORD"); !ok {
		return fmt.Errorf(errMsg, "TAPOO_DB_USER_PASSWORD")
	}

	if dbHost, ok = os.LookupEnv("TAPOO_DB_HOST"); !ok {
		return fmt.Errorf(errMsg, "TAPOO_DB_HOST")
	}

	config.dbName = dbName
	config.dbUserName = dbUserName
	config.dbUserPassword = dbUserPassword
	config.dbHost = dbHost

	return nil
}

// setUpDB creates the tables if they don't exits provided the db connection exists.
// If the db does not the exist yet, the function should exit with an error.
func setUpDB() error {
	config = new(dbConfig)
	if err := config.getEnvVars(); err != nil {
		return err
	}

	if err := config.createDbConnection(); err != nil {
		return err
	} 

	if err := config.CheckTablesExit(); err != nil {
		return err
	}

	return nil
}

// This init function should run when the db packages is initialized.
func init() {
	if err := setUpDB(); err != nil {
		log.Fatal(err)
	}
}

// GetDBConfig returns the active db connection instance.
func GetDBConfig() *sql.DB {
	config.mtx.Lock()
	defer config.mtx.Unlock()
	return config.dbConn
}
