package store

import (
	"context"
	"errors"
	"path/filepath"
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
