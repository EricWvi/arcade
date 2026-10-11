package store

import (
	"context"
	"time"
)

// Play is one visit to a game page, as the page reports it. Counters are
// running totals for the visit; a report never lowers them.
type Play struct {
	ID   string
	Game string
	// ActiveMS counts time the page was visible and the player had touched
	// the keyboard or mouse recently; FullscreenMS is the part of it spent
	// in full screen.
	ActiveMS     int64
	FullscreenMS int64
	Keys         int64
	Clicks       int64
	SaveWrites   int64
	Muted        bool
	// Timezone is the browser's IANA zone, for "what time of day" views.
	Timezone  string
	Viewport  string
	UserAgent string
}

// activeSlack is how far active time may run ahead of the server's clock,
// to allow for the page reporting before its first report arrives.
const activeSlack = int64(time.Minute / time.Millisecond)

// RecordPlay creates or updates a play. The first report sets the start
// time; later ones move the end time while active time grows. Active time
// is capped by the time since the start, so a page cannot claim more. A
// play belongs to one user and game: reusing its id for another returns
// ErrNotFound.
//
// The update reads the reported values from the parameters, not excluded.*:
// those are the insert's values, already capped for a first report.
func (s *Store) RecordPlay(ctx context.Context, userID int64, p Play) error {
	now := time.Now().UnixMilli()
	res, err := s.db.ExecContext(ctx, `
		INSERT INTO plays (id, user_id, game, started_at, ended_at, active_ms, fullscreen_ms,
			keys, clicks, save_writes, muted, timezone, viewport, user_agent)
		VALUES (?1, ?2, ?3, ?4, ?4, MIN(?5, ?13), MIN(?6, ?5, ?13), ?7, ?8, ?9, ?10, ?11, ?12, ?14)
		ON CONFLICT (id) DO UPDATE SET
			active_ms     = MAX(active_ms, MIN(?5, ?4 - started_at + ?13)),
			ended_at      = CASE WHEN MIN(?5, ?4 - started_at + ?13) > active_ms THEN ?4 ELSE ended_at END,
			fullscreen_ms = MAX(fullscreen_ms, MIN(?6, ?5, ?4 - started_at + ?13)),
			keys          = MAX(keys, excluded.keys),
			clicks        = MAX(clicks, excluded.clicks),
			save_writes   = MAX(save_writes, excluded.save_writes),
			muted         = excluded.muted,
			viewport      = excluded.viewport
		WHERE user_id = excluded.user_id AND game = excluded.game`,
		p.ID, userID, p.Game, now, p.ActiveMS, p.FullscreenMS, p.Keys, p.Clicks, p.SaveWrites,
		p.Muted, p.Timezone, p.Viewport, activeSlack, p.UserAgent)
	if err != nil {
		return err
	}
	if n, err := res.RowsAffected(); err != nil {
		return err
	} else if n == 0 {
		return ErrNotFound
	}
	return nil
}

// RecentGame is a game a user has played, with when they last played it
// and their active time across all plays.
type RecentGame struct {
	Game         string
	LastPlayedAt int64
	ActiveMS     int64
}

// RecentGames lists the games a user has played, most recent first.
func (s *Store) RecentGames(ctx context.Context, userID int64, limit int) ([]RecentGame, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT game, MAX(ended_at) AS last, SUM(active_ms)
		FROM plays WHERE user_id = ?
		GROUP BY game ORDER BY last DESC LIMIT ?`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var games []RecentGame
	for rows.Next() {
		var g RecentGame
		if err := rows.Scan(&g.Game, &g.LastPlayedAt, &g.ActiveMS); err != nil {
			return nil, err
		}
		games = append(games, g)
	}
	return games, rows.Err()
}
