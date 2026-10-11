package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"testing/fstest"

	"arcade/internal/auth"
	"arcade/internal/catalog"
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
	games := filepath.Join(t.TempDir(), "games")
	for name, data := range map[string]string{
		"zmxy-1/imgs/card.png":       "png",
		"zmxy-1/imgs/card.blur.webp": "webp",
		"zmxy-1/imgs/notes.txt":      "secret",
		"zmxy-1/sources/game.swf":    "swf",
	} {
		path := filepath.Join(games, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(data), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	cat := catalog.Catalog{
		Shelves: []catalog.Shelf{
			{ID: "zmxy", Title: "造梦西游系列", Games: []string{"zmxy-1"}},
			{ID: "nitrome", Title: "Nitrome", Games: []string{"hot-air-1"}},
		},
		Games: map[string]catalog.Game{
			"zmxy-1":    {Title: "造梦西游", Subtitle: "动作冒险"},
			"hot-air-1": {Title: "Hot Air"},
		},
	}
	h, err := New(auth.New(st, cfg), web, Options{Version: "test", GamesDir: games, Catalog: cat})
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
	if rec := do(h, "GET", "/games/zmxy-1/imgs/card.png"); rec.Code != http.StatusUnauthorized {
		t.Fatalf("image without session: %d", rec.Code)
	}
	if rec := do(h, "GET", "/api/catalog"); rec.Code != http.StatusUnauthorized {
		t.Fatalf("catalog without session: %d", rec.Code)
	}
}

func TestGameImages(t *testing.T) {
	h := newServer(t, auth.Config{DevUser: "eric"})
	rec := do(h, "GET", "/games/zmxy-1/imgs/card.png")
	if rec.Code != 200 || rec.Body.String() != "png" || rec.Header().Get("Content-Type") != "image/png" ||
		rec.Header().Get("Cache-Control") != "private, no-cache" {
		t.Fatalf("card: %d %q %s", rec.Code, rec.Body, rec.Header())
	}
	if rec := do(h, "GET", "/games/zmxy-1/imgs/card.blur.webp"); rec.Code != 200 || rec.Body.String() != "webp" {
		t.Fatalf("placeholder: %d %q", rec.Code, rec.Body)
	}
	for _, path := range []string{
		"/games/zmxy-1/imgs/notes.txt",
		"/games/zmxy-1/imgs/missing.png",
		"/games/zmxy-1/sources/game.swf",
		"/games/..%2Fzmxy-1/imgs/card.png",
		"/games/zmxy-1/imgs/..%2F..%2Fzmxy-1%2Fimgs%2Fcard.png",
	} {
		if rec := do(h, "GET", path); rec.Code != 404 {
			t.Errorf("%s: %d %q", path, rec.Code, rec.Body)
		}
	}
	// The game page itself is an app route.
	if rec := do(h, "GET", "/games/zmxy-1"); rec.Code != 200 || !strings.Contains(rec.Body.String(), "app") {
		t.Fatalf("game page: %d", rec.Code)
	}
}

func TestCatalogKeepsOrderAndListsImagesOnDisk(t *testing.T) {
	h := newServer(t, auth.Config{DevUser: "eric"})
	rec := do(h, "GET", "/api/catalog")
	if rec.Code != 200 {
		t.Fatalf("catalog: %d %s", rec.Code, rec.Body)
	}
	var got catalogResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	want := catalogResponse{Shelves: []catalogShelf{
		{ID: "zmxy", Title: "造梦西游系列", Games: []catalogGame{
			{ID: "zmxy-1", Title: "造梦西游", Subtitle: "动作冒险", Images: []string{"card"}},
		}},
		{ID: "nitrome", Title: "Nitrome", Games: []catalogGame{
			{ID: "hot-air-1", Title: "Hot Air", Images: []string{}},
		}},
	}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}
