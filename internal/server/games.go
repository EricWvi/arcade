package server

import (
	"fmt"
	"hash/fnv"
	"log/slog"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"

	"arcade/internal/catalog"
	"arcade/internal/swf"
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
	// SWF is the movie to play, if games.yaml names one and it exists.
	SWF *catalogSWF `json:"swf,omitempty"`
	// Help is how to play, from games.yaml; empty if not given.
	Help string `json:"help,omitempty"`
}

type catalogSWF struct {
	// File is relative to /games/<key>/sources/.
	File    string `json:"file"`
	Version string `json:"version"`
	// Width and height are the stage size, or 0 if it could not be read.
	Width  int `json:"width"`
	Height int `json:"height"`
}

// getCatalog returns the home page shelves from games.yaml, in order. Images
// are looked up on every request, so adding one needs no restart.
func (s *server) getCatalog(w http.ResponseWriter, r *http.Request) {
	res := catalogResponse{Shelves: []catalogShelf{}}
	for _, sh := range s.opts.Catalog.Shelves {
		out := catalogShelf{ID: sh.ID, Title: sh.Title, Games: []catalogGame{}}
		for _, key := range sh.Games {
			out.Games = append(out.Games, s.catalogGame(key))
		}
		res.Shelves = append(res.Shelves, out)
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, res)
}

// catalogGame describes a game listed in games.yaml.
func (s *server) catalogGame(key string) catalogGame {
	g := s.opts.Catalog.Games[key]
	return catalogGame{ID: key, Title: g.Title, Subtitle: g.Subtitle, Images: s.images(key), SWF: s.swf(key, g.SWF), Help: strings.TrimSpace(g.Help)}
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

// swf describes a game's movie, or returns nil if it has none on disk.
func (s *server) swf(key, file string) *catalogSWF {
	if file == "" {
		return nil
	}
	root, err := os.OpenRoot(filepath.Join(s.opts.GamesDir, key, "sources"))
	if err != nil {
		return nil
	}
	defer root.Close()
	f, err := root.Open(file)
	if err != nil {
		return nil
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		return nil
	}
	out := &catalogSWF{File: file, Version: fileVersion(info)}
	if w, h, err := swf.Size(f); err == nil {
		out.Width, out.Height = w, h
	} else {
		slog.Warn("read swf stage size", "game", key, "file", file, "err", err)
	}
	return out
}

func fileVersion(info os.FileInfo) string {
	h := fnv.New64a()
	fmt.Fprint(h, info.ModTime().UnixNano(), info.Size())
	return fmt.Sprintf("%x", h.Sum64())
}

// sourceTypes are the files a game may load from its sources directory, by
// extension. Anything else, HTML in particular, is never served.
var sourceTypes = map[string]string{
	".swf":  "application/x-shockwave-flash",
	".xml":  "text/xml; charset=utf-8",
	".txt":  "text/plain; charset=utf-8",
	".json": "application/json",
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".gif":  "image/gif",
	".mp3":  "audio/mpeg",
}

// getGameSource serves <games_dir>/<key>/sources/<path>: the movie and the
// files it loads, such as Hot Air's levels/level_<n>.swf. The path cannot
// leave the sources directory, even through a symlink. Caching works as for
// images; the movie itself is requested with ?v= from the catalogue.
func (s *server) getGameSource(w http.ResponseWriter, r *http.Request) {
	key, name := r.PathValue("key"), r.PathValue("path")
	contentType, ok := sourceTypes[strings.ToLower(path.Ext(name))]
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
	setCache(h, r)
	h.Set("X-Content-Type-Options", "nosniff")
	http.ServeFile(w, r, file)
}
