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
	h, _ := newServerWith(t, cfg)
	return h
}

func newServerWithGames(t *testing.T) (http.Handler, string) {
	t.Helper()
	return newServerWith(t, auth.Config{DevUser: "eric"})
}

// newServerWith also returns the games directory, so tests can change files.
func newServerWith(t *testing.T, cfg auth.Config) (http.Handler, string) {
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
		"zmxy-1/imgs/card.png":        "png",
		"zmxy-1/imgs/card.blur.webp":  "webp",
		"zmxy-1/imgs/notes.txt":       "secret",
		"zmxy-1/sources/game.swf":     swfHeader,
		"zmxy-1/sources/levels/1.swf": "level",
		"zmxy-1/sources/page.html":    "<script>",
		"secret.swf":                  "secret",
	} {
		path := filepath.Join(games, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(data), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Symlink(filepath.Join(games, "secret.swf"), filepath.Join(games, "zmxy-1/sources/link.swf")); err != nil {
		t.Fatal(err)
	}
	cat := catalog.Catalog{
		Shelves: []catalog.Shelf{
			{ID: "zmxy", Title: "造梦西游系列", Games: []string{"zmxy-1"}},
			{ID: "nitrome", Title: "Nitrome", Games: []string{"hot-air-1"}},
		},
		Games: map[string]catalog.Game{
			"zmxy-1":    {Title: "造梦西游", Subtitle: "动作冒险", SWF: "game.swf"},
			"hot-air-1": {Title: "Hot Air", SWF: "missing.swf"},
		},
	}
	h, err := New(auth.New(st, cfg), web, Options{Version: "test", GamesDir: games, Catalog: cat, Store: st})
	if err != nil {
		t.Fatal(err)
	}
	return h, games
}

// swfHeader is an uncompressed movie header with a 550x400 stage.
const swfHeader = "FWS\x08\x00\x00\x00\x00\x78\x00\x05\x5f\x00\x00\x0f\xa0\x00\x00\x0c\x01\x00"

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
	if rec := do(h, "GET", "/games/zmxy-1/imgs/card.blur.webp?v=1"); rec.Code != 200 || rec.Body.String() != "webp" ||
		rec.Header().Get("Cache-Control") != "private, max-age=31536000, immutable" {
		t.Fatalf("versioned placeholder: %d %q %s", rec.Code, rec.Body, rec.Header())
	}
	for _, path := range []string{
		"/games/zmxy-1/imgs/notes.txt",
		"/games/zmxy-1/imgs/missing.png",
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

func TestGameSources(t *testing.T) {
	h := newServer(t, auth.Config{DevUser: "eric"})
	rec := do(h, "GET", "/games/zmxy-1/sources/game.swf?v=1")
	if rec.Code != 200 || rec.Body.String() != swfHeader ||
		rec.Header().Get("Content-Type") != "application/x-shockwave-flash" ||
		rec.Header().Get("Cache-Control") != "private, max-age=31536000, immutable" {
		t.Fatalf("movie: %d %q %s", rec.Code, rec.Body, rec.Header())
	}
	// Files the movie loads itself come without a version.
	if rec := do(h, "GET", "/games/zmxy-1/sources/levels/1.swf"); rec.Code != 200 || rec.Body.String() != "level" ||
		rec.Header().Get("Cache-Control") != "private, no-cache" {
		t.Fatalf("level: %d %q %s", rec.Code, rec.Body, rec.Header())
	}
	for _, path := range []string{
		"/games/zmxy-1/sources/page.html",
		"/games/zmxy-1/sources/link.swf",
		"/games/zmxy-1/sources/missing.swf",
		"/games/zmxy-1/sources/levels",
		"/games/zmxy-1/sources/..%2F..%2Fsecret.swf",
		"/games/..%2Fsecret.swf/sources/x.swf",
	} {
		if rec := do(h, "GET", path); rec.Code != 404 {
			t.Errorf("%s: %d %q", path, rec.Code, rec.Body)
		}
	}
	if rec := do(newServer(t, auth.Config{}), "GET", "/games/zmxy-1/sources/game.swf"); rec.Code == 200 {
		t.Fatalf("without a session: %d", rec.Code)
	}
}

func TestCatalogKeepsOrderAndListsImagesOnDisk(t *testing.T) {
	h, games := newServerWithGames(t)
	catalog := func() catalogResponse {
		t.Helper()
		rec := do(h, "GET", "/api/catalog")
		if rec.Code != 200 {
			t.Fatalf("catalog: %d %s", rec.Code, rec.Body)
		}
		var got catalogResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		return got
	}
	got := catalog()
	version := got.Shelves[0].Games[0].Images["card"]
	if version == "" || got.Shelves[0].Games[0].SWF == nil || got.Shelves[0].Games[0].SWF.Version == "" {
		t.Fatalf("no card version: %+v", got)
	}
	want := catalogResponse{Shelves: []catalogShelf{
		{ID: "zmxy", Title: "造梦西游系列", Games: []catalogGame{
			{ID: "zmxy-1", Title: "造梦西游", Subtitle: "动作冒险", Images: map[string]string{"card": version},
				SWF: &catalogSWF{File: "game.swf", Version: got.Shelves[0].Games[0].SWF.Version, Width: 550, Height: 400}},
		}},
		{ID: "nitrome", Title: "Nitrome", Games: []catalogGame{
			{ID: "hot-air-1", Title: "Hot Air", Images: map[string]string{}},
		}},
	}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}

	// Replacing either the image or its placeholder gives a new version.
	for _, name := range []string{"card.png", "card.blur.webp"} {
		path := filepath.Join(games, "zmxy-1", "imgs", name)
		if err := os.WriteFile(path, []byte("replaced "+name), 0o644); err != nil {
			t.Fatal(err)
		}
		next := catalog().Shelves[0].Games[0].Images["card"]
		if next == version {
			t.Fatalf("version unchanged after replacing %s", name)
		}
		version = next
	}
}

func TestSaves(t *testing.T) {
	h := newServer(t, auth.Config{DevUser: "eric"})
	put := func(path, body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("PUT", path, strings.NewReader(body)))
		return rec
	}
	saves := func() map[string]map[string]string {
		t.Helper()
		rec := do(h, "GET", "/api/games/zmxy-1/saves")
		var got map[string]map[string]string
		if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &got) != nil {
			t.Fatalf("saves: %d %s", rec.Code, rec.Body)
		}
		return got
	}
	if got := saves(); !reflect.DeepEqual(got, map[string]map[string]string{"saves": {}}) {
		t.Fatalf("empty saves = %v", got)
	}
	if rec := put("/api/games/zmxy-1/saves", `{"saves":{"levels":"AL8A","stars":"AL8B"}}`); rec.Code != 204 {
		t.Fatalf("put: %d %s", rec.Code, rec.Body)
	}
	if rec := put("/api/games/zmxy-1/saves", `{"saves":{"stars":null,"levels":"AL8C"}}`); rec.Code != 204 {
		t.Fatalf("put with delete: %d %s", rec.Code, rec.Body)
	}
	if got := saves()["saves"]; !reflect.DeepEqual(got, map[string]string{"levels": "AL8C"}) {
		t.Fatalf("saves = %v", got)
	}

	for body, code := range map[string]int{
		`{"saves":{}}`:           400,
		`not json`:               400,
		`{"saves":{"a\nb":"x"}}`: 400,
		`{"saves":{"big":"` + strings.Repeat("x", maxSaveData+1) + `"}}`: 413,
	} {
		if rec := put("/api/games/zmxy-1/saves", body); rec.Code != code {
			t.Errorf("put %.40s: %d, want %d", body, rec.Code, code)
		}
	}
	if rec := put("/api/games/unknown/saves", `{"saves":{"a":"b"}}`); rec.Code != 404 {
		t.Errorf("unknown game: %d", rec.Code)
	}
}

