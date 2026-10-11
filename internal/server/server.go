// Package server exposes the JSON API and serves the embedded frontend.
package server

import (
	"encoding/json"
	"io/fs"
	"net/http"

	"arcade/internal/auth"
	"arcade/internal/catalog"
	"arcade/internal/store"
)

// Options configures the server.
type Options struct {
	Version string
	// GamesDir holds one directory per game key; see getGameImage.
	GamesDir string
	// Catalog is games.yaml, served by GET /api/catalog.
	Catalog catalog.Catalog
	// Store holds each user's game saves.
	Store *store.Store
}

type server struct {
	opts Options
}

// New returns the HTTP handler for auth, the API and the frontend in web.
// The API requires a signed-in user; the app shell does not, so it can
// send the user to the login page.
func New(authn *auth.Service, web fs.FS, opts Options) (http.Handler, error) {
	s := &server{opts: opts}
	static, err := newStatic(web)
	if err != nil {
		return nil, err
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/version", s.getVersion)
	authn.Register(mux)

	// Everything registered on private is only reachable with a session.
	private := http.NewServeMux()
	mux.Handle("/api/", authn.Require(private))
	mux.Handle("GET /games/{key}/imgs/{name}", authn.Require(http.HandlerFunc(s.getGameImage)))
	mux.Handle("GET /games/{key}/sources/{path...}", authn.Require(http.HandlerFunc(s.getGameSource)))
	mux.Handle("/", static)

	private.HandleFunc("GET /api/me", s.getMe)
	private.HandleFunc("GET /api/catalog", s.getCatalog)
	private.HandleFunc("GET /api/games/{key}/saves", s.getSaves)
	private.HandleFunc("PUT /api/games/{key}/saves", s.putSaves)
	private.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "接口不存在")
	})
	return mux, nil
}

func (s *server) getVersion(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"version": s.opts.Version})
}

func (s *server) getMe(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, auth.User(r.Context()))
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
