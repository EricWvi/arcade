package catalog

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func write(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), FileName)
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

const valid = `
shelves:
  - id: zmxy
    title: 造梦西游系列
    games: [zmxy-1]
  - id: nitrome
    title: Nitrome
    games: [hot-air-1, zmxy-1]
games:
  hot-air-1:
    title: Hot Air
    subtitle: 休闲闯关
    swf: Hot_Air.swf
    help: |
      用鼠标移动风扇。
      第二行
  zmxy-1:
    title: 造梦西游
    saves: file
`

func TestLoad(t *testing.T) {
	c, err := Load(write(t, valid))
	if err != nil {
		t.Fatal(err)
	}
	want := Catalog{
		Shelves: []Shelf{
			{ID: "zmxy", Title: "造梦西游系列", Games: []string{"zmxy-1"}},
			{ID: "nitrome", Title: "Nitrome", Games: []string{"hot-air-1", "zmxy-1"}},
		},
		Games: map[string]Game{
			"hot-air-1": {Title: "Hot Air", Subtitle: "休闲闯关", SWF: "Hot_Air.swf", Help: "用鼠标移动风扇。\n第二行\n"},
			"zmxy-1":    {Title: "造梦西游", Saves: SavesFile},
		},
	}
	if !reflect.DeepEqual(c, want) {
		t.Fatalf("got %+v, want %+v", c, want)
	}
}

func TestLoadMissingFile(t *testing.T) {
	if _, err := Load(filepath.Join(t.TempDir(), FileName)); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("err = %v, want fs.ErrNotExist", err)
	}
}

func TestLoadEmptyFile(t *testing.T) {
	c, err := Load(write(t, ""))
	if err != nil || len(c.Shelves) != 0 {
		t.Fatalf("catalog = %+v, err = %v", c, err)
	}
}

func TestLoadRejectsInvalid(t *testing.T) {
	for want, content := range map[string]string{
		"unknown game":                 strings.Replace(valid, "[zmxy-1]", "[zmxy-2]", 1),
		`shelf "zmxy" is listed twice`: strings.Replace(valid, "id: nitrome", "id: zmxy", 1),
		"lowercase":                    strings.Replace(valid, "  hot-air-1:", "  Hot_Air:", 1),
		"needs a title":                strings.Replace(valid, "    title: 造梦西游\n", "    subtitle: x\n", 1),
		"no games":                     strings.Replace(valid, "games: [zmxy-1]\n  - id", "games: []\n  - id", 1),
		"subtitel":                     strings.Replace(valid, "subtitle: 休闲闯关", "subtitel: 休闲闯关", 1),
		`lists game "zmxy-1" twice`:    strings.Replace(valid, "[hot-air-1, zmxy-1]", "[zmxy-1, zmxy-1]", 1),
		"shelf 1: id \"\"":             strings.Replace(valid, "id: zmxy", "id: \"\"", 1),
		"inside the sources directory": strings.Replace(valid, "swf: Hot_Air.swf", "swf: ../Hot_Air.swf", 1),
		`saves must be`:                strings.Replace(valid, "swf: Hot_Air.swf", "swf: Hot_Air.swf\n    saves: cloud", 1),
	} {
		_, err := Load(write(t, content))
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%s: err = %v", want, err)
		}
	}
}

func TestLoadRejectsSWFOutsideSources(t *testing.T) {
	for _, swf := range []string{"/abs/game.swf", "levels/../../game.swf", `levels\game.swf`, "game.html", "."} {
		content := strings.Replace(valid, "swf: Hot_Air.swf", "swf: '"+swf+"'", 1)
		if _, err := Load(write(t, content)); err == nil || !strings.Contains(err.Error(), "inside the sources directory") {
			t.Errorf("swf %q: err = %v", swf, err)
		}
	}
	if _, err := Load(write(t, strings.Replace(valid, "swf: Hot_Air.swf", "swf: game/main.swf", 1))); err != nil {
		t.Errorf("nested swf: %v", err)
	}
}

func TestSavesMode(t *testing.T) {
	if got := (Game{}).SavesMode(); got != SavesSharedObject {
		t.Errorf("default = %q", got)
	}
	if got := (Game{Saves: SavesFile}).SavesMode(); got != SavesFile {
		t.Errorf("file = %q", got)
	}
}