func TestPlays(t *testing.T) {
	h := newServer(t, auth.Config{DevUser: "eric"})
	put := func(id, body string) int {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("PUT", "/api/plays/"+id, strings.NewReader(body)))
		return rec.Code
	}
	recent := func() []recentGame {
		t.Helper()
		rec := do(h, "GET", "/api/plays/recent")
		var got struct{ Games []recentGame }
		if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &got) != nil {
			t.Fatalf("recent: %d %s", rec.Code, rec.Body)
		}
		return got.Games
	}
	if got := recent(); len(got) != 0 {
		t.Fatalf("recent before playing = %+v", got)
	}

	const id = "0b6f2c1e-9a4d-4c3b-8e2f-1a2b3c4d5e6f"
	if code := put(id, `{"game":"zmxy-1","activeMs":1500,"keys":3,"timezone":"Asia/Shanghai","viewport":"1440x900"}`); code != 204 {
		t.Fatalf("put: %d", code)
	}
	got := recent()
	if len(got) != 1 || got[0].ID != "zmxy-1" || got[0].Title != "造梦西游" || got[0].PlayedMS != 1500 ||
		got[0].LastPlayedAt == 0 || got[0].SWF == nil {
		t.Fatalf("recent = %+v", got)
	}

	for body, code := range map[string]int{
		`{"game":"zmxy-1","activeMs":-1}`:    400,
		`{"game":"zmxy-1","viewport":"big"}`: 400,
		`not json`:                           400,
		`{"game":"unknown"}`:                 404,
		`{"game":"hot-air-1","activeMs":10}`: 409,
	} {
		if got := put(id, body); got != code {
			t.Errorf("put %s: %d, want %d", body, got, code)
		}
	}
	if code := put("not-a-uuid", `{"game":"zmxy-1"}`); code != 400 {
		t.Errorf("bad id: %d", code)
	}
}
