package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"arcade/internal/catalog"
)

// Files written by catalog build.
const (
	listingFile = "catalog.json"
	filesFile   = "files.txt"
)

// buildCatalog runs "arcade catalog build": it computes, ahead of time, what
// a server without the games directory needs, writing to the out directory
//
//	catalog.json  the GET /api/catalog response for the shelved games
//	files.txt     the files those games serve, relative to the games
//	              directory, one per line (for rclone --files-from)
//
// A games.yaml error, or a movie games.yaml names that is not on disk,
// fails the build so a broken catalogue is never published.
func buildCatalog(args []string) error {
	fset := flag.NewFlagSet("catalog build", flag.ContinueOnError)
	gamesDir := fset.String("games", "games", "games directory, one subdirectory per game key")
	catalogPath := fset.String("catalog", catalog.FileName, "games.yaml listing the games to publish")
	out := fset.String("out", "dist", "directory to write "+listingFile+" and "+filesFile+" to")
	if err := fset.Parse(args); err != nil {
		return err
	}
	if fset.NArg() > 0 {
		return fmt.Errorf("catalog build: unexpected argument %q", fset.Arg(0))
	}

	games, err := catalog.Load(*catalogPath)
	if err != nil {
		return err
	}
	listing := games.List(*gamesDir)
	var missing []string
	published := map[string]bool{}
	for _, sh := range listing.Shelves {
		for _, g := range sh.Games {
			if file := games.Games[g.ID].SWF; g.SWF == nil && file != "" && !published[g.ID] {
				missing = append(missing, g.ID+"/sources/"+file)
			}
			published[g.ID] = true
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("movies not found under %s: %s", *gamesDir, strings.Join(missing, ", "))
	}
	files, err := games.Files(*gamesDir)
	if err != nil {
		return err
	}

	raw, err := json.Marshal(listing)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(*out, 0o755); err != nil {
		return err
	}
	var list strings.Builder
	for _, f := range files {
		list.WriteString(f + "\n")
	}
	if err := errors.Join(
		os.WriteFile(filepath.Join(*out, listingFile), raw, 0o644),
		os.WriteFile(filepath.Join(*out, filesFile), []byte(list.String()), 0o644),
	); err != nil {
		return err
	}
	slog.Info("catalog built", "games", len(published), "files", len(files), "out", *out)
	return nil
}
