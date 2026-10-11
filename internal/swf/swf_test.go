package swf

import (
	"bytes"
	"compress/zlib"
	"strings"
	"testing"
)

// movie is the header of a 550x400 movie: version 8, the stage RECT
// (n=15: 0, 11000, 0, 8000 twips), then the frame rate and count.
func movie(t *testing.T, sig string) []byte {
	t.Helper()
	body := []byte{0x78, 0x00, 0x05, 0x5f, 0x00, 0x00, 0x0f, 0xa0, 0x00, 0x00, 0x0c, 0x01, 0x00}
	head := append([]byte(sig), 8, 0, 0, 0, 0)
	if sig != "CWS" {
		return append(head, body...)
	}
	var z bytes.Buffer
	w := zlib.NewWriter(&z)
	w.Write(body)
	w.Close()
	return append(head, z.Bytes()...)
}

func TestSize(t *testing.T) {
	for _, sig := range []string{"FWS", "CWS"} {
		w, h, err := Size(bytes.NewReader(movie(t, sig)))
		if err != nil || w != 550 || h != 400 {
			t.Errorf("%s: Size = %d, %d, %v; want 550, 400", sig, w, h, err)
		}
	}
}

func TestSizeRejects(t *testing.T) {
	for name, data := range map[string][]byte{
		"lzma":      append([]byte("ZWS"), make([]byte, 20)...),
		"not swf":   []byte("<html><body>hello</body>"),
		"truncated": movie(t, "FWS")[:10],
		"short":     []byte("FWS"),
	} {
		if _, _, err := Size(bytes.NewReader(data)); err == nil {
			t.Errorf("%s: Size succeeded", name)
		}
	}
	if _, _, err := Size(strings.NewReader("FWS\x08\x00\x00\x00\x00\x00")); err == nil {
		t.Error("empty stage: Size succeeded")
	}
}
