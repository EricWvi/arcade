// Package catalog loads games.yaml: the games the site offers and how the
// home page groups and orders them.
package catalog

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"gopkg.in/yaml.v3"
)

// FileName is the catalogue's name; it sits next to config.yaml.
const FileName = "games.yaml"

var keyPattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

// ValidKey reports whether key may name a game or a shelf. Game keys are
// also directory names under games_dir and parts of image URLs.
func ValidKey(key string) bool { return keyPattern.MatchString(key) }

// Catalog is the parsed games.yaml.
type Catalog struct {
	// Shelves are the home page rows, top to bottom.
	Shelves []Shelf `yaml:"shelves"`
	// Games maps a game key to its details.
	Games map[string]Game `yaml:"games"`
}

// Shelf is one home page row.
type Shelf struct {
	ID    string `yaml:"id"`
	Title string `yaml:"title"`
	// Games are game keys, left to right.
	Games []string `yaml:"games"`
}

// Game describes one game.
type Game struct {
	Title    string `yaml:"title"`
	Subtitle string `yaml:"subtitle"`
	// SWF is the movie to play, relative to the game's sources directory
	// (<games_dir>/<key>/sources). Files it loads must sit in that
	// directory too. Empty means the game cannot be played yet.
	SWF string `yaml:"swf"`
	// Help tells players how to play, shown beside the game. Line breaks
	// are kept.
	Help string `yaml:"help"`
}

// Load reads and checks the catalogue at path. A missing file returns an
// error matching fs.ErrNotExist. Unknown keys are rejected so a typo such
// as "subtitel" is not silently ignored.
func Load(path string) (Catalog, error) {
	var c Catalog
	raw, err := os.ReadFile(path)
	if err != nil {
		return c, err
	}
	dec := yaml.NewDecoder(bytes.NewReader(raw))
	dec.KnownFields(true)
	if err := dec.Decode(&c); err != nil && !errors.Is(err, io.EOF) {
		return c, fmt.Errorf("parse %s: %w", path, err)
	}
	if err := c.validate(); err != nil {
		return c, fmt.Errorf("%s: %w", path, err)
	}
	return c, nil
}

func (c Catalog) validate() error {
	for key, g := range c.Games {
		if !ValidKey(key) {
			return fmt.Errorf("game key %q must be lowercase letters, digits and single dashes", key)
		}
		if g.Title == "" {
			return fmt.Errorf("game %q needs a title", key)
		}
		if g.SWF != "" && (!filepath.IsLocal(g.SWF) || filepath.Ext(g.SWF) != ".swf" || strings.ContainsRune(g.SWF, '\\')) {
			return fmt.Errorf("game %q: swf %q must be a .swf path inside the sources directory", key, g.SWF)
		}
	}
	shelves := map[string]bool{}
	for i, s := range c.Shelves {
		if !ValidKey(s.ID) {
			return fmt.Errorf("shelf %d: id %q must be lowercase letters, digits and single dashes", i+1, s.ID)
		}
		if shelves[s.ID] {
			return fmt.Errorf("shelf %q is listed twice", s.ID)
		}
		shelves[s.ID] = true
		if s.Title == "" {
			return fmt.Errorf("shelf %q needs a title", s.ID)
		}
		if len(s.Games) == 0 {
			return fmt.Errorf("shelf %q has no games", s.ID)
		}
		seen := map[string]bool{}
		for _, key := range s.Games {
			if _, ok := c.Games[key]; !ok {
				return fmt.Errorf("shelf %q lists unknown game %q", s.ID, key)
			}
			if seen[key] {
				return fmt.Errorf("shelf %q lists game %q twice", s.ID, key)
			}
			seen[key] = true
		}
	}
	return nil
}
