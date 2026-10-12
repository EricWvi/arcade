package catalog

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func writeFiles(t *testing.T, dir string, files map[string]string) {
	t.Helper()
	for name, data := range files {
		path := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(data), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func TestFilesListsWhatShelvedGamesServe(t *testing.T) {
	games := t.TempDir()
	writeFiles(t, games, map[string]string{
		"zmxy-1/imgs/card.png":          "png",
		"zmxy-1/imgs/card.blur.webp":    "webp",
		"zmxy-1/imgs/notes.txt":         "not an image name",
		"zmxy-1/imgs/old/card.png":      "nested image",
		"zmxy-1/sources/game.swf":       "swf",
		"zmxy-1/sources/levels/1.swf":   "level",
		"zmxy-1/sources/data/Map.XML":   "xml",
		"zmxy-1/sources/page.html":      "<script>",
		"zmxy-1/notes.md":               "outside imgs and sources",
		"unshelved/sources/game.swf":    "not on a shelf",
		"hot-air-1/sources/Hot_Air.swf": "swf",
		"secret.swf":                    "secret",
	})
	if err := os.Symlink(filepath.Join(games, "secret.swf"), filepath.Join(games, "zmxy-1/sources/link.swf")); err != nil {
		t.Fatal(err)
	}
	c := Catalog{
		Shelves: []Shelf{
			{ID: "zmxy", Title: "造梦西游系列", Games: []string{"zmxy-1"}},
			{ID: "all", Title: "全部", Games: []string{"hot-air-1", "zmxy-1", "no-files"}},
		},
		Games: map[string]Game{
			"zmxy-1":    {Title: "造梦西游"},
			"hot-air-1": {Title: "Hot Air"},
			"no-files":  {Title: "还没有文件"},
			"unshelved": {Title: "不在首页"},
		},
	}
	got, err := c.Files(games)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{
		"hot-air-1/sources/Hot_Air.swf",
		"zmxy-1/imgs/card.blur.webp",
		"zmxy-1/imgs/card.png",
		"zmxy-1/sources/data/Map.XML",
		"zmxy-1/sources/game.swf",
		"zmxy-1/sources/levels/1.swf",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q, want %q", got, want)
	}
}
