// Package swf reads what the site needs from a Flash movie's header.
package swf

import (
	"bufio"
	"compress/zlib"
	"errors"
	"fmt"
	"io"
)

// Size returns a movie's stage size in pixels. It reads uncompressed (FWS)
// and zlib-compressed (CWS) movies; LZMA (ZWS) movies are not supported.
func Size(r io.Reader) (width, height int, err error) {
	var head [8]byte
	if _, err := io.ReadFull(r, head[:]); err != nil {
		return 0, 0, fmt.Errorf("read swf header: %w", err)
	}
	switch string(head[:3]) {
	case "FWS":
	case "CWS":
		zr, err := zlib.NewReader(r)
		if err != nil {
			return 0, 0, fmt.Errorf("read swf header: %w", err)
		}
		defer zr.Close()
		r = zr
	case "ZWS":
		return 0, 0, errors.New("lzma-compressed swf is not supported")
	default:
		return 0, 0, errors.New("not an swf file")
	}

	// The stage is a RECT: 5 bits giving the field width n, then xmin, xmax,
	// ymin and ymax as n-bit values in twips (1/20 px).
	bits := bitReader{r: bufio.NewReader(r)}
	n, err := bits.read(5)
	if err != nil {
		return 0, 0, fmt.Errorf("read swf stage size: %w", err)
	}
	var v [4]int
	for i := range v {
		if v[i], err = bits.read(int(n)); err != nil {
			return 0, 0, fmt.Errorf("read swf stage size: %w", err)
		}
	}
	width, height = (v[1]-v[0])/20, (v[3]-v[2])/20
	if width <= 0 || height <= 0 {
		return 0, 0, fmt.Errorf("invalid swf stage size %dx%d", width, height)
	}
	return width, height, nil
}

// bitReader reads big-endian bit fields. Only unsigned values are read: the
// stage's minimums are 0 in practice, and its maximums are positive.
type bitReader struct {
	r    io.ByteReader
	cur  byte
	left int
}

func (b *bitReader) read(n int) (int, error) {
	v := 0
	for range n {
		if b.left == 0 {
			c, err := b.r.ReadByte()
			if errors.Is(err, io.EOF) {
				err = io.ErrUnexpectedEOF
			}
			if err != nil {
				return 0, err
			}
			b.cur, b.left = c, 8
		}
		b.left--
		v = v<<1 | int(b.cur>>b.left&1)
	}
	return v, nil
}
