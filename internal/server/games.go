package server

import (
	"fmt"
	"hash/fnv"
	"net/http"
	"os"
	"path/filepath"
	"regexp"

	"arcade/internal/catalog"
)

// The frontend requests game images by fixed keys and names, so anything
// else is rejected before it can reach the disk.
var imageName = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*(\.blur)?\.(png|jpe?g|webp)$`)

// imageKinds are the images a game may have, as <kind>.png in its imgs
// directory, in the order the API lists them.
var imageKinds = []string{"icon", "card", "poster", "background"}

type catalogResponse struct {
	Shelves []catalogShelf `json:"shelves"`
}

type catalogShelf struct {
	ID    string        `json:"id"`
	Title string        `json:"title"`
	Games []catalogGame `json:"games"`
}

type catalogGame struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Subtitle string `json:"subtitle"`
	// Images maps each kind found on disk to its version. The frontend
	// builds the URLs and appends ?v=<version> so they can be cached forever.
	Images map[string]string `json:"images"`
}

// getCatalog returns the home page shelves from games.yaml, in order. Images
// are looked up on every request, so adding one needs no restart.
func (s *server) getCatalog(w http.ResponseWriter, r *http.Request) {
	res := catalogResponse{Shelves: []catalogShelf{}}
	for _, sh := range s.opts.Catalog.Shelves {
		out := catalogShelf{ID: sh.ID, Title: sh.Title, Games: []catalogGame{}}
		for _, key := range sh.Games {
			g := s.opts.Catalog.Games[key]
			out.Games = append(out.Games, catalogGame{ID: key, Title: g.Title, Subtitle: g.Subtitle, Images: s.images(key)})
		}
		res.Shelves = append(res.Shelves, out)
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, res)
}

// images finds a game's images. A version changes whenever the image or its
// blurred placeholder is replaced, since both share it.
func (s *server) images(key string) map[string]string {
	found := map[string]string{}
	dir := filepath.Join(s.opts.GamesDir, key, "imgs")
	for _, kind := range imageKinds {
		info, err := os.Stat(filepath.Join(dir, kind+".png"))
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		h := fnv.New64a()
		fmt.Fprint(h, info.ModTime().UnixNano(), info.Size())
		if blur, err := os.Stat(filepath.Join(dir, kind+".blur.webp")); err == nil {
			fmt.Fprint(h, blur.ModTime().UnixNano(), blur.Size())
		}
		found[kind] = fmt.Sprintf("%x", h.Sum64())
	}
	return found
}

// getGameImage serves <games_dir>/<key>/imgs/<name>. Images may be replaced
// in place: a versioned URL (?v=, from the catalogue) changes with the file
// and is cached forever, while a bare URL is revalidated on every use.
func (s *server) getGameImage(w http.ResponseWriter, r *http.Request) {
	key, name := r.PathValue("key"), r.PathValue("name")
	if !catalog.ValidKey(key) || !imageName.MatchString(name) {
		http.NotFound(w, r)
		return
	}
	file := filepath.Join(s.opts.GamesDir, key, "imgs", name)
	if info, err := os.Stat(file); err != nil || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	h := w.Header()
	if r.URL.Query().Has("v") {
		h.Set("Cache-Control", "private, max-age=31536000, immutable")
	} else {
		h.Set("Cache-Control", "private, no-cache")
	}
	h.Set("X-Content-Type-Options", "nosniff")
	http.ServeFile(w, r, file)
}
