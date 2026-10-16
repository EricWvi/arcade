package store

import (
	"database/sql"
	"fmt"
)

// A migration runs inside its own transaction.
type migration func(tx *sql.Tx) error

func execSQL(query string) migration {
	return func(tx *sql.Tx) error {
		_, err := tx.Exec(query)
		return err
	}
}

// migrations are applied in order; PRAGMA user_version records progress.
// Never edit a released migration, append a new one instead.
var migrations = []migration{
	execSQL(`
	CREATE TABLE users (
		id         INTEGER PRIMARY KEY,
		issuer     TEXT NOT NULL,
		subject    TEXT NOT NULL,
		name       TEXT NOT NULL DEFAULT '',
		email      TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
		UNIQUE (issuer, subject)
	);

	-- Sessions never expire; a row lives until the user signs out.
	CREATE TABLE sessions (
		token_hash   TEXT    PRIMARY KEY,
		user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
		created_at   INTEGER NOT NULL,
		last_seen_at INTEGER NOT NULL
	);
	CREATE INDEX sessions_user ON sessions (user_id);
	`),
	execSQL(`
	-- A game's saved data per user, by save name. Data is opaque to the
	-- server; for Flash games it is a base64 SharedObject from Ruffle.
	CREATE TABLE saves (
		user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
		game       TEXT    NOT NULL,
		name       TEXT    NOT NULL,
		data       TEXT    NOT NULL,
		updated_at INTEGER NOT NULL,
		PRIMARY KEY (user_id, game, name)
	) WITHOUT ROWID;
	`),
	execSQL(`
	-- One row per visit to a game page. The page reports running totals,
	-- so the latest report wins. Times are server unix milliseconds;
	-- ended_at moves only while the player is active, so a forgotten tab
	-- does not stretch a play.
	CREATE TABLE plays (
		id            TEXT    PRIMARY KEY,
		user_id       INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
		game          TEXT    NOT NULL,
		started_at    INTEGER NOT NULL,
		ended_at      INTEGER NOT NULL,
		active_ms     INTEGER NOT NULL DEFAULT 0,
		fullscreen_ms INTEGER NOT NULL DEFAULT 0,
		keys          INTEGER NOT NULL DEFAULT 0,
		clicks        INTEGER NOT NULL DEFAULT 0,
		save_writes   INTEGER NOT NULL DEFAULT 0,
		muted         INTEGER NOT NULL DEFAULT 0,
		timezone      TEXT    NOT NULL DEFAULT '',
		viewport      TEXT    NOT NULL DEFAULT '',
		user_agent    TEXT    NOT NULL DEFAULT ''
	);
	CREATE INDEX plays_user_ended ON plays (user_id, ended_at);
	`),
	execSQL(`
	-- 造梦西游's saves moved into six slots named "<slot>/<title>"
	-- (frontend/src/lib/save-slots.ts). Saves from before go into slots
	-- 1, 2, … newest first, keeping their titles and times.
	UPDATE saves SET name = r.slot || '/' || saves.name
	FROM (
		SELECT user_id, game, name,
		       ROW_NUMBER() OVER (PARTITION BY user_id, game ORDER BY updated_at DESC, name) AS slot
		FROM saves
		WHERE game IN ('zmxy-1', 'zmxy-2') AND name NOT GLOB '[1-6]/*'
	) AS r
	WHERE r.user_id = saves.user_id AND r.game = saves.game AND r.name = saves.name;
	`),
}

func migrate(db *sql.DB) error {
	var version int
	if err := db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		return fmt.Errorf("read schema version: %w", err)
	}
	for i := version; i < len(migrations); i++ {
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		if err := migrations[i](tx); err != nil {
			tx.Rollback()
			return fmt.Errorf("migration %d: %w", i+1, err)
		}
		if _, err := tx.Exec(fmt.Sprintf(`PRAGMA user_version = %d`, i+1)); err != nil {
			tx.Rollback()
			return fmt.Errorf("migration %d: %w", i+1, err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("migration %d: %w", i+1, err)
		}
	}
	return nil
}
