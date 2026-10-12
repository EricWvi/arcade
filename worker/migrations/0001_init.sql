-- The schema of internal/store/migrate.go, which the homelab server applies
-- to SQLite. Users here sign in with GitHub: issuer "https://github.com",
-- subject the numeric GitHub user id.

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
