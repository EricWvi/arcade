package store

import (
	"context"
	"database/sql"
	"time"
)

// Saves returns a user's saved data for a game, by save name.
func (s *Store) Saves(ctx context.Context, userID int64, game string) (map[string]string, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT name, data FROM saves WHERE user_id = ? AND game = ?`, userID, game)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	saves := map[string]string{}
	for rows.Next() {
		var name, data string
		if err := rows.Scan(&name, &data); err != nil {
			return nil, err
		}
		saves[name] = data
	}
	return saves, rows.Err()
}

// PutSaves writes some of a user's saves for a game in one transaction. A
// nil value deletes that save; saves not named are left alone.
func (s *Store) PutSaves(ctx context.Context, userID int64, game string, saves map[string]*string) error {
	now := time.Now().Unix()
	return s.inTx(ctx, func(tx *sql.Tx) error {
		for name, data := range saves {
			var err error
			if data == nil {
				_, err = tx.ExecContext(ctx,
					`DELETE FROM saves WHERE user_id = ? AND game = ? AND name = ?`, userID, game, name)
			} else {
				_, err = tx.ExecContext(ctx, `
					INSERT INTO saves (user_id, game, name, data, updated_at) VALUES (?, ?, ?, ?, ?)
					ON CONFLICT (user_id, game, name) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
					userID, game, name, *data, now)
			}
			if err != nil {
				return err
			}
		}
		return nil
	})
}
