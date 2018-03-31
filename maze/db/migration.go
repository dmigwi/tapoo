package db

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	// used by the database/sql package
	_ "github.com/go-sql-driver/mysql"
)

// migrations defines the location of the migration scripts
const (
	errMsg = "environment variable is not set"

	checkTableExist = `SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = ? AND table_name = ? LIMIT 1;`

	createUsersTable = `CREATE TABLE users (uuid CHAR(36) NOT NULL, id VARCHAR(64) NOT NULL, email VARCHAR(256) NULL, ` +
		`created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT  CURRENT_TIMESTAMP ON ` +
		`UPDATE CURRENT_TIMESTAMP, PRIMARY KEY(uuid), KEY (id), KEY (email) )ENGINE=InnoDB DEFAULT CHARSET=latin1;`

	createScoresTable = `CREATE TABLE scores (uuid CHAR(36) NOT NULL, user_id VARCHAR(64) NOT NULL, game_level INT NOT ` +
		`NULL, high_scores INT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP ` +
		`DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY(uuid), FOREIGN KEY(user_id) REFERENCES ` +
		`users(id), KEY(game_level), KEY(high_scores) )ENGINE=InnoDB DEFAULT CHARSET=latin1;`
)

// Db defines a database connection pool that is safe concurrency use.
var Db *sql.DB

// The following variabls defines the database configuration that is mapped from
// TAPOO_DB_NAME, TAPOO_DB_USER_NAME, TAPOO_DB_USER_PASSWORD and TAPOO_DB_HOST.
type dbConfig struct {
	DbHost         string
	DbName         string
	DbUserName     string
	DbUserPassword string
	Driver         string
}

var config = new(dbConfig)

// createDbConnection creates a pool of connection that can be used concurrently
// to access the database.
func createDbConnection() error {
	var err error
	Db, err = sql.Open(config.Driver,
		fmt.Sprintf("%s:%s@tcp(%s)/%s?parseTime=true", config.DbUserName, config.DbUserPassword, config.DbHost, config.DbName))
	if err != nil {
		return err
	}

	if err = Db.Ping(); err != nil {
		return fmt.Errorf("db connection: incorrect database configurations used :: %s", err.Error())
	}

	Db.SetConnMaxLifetime(time.Duration(10) * time.Second)

	return nil
}

// checkTablesExit checks if the users and the score tables exists in the selected database.
// If they don't exist they are created.
func checkTablesExit() error {
	var result string

	// maps cannot guarantee a specific order of retrival thus two slices are used.
	// Table users should always be created before table scores.
	queries := []string{createUsersTable, createScoresTable}

	for i, t := range []string{"users", "scores"} {
		err := Db.QueryRow(checkTableExist, config.DbName, t).Scan(&result)
		if err == nil {
			continue
		}

		if strings.Contains(err.Error(), "no rows in result set") {
			_, err = Db.Query(queries[i])
		}

		if err != nil {
			return err
		}

		fmt.Printf("Table '%s' successfully created \n", t)
	}

	return nil
}

// getEnvVars fetch the database configuration from the set environment variables set.
// An error message is returned if any of the environment id found missing.
func getEnvVars() error {
	ok := false

	if config.DbName, ok = os.LookupEnv("TAPOO_DB_NAME"); !ok {
		return fmt.Errorf("envVars: TAPOO_DB_NAME %s", errMsg)
	}

	if config.DbUserName, ok = os.LookupEnv("TAPOO_DB_USER_NAME"); !ok {
		return fmt.Errorf("envVars: TAPOO_DB_USER_NAME %s", errMsg)
	}

	if config.DbUserPassword, ok = os.LookupEnv("TAPOO_DB_USER_PASSWORD"); !ok {
		return fmt.Errorf("envVars: TAPOO_DB_USER_PASSWORD %s", errMsg)
	}

	if config.DbHost, ok = os.LookupEnv("TAPOO_DB_HOST"); !ok {
		return fmt.Errorf("envVars: TAPOO_DB_HOST %s", errMsg)
	}

	// set the driver to mysql's go-sql-driver/mysql
	config.Driver = "mysql"

	return nil
}

// This init function should run when the db packages is initialized
// It should recreate the tables if they don't exits provided the db exists.
// If the db does not the exist yet the function should exit with an error.
func init() {
	withErrorExit := func(err error) {
		if err != nil {
			log.Fatal(err)
		}
	}

	withErrorExit(getEnvVars())

	withErrorExit(createDbConnection())

	withErrorExit(checkTablesExit())
}
