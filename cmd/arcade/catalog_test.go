package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"arcade/internal/catalog"
)

const games = `
shelves:
  - id: nitrome
    title: Nitrome
    games: [hot-air-1]
games:
  hot-air-1:
    title: Hot Air
    swf: Hot_Air.swf
`

// swfHeader is an uncompressed movie header with a 550x400 stage.
const swfHeader = "FWS\x08\x00\x00\x00\x00\x78\x00\x05\x5f\x00\x00\x0f\xa0\x00\x00\x0c\x01\x00"

func setup(t *testing.T) (gamesDir, catalogPath, out string) {
	t.Helper()
	dir := t.TempDir()
	gamesDir, catalogPath, out = filepath.Join(dir, "games"), filepath.Join(dir, "games.yaml"), filepath.Join(dir, "dist")
	if err := os.WriteFile(catalogPath, []byte(games), 0o644); err != nil {
		t.Fatal(err)
	}
	for name, data := range map[string]string{
		"hot-air-1/imgs/card.png":           "png",
		"hot-air-1/sources/Hot_Air.swf":     swfHeader,
		"hot-air-1/sources/levels/1.swf":    "level",
		"hot-air-1/sources/levels/notes.md": "not served",
	} {
		path := filepath.Join(gamesDir, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(data), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return gamesDir, catalogPath, out
}

func TestBuildCatalog(t *testing.T) {
	gamesDir, catalogPath, out := setup(t)
	if err := buildCatalog([]string{"-games", gamesDir, "-catalog", catalogPath, "-out", out}); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(out, "catalog.json"))
	if err != nil {
		t.Fatal(err)
	}
	var listing catalog.Listing
	if err := json.Unmarshal(raw, &listing); err != nil {
		t.Fatal(err)
	}
	g := listing.Shelves[0].Games[0]
	if g.ID != "hot-air-1" || g.Images["card"] == "" || g.SWF == nil || g.SWF.Width != 550 || g.SWF.Height != 400 {
		t.Fatalf("listing: %s", raw)
	}
	files, err := os.ReadFile(filepath.Join(out, "files.txt"))
	if err != nil {
		t.Fatal(err)
	}
	want := "hot-air-1/imgs/card.png\nhot-air-1/sources/Hot_Air.swf\nhot-air-1/sources/levels/1.swf\n"
	if string(files) != want {
		t.Fatalf("files.txt = %q, want %q", files, want)
	}
}

func TestBuildCatalogFailsWithoutMovie(t *testing.T) {
	gamesDir, catalogPath, out := setup(t)
	if err := os.Remove(filepath.Join(gamesDir, "hot-air-1/sources/Hot_Air.swf")); err != nil {
		t.Fatal(err)
	}
	err := buildCatalog([]string{"-games", gamesDir, "-catalog", catalogPath, "-out", out})
	if err == nil || !strings.Contains(err.Error(), "hot-air-1/sources/Hot_Air.swf") {
		t.Fatalf("err = %v", err)
	}
	if _, err := os.Stat(out); !os.IsNotExist(err) {
		t.Fatalf("out written despite the error: %v", err)
	}
}
