package server

import (
	"net/http"
	"os"
	"path/filepath"
	"regexp"
)

// The frontend requests game images by fixed keys and names, so anything
// else is rejected before it can reach the disk.
var (
	gameKey   = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)
	imageName = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*(\.blur)?\.(png|jpe?g|webp)$`)
)

// getGameImage serves <games_dir>/<key>/imgs/<name>. Images may be replaced
// in place, so browsers revalidate them with Last-Modified on every use.
func (s *server) getGameImage(w http.ResponseWriter, r *http.Request) {
	key, name := r.PathValue("key"), r.PathValue("name")
	if !gameKey.MatchString(key) || !imageName.MatchString(name) {
		http.NotFound(w, r)
		return
	}
	file := filepath.Join(s.opts.GamesDir, key, "imgs", name)
	if info, err := os.Stat(file); err != nil || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	h := w.Header()
	h.Set("Cache-Control", "private, no-cache")
	h.Set("X-Content-Type-Options", "nosniff")
	http.ServeFile(w, r, file)
}
