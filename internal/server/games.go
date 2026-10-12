package server

import (
	"net/http"
	"os"
	"path/filepath"

	"arcade/internal/catalog"
)

// getCatalog returns the home page shelves from games.yaml, in order. Images
// are looked up on every request, so adding one needs no restart.
func (s *server) getCatalog(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, s.opts.Catalog.List(s.opts.GamesDir))
}

// getGameSource serves <games_dir>/<key>/sources/<path>: the movie and the
// files it loads, such as Hot Air's levels/level_<n>.swf. The path cannot
// leave the sources directory, even through a symlink. Caching works as for
// images; the movie itself is requested with ?v= from the catalogue.
func (s *server) getGameSource(w http.ResponseWriter, r *http.Request) {
	key, name := r.PathValue("key"), r.PathValue("path")
	contentType, ok := catalog.SourceType(name)
	if !catalog.ValidKey(key) || !ok {
		http.NotFound(w, r)
		return
	}
	root, err := os.OpenRoot(filepath.Join(s.opts.GamesDir, key, "sources"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer root.Close()
	f, err := root.Open(filepath.FromSlash(name))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	h := w.Header()
	setCache(h, r)
	h.Set("Content-Type", contentType)
	h.Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, info.Name(), info.ModTime(), f)
}

// setCache lets browsers keep a versioned URL (?v=) forever and makes them
// revalidate a bare one on every use, since files may be replaced in place.
func setCache(h http.Header, r *http.Request) {
	if r.URL.Query().Has("v") {
		h.Set("Cache-Control", "private, max-age=31536000, immutable")
	} else {
		h.Set("Cache-Control", "private, no-cache")
	}
}

// getGameImage serves <games_dir>/<key>/imgs/<name>. Images may be replaced
// in place: a versioned URL (?v=, from the catalogue) changes with the file
// and is cached forever, while a bare URL is revalidated on every use.
func (s *server) getGameImage(w http.ResponseWriter, r *http.Request) {
	key, name := r.PathValue("key"), r.PathValue("name")
	if !catalog.ValidKey(key) || !catalog.ValidImageName(name) {
		http.NotFound(w, r)
		return
	}
	file := filepath.Join(s.opts.GamesDir, key, "imgs", name)
	if info, err := os.Stat(file); err != nil || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	h := w.Header()
	setCache(h, r)
	h.Set("X-Content-Type-Options", "nosniff")
	http.ServeFile(w, r, file)
}
