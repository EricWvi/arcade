package store

import (
	"context"
	"database/sql"
	"time"
)

// Save is one of a user's saves for a game.
type Save struct {
	Name string
	Data string
	// UpdatedAt is unix seconds.
	UpdatedAt int64
}

// Saves returns a user's saves for a game, most recently written first.
func (s *Store) Saves(ctx context.Context, userID int64, game string) ([]Save, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT name, data, updated_at FROM saves WHERE user_id = ? AND game = ?
		ORDER BY updated_at DESC, name`, userID, game)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var saves []Save
	for rows.Next() {
		var sv Save
		if err := rows.Scan(&sv.Name, &sv.Data, &sv.UpdatedAt); err != nil {
			return nil, err
		}
		saves = append(saves, sv)
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
