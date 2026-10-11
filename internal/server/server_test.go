package server

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"arcade/internal/auth"
	"arcade/internal/store"
)

func newServer(t *testing.T, cfg auth.Config) http.Handler {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "arcade.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	web := fstest.MapFS{
		"index.html":          {Data: []byte("<!doctype html>app")},
		"assets/index-abc.js": {Data: []byte("console.log(1)")},
	}
	h, err := New(auth.New(st, cfg), web, Options{Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	return h
}

func do(h http.Handler, method, path string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(method, path, nil))
	return rec
}

func TestAPIAndShell(t *testing.T) {
	h := newServer(t, auth.Config{DevUser: "eric"})
	if rec := do(h, "GET", "/api/me"); rec.Code != 200 || !strings.Contains(rec.Body.String(), "eric") {
		t.Fatalf("me: %d %s", rec.Code, rec.Body)
	}
	if rec := do(h, "GET", "/api/nope"); rec.Code != 404 {
		t.Fatalf("unknown api: %d", rec.Code)
	}
	if rec := do(h, "GET", "/games/1"); rec.Code != 200 || !strings.Contains(rec.Body.String(), "app") ||
		rec.Header().Get("Cache-Control") != "no-cache" {
		t.Fatalf("shell: %d %s", rec.Code, rec.Header())
	}
	if rec := do(h, "GET", "/assets/index-abc.js"); rec.Code != 200 ||
		!strings.Contains(rec.Header().Get("Cache-Control"), "immutable") {
		t.Fatalf("asset: %d %s", rec.Code, rec.Header())
	}
	if rec := do(h, "GET", "/assets/missing.js"); rec.Code != 404 {
		t.Fatalf("missing asset: %d", rec.Code)
	}
}

func TestAPIRequiresSession(t *testing.T) {
	h := newServer(t, auth.Config{PublicURL: "https://arcade.test", Issuer: "https://idp.invalid", ClientID: "x", ClientSecret: "y"})
	if rec := do(h, "GET", "/api/me"); rec.Code != http.StatusUnauthorized {
		t.Fatalf("me without session: %d", rec.Code)
	}
	if rec := do(h, "GET", "/api/version"); rec.Code != 200 || !strings.Contains(rec.Body.String(), "test") {
		t.Fatalf("version: %d %s", rec.Code, rec.Body)
	}
	if rec := do(h, "GET", "/"); rec.Code != 200 {
		t.Fatalf("shell without session: %d", rec.Code)
	}
}
