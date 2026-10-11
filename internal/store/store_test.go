package store

import (
	"context"
	"errors"
	"path/filepath"
	"reflect"
	"testing"
)

func openTest(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "db", "arcade.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestUpsertUserKeepsIdentityAndRefreshesProfile(t *testing.T) {
	s := openTest(t)
	ctx := context.Background()
	first, err := s.UpsertUser(ctx, Identity{Issuer: "i", Subject: "s", Name: "Old", Email: "old@x"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.UpsertUser(ctx, Identity{Issuer: "i", Subject: "s", Name: "New", Email: "new@x"})
	if err != nil {
		t.Fatal(err)
	}
	if second != (User{ID: first.ID, Name: "New", Email: "new@x"}) {
		t.Fatalf("second = %+v, first = %+v", second, first)
	}
	other, _ := s.UpsertUser(ctx, Identity{Issuer: "other", Subject: "s"})
	if other.ID == first.ID {
		t.Fatal("same subject from another issuer must be another user")
	}
	if _, err := s.UpsertUser(ctx, Identity{Issuer: "i"}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("err = %v, want ErrInvalid", err)
	}
}

func TestSessionsLastUntilDeleted(t *testing.T) {
	s := openTest(t)
	ctx := context.Background()
	u, err := s.UpsertUser(ctx, Identity{Issuer: "https://idp.test", Subject: "alice"})
	if err != nil {
		t.Fatal(err)
	}
	token, err := s.CreateSession(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	got, _, err := s.SessionUser(ctx, token)
	if err != nil || got.ID != u.ID {
		t.Fatalf("user = %+v, err = %v", got, err)
	}
	if err := s.TouchSession(ctx, token); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteSession(ctx, token); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.SessionUser(ctx, token); !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

func TestReopenKeepsData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "arcade.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	u, _ := s.UpsertUser(ctx, Identity{Issuer: "i", Subject: "s"})
	token, _ := s.CreateSession(ctx, u.ID)
	s.Close()
	if s, err = Open(path); err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if got, _, err := s.SessionUser(ctx, token); err != nil || got.ID != u.ID {
		t.Fatalf("after reopen: user = %+v, err = %v", got, err)
	}
}

func TestSavesArePerUserAndGame(t *testing.T) {
	s := openTest(t)
	ctx := context.Background()
	alice, _ := s.UpsertUser(ctx, Identity{Issuer: "i", Subject: "alice"})
	bob, _ := s.UpsertUser(ctx, Identity{Issuer: "i", Subject: "bob"})
	str := func(v string) *string { return &v }

	if err := s.PutSaves(ctx, alice.ID, "hot-air-1", map[string]*string{"levels": str("1"), "stars": str("2")}); err != nil {
		t.Fatal(err)
	}
	if err := s.PutSaves(ctx, bob.ID, "hot-air-1", map[string]*string{"levels": str("bob")}); err != nil {
		t.Fatal(err)
	}
	// Overwrites one, deletes one, keeps the rest.
	if err := s.PutSaves(ctx, alice.ID, "hot-air-1", map[string]*string{"levels": str("3"), "stars": nil, "time": str("4")}); err != nil {
		t.Fatal(err)
	}
	data := func(saves []Save) map[string]string {
		m := map[string]string{}
		for _, sv := range saves {
			if sv.UpdatedAt == 0 {
				t.Errorf("save %q has no update time", sv.Name)
			}
			m[sv.Name] = sv.Data
		}
		return m
	}
	got, err := s.Saves(ctx, alice.ID, "hot-air-1")
	if err != nil || !reflect.DeepEqual(data(got), map[string]string{"levels": "3", "time": "4"}) {
		t.Fatalf("alice = %v, %v", got, err)
	}
	if got, _ := s.Saves(ctx, bob.ID, "hot-air-1"); !reflect.DeepEqual(data(got), map[string]string{"levels": "bob"}) {
		t.Fatalf("bob = %v", got)
	}
	if got, _ := s.Saves(ctx, alice.ID, "zmxy-1"); len(got) != 0 {
		t.Fatalf("other game = %v", got)
	}
}

func TestRecordPlayKeepsRunningTotals(t *testing.T) {
	s := openTest(t)
	ctx := context.Background()
	alice, _ := s.UpsertUser(ctx, Identity{Issuer: "i", Subject: "alice"})
	bob, _ := s.UpsertUser(ctx, Identity{Issuer: "i", Subject: "bob"})
	play := func(userID int64, p Play) error { return s.RecordPlay(ctx, userID, p) }
	read := func(id string) (started, ended, active, fullscreen, keys int64) {
		t.Helper()
		err := s.db.QueryRow(`SELECT started_at, ended_at, active_ms, fullscreen_ms, keys FROM plays WHERE id = ?`, id).
			Scan(&started, &ended, &active, &fullscreen, &keys)
		if err != nil {
			t.Fatal(err)
		}
		return
	}

	// A first report may not claim more than a minute of play.
	if err := play(alice.ID, Play{ID: "p1", Game: "hot-air-1", ActiveMS: 3_600_000, FullscreenMS: 9_000_000, Keys: 5}); err != nil {
		t.Fatal(err)
	}
	started, ended, active, fullscreen, keys := read("p1")
	if started != ended || active != activeSlack || fullscreen != activeSlack || keys != 5 {
		t.Fatalf("first report: %d %d %d %d %d", started, ended, active, fullscreen, keys)
	}
	// A late, smaller report changes nothing; counters never go down.
	if err := play(alice.ID, Play{ID: "p1", Game: "hot-air-1", ActiveMS: 10, Keys: 1}); err != nil {
		t.Fatal(err)
	}
	if _, e, a, _, k := read("p1"); e != ended || a != activeSlack || k != 5 {
		t.Fatalf("stale report: ended %d active %d keys %d", e, a, k)
	}
	// The id belongs to alice and this game.
	if err := play(bob.ID, Play{ID: "p1", Game: "hot-air-1"}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other user: %v", err)
	}
	if err := play(alice.ID, Play{ID: "p1", Game: "zmxy-1"}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other game: %v", err)
	}

	if err := play(alice.ID, Play{ID: "p2", Game: "zmxy-1", ActiveMS: 1000}); err != nil {
		t.Fatal(err)
	}
	if err := play(alice.ID, Play{ID: "p3", Game: "hot-air-1", ActiveMS: 2000}); err != nil {
		t.Fatal(err)
	}
	// Make p3 clearly the latest.
	s.db.Exec(`UPDATE plays SET ended_at = ended_at + 5000 WHERE id = 'p3'`)
	recent, err := s.RecentGames(ctx, alice.ID, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(recent) != 2 || recent[0].Game != "hot-air-1" || recent[0].ActiveMS != activeSlack+2000 || recent[1].Game != "zmxy-1" {
		t.Fatalf("recent = %+v", recent)
	}
	if recent, _ := s.RecentGames(ctx, bob.ID, 10); len(recent) != 0 {
		t.Fatalf("bob recent = %+v", recent)
	}
}
