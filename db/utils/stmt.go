package db

// Lists all the sql statements to be executed.

const (
	// MAX_EMAIL_LENGTH defines the maximum number of characters that can make up
	// an email.
	MAX_EMAIL_LENGTH = 64

	// MAX_TAPOO_ID_LENGTH defines the maximum number of characters that can make
	// up a username/tapoo ID.
	MAX_TAPOO_ID_LENGTH = 20

	// CheckTableExist checks the tables that exists in the current db.
	CheckTableExist = `
		SELECT TABLE_NAME FROM information_schema.tables 
		WHERE table_schema = ?
		AND table_name = ?
		LIMIT 1;`

	// CreateUsersTable creates the users table if it doesn't exists.
	CreateUsersTable = `
		CREATE TABLE IF NOT EXISTS users (
			id VARCHAR(` + MAX_TAPOO_ID_LENGTH + `) NOT NULL, 
			email VARCHAR(` + MAX_EMAIL_LENGTH + `) NULL, 
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, 
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, 
			PRIMARY KEY(uuid), 
			UNIQUE KEY(id), 
			KEY(email)
		)
		ENGINE=InnoDB DEFAULT CHARSET=latin1;`

	// CreateScoresTable creates the scores table if it doesn't exists.
	CreateScoresTable = `
		CREATE TABLE IF NOT EXISTS scores (
			uuid CHAR(36) NOT NULL,
			user_id VARCHAR(` + MAX_TAPOO_ID_LENGTH + `) NOT NULL, 
			game_level INT  DEFAULT 0,
			level_scores INT DEFAULT 0,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY(uuid), 
			FOREIGN KEY(user_id) REFERENCES users(id),
			KEY(game_level),
			KEY(level_scores),
			UNIQUE(user_id, game_level) 
		)
		ENGINE=InnoDB DEFAULT CHARSET=latin1;`
	
	InsertUsers = `INSERT INTO users (id, email) VALUES (?, ?, ?);`

	SelectUserByID = `SELECT id, email, created_at, updated_at FROM users WHERE id = ?;`

	UpdateUserEmailByID = `UPDATE users SET email = ? WHERE id = ?;`

	InsertScores = `INSERT INTO scores (user_id, game_level) VALUES (?, ?);`

	SelectScoresByUserIDAndLevel = `SELECT user_id, game_level, level_scores, created_at, updated_at` +
	` FROM scores WHERE user_id = ? and game_level = ?;`

	SelectTopTenScores = `SELECT s.user_id, u.email, s.game_level, s.level_scores,` +
	`s.created_at, s.updated_at, FROM scores s, users u WHERE s.game_level = ? ` +
	`and s.user_id = u.id ORDER BY s.level_scores DESC LIMIT 10;`

	UpdateScoresByUserIDAndLevel = `UPDATE scores SET level_scores = ? WHERE user_id = ? and game_level = ?;`
)
