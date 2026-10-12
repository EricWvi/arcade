package catalog

import (
	"errors"
	"fmt"
	"hash/fnv"
	"io/fs"
	"log/slog"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"slices"
	"strings"

	"arcade/internal/swf"
)

// The frontend requests game images by fixed keys and names, so anything
// else is never served.
var imageName = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*(\.blur)?\.(png|jpe?g|webp)$`)

// ValidImageName reports whether name may be served from a game's imgs
// directory.
func ValidImageName(name string) bool { return imageName.MatchString(name) }

// imageKinds are the images a game may have, as <kind>.png in its imgs
// directory, in the order a listing gives them.
var imageKinds = []string{"icon", "card", "poster", "background"}

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

// SourceType returns the content type a sources file is served with, or
// false if files like name are never served.
func SourceType(name string) (string, bool) {
	t, ok := sourceTypes[strings.ToLower(path.Ext(name))]
	return t, ok
}

// Listing is the home page shelves with what each game has on disk, as
// GET /api/catalog returns it.
type Listing struct {
	Shelves []ListedShelf `json:"shelves"`
}

// ListedShelf is one home page row.
type ListedShelf struct {
	ID    string       `json:"id"`
	Title string       `json:"title"`
	Games []ListedGame `json:"games"`
}

// ListedGame is one game on a shelf.
type ListedGame struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Subtitle string `json:"subtitle"`
	// Images maps each kind found on disk to its version. The frontend
	// builds the URLs and appends ?v=<version> so they can be cached forever.
	Images map[string]string `json:"images"`
	// SWF is the movie to play, if games.yaml names one and it exists.
	SWF *ListedSWF `json:"swf,omitempty"`
	// Saves is how the game saves: "shared-object" or "file".
	Saves string `json:"saves"`
	// Help is how to play, from games.yaml; empty if not given.
	Help string `json:"help,omitempty"`
}

// ListedSWF is a game's movie.
type ListedSWF struct {
	// File is relative to /games/<key>/sources/.
	File    string `json:"file"`
	Version string `json:"version"`
	// Width and height are the stage size, or 0 if it could not be read.
	Width  int `json:"width"`
	Height int `json:"height"`
}

// List describes the shelves in order, looking up each game's images and
// movie under gamesDir (<gamesDir>/<key>/{imgs,sources}).
func (c Catalog) List(gamesDir string) Listing {
	res := Listing{Shelves: []ListedShelf{}}
	for _, sh := range c.Shelves {
		out := ListedShelf{ID: sh.ID, Title: sh.Title, Games: []ListedGame{}}
		for _, key := range sh.Games {
			out.Games = append(out.Games, c.Describe(gamesDir, key))
		}
		res.Shelves = append(res.Shelves, out)
	}
	return res
}

// Shelved reports whether a shelf lists the game. Only those can be
// reached from the home page, so only they are played, saved and listed.
func (c Catalog) Shelved(key string) bool {
	for _, sh := range c.Shelves {
		if slices.Contains(sh.Games, key) {
			return true
		}
	}
	return false
}

// Describe lists one game, looking up its images and movie under gamesDir.
func (c Catalog) Describe(gamesDir, key string) ListedGame {
	g := c.Games[key]
	return ListedGame{
		ID: key, Title: g.Title, Subtitle: g.Subtitle,
		Images: images(gamesDir, key), SWF: movie(gamesDir, key, g.SWF),
		Saves: g.SavesMode(), Help: strings.TrimSpace(g.Help),
	}
}

// images finds a game's images. A version changes whenever the image or its
// blurred placeholder is replaced, since both share it.
func images(gamesDir, key string) map[string]string {
	found := map[string]string{}
	dir := filepath.Join(gamesDir, key, "imgs")
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

// movie describes a game's movie, or returns nil if it has none on disk.
func movie(gamesDir, key, file string) *ListedSWF {
	if file == "" {
		return nil
	}
	root, err := os.OpenRoot(filepath.Join(gamesDir, key, "sources"))
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
	h := fnv.New64a()
	fmt.Fprint(h, info.ModTime().UnixNano(), info.Size())
	out := &ListedSWF{File: file, Version: fmt.Sprintf("%x", h.Sum64())}
	if w, h, err := swf.Size(f); err == nil {
		out.Width, out.Height = w, h
	} else {
		slog.Warn("read swf stage size", "game", key, "file", file, "err", err)
	}
	return out
}

// Files lists the files the shelved games may serve: images with a valid
// name and sources of an allowed type. Paths are slash-separated, relative
// to gamesDir and sorted. Only regular files are listed; symlinks are
// skipped. A game without an imgs or sources directory simply has no files
// there.
func (c Catalog) Files(gamesDir string) ([]string, error) {
	keys := map[string]bool{}
	for _, sh := range c.Shelves {
		for _, key := range sh.Games {
			keys[key] = true
		}
	}
	var files []string
	for key := range keys {
		for dir, ok := range map[string]func(string) bool{
			"imgs":    ValidImageName,
			"sources": func(name string) bool { _, ok := SourceType(name); return ok },
		} {
			root := filepath.Join(gamesDir, key, dir)
			err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
				if err != nil {
					return err
				}
				if !d.Type().IsRegular() || !ok(d.Name()) {
					return nil
				}
				// Images sit directly in imgs; the server never serves nested ones.
				if dir == "imgs" && filepath.Dir(p) != root {
					return nil
				}
				rel, err := filepath.Rel(gamesDir, p)
				if err != nil {
					return err
				}
				files = append(files, filepath.ToSlash(rel))
				return nil
			})
			if err != nil && !errors.Is(err, fs.ErrNotExist) {
				return nil, fmt.Errorf("list %s files of %s: %w", dir, key, err)
			}
		}
	}
	slices.Sort(files)
	return files, nil
}
