// Package storage persists image bytes on the local filesystem and produces
// thumbnails for fast gallery rendering.
package storage

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/draw"
	_ "image/gif"
	"image/jpeg"
	"image/png"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	xdraw "golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const thumbMaxEdge = 512

type Store struct{ root string }

func New(root string) (*Store, error) {
	dir := filepath.Join(root, "images")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	return &Store{root: root}, nil
}

type Saved struct {
	ID        string
	Path      string // relative to root
	ThumbPath string // relative to root, may be empty
	MimeType  string
	Width     int
	Height    int
	Bytes     int64
}

var extByMime = map[string]string{
	"image/png":  ".png",
	"image/jpeg": ".jpg",
	"image/webp": ".webp",
	"image/gif":  ".gif",
}

// DetectMime sniffs the content type; only raster formats we can serve are
// accepted.
func DetectMime(data []byte) (string, error) {
	m := http.DetectContentType(data)
	if i := strings.IndexByte(m, ';'); i >= 0 {
		m = m[:i]
	}
	if _, ok := extByMime[m]; !ok {
		return "", fmt.Errorf("unsupported image type %q", m)
	}
	return m, nil
}

// Save writes data under images/YYYY/MM/ and creates a thumbnail when the
// image is decodable.
func (s *Store) Save(data []byte) (*Saved, error) {
	if len(data) == 0 {
		return nil, errors.New("empty image")
	}
	mime, err := DetectMime(data)
	if err != nil {
		return nil, err
	}
	id := uuid.NewString()
	sub := filepath.Join("images", time.Now().Format("2006"), time.Now().Format("01"))
	if err := os.MkdirAll(filepath.Join(s.root, sub), 0o755); err != nil {
		return nil, err
	}
	rel := filepath.Join(sub, id+extByMime[mime])
	if err := os.WriteFile(filepath.Join(s.root, rel), data, 0o644); err != nil {
		return nil, err
	}
	out := &Saved{ID: id, Path: rel, MimeType: mime, Bytes: int64(len(data))}

	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		// Keep the original even if we cannot decode it for a thumbnail.
		if cfg, _, cerr := image.DecodeConfig(bytes.NewReader(data)); cerr == nil {
			out.Width, out.Height = cfg.Width, cfg.Height
		}
		return out, nil
	}
	b := img.Bounds()
	out.Width, out.Height = b.Dx(), b.Dy()
	if thumb, ext, err := makeThumb(img); err == nil {
		trel := filepath.Join(sub, id+".thumb"+ext)
		if err := os.WriteFile(filepath.Join(s.root, trel), thumb, 0o644); err == nil {
			out.ThumbPath = trel
		}
	}
	return out, nil
}

func makeThumb(src image.Image) ([]byte, string, error) {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if w == 0 || h == 0 {
		return nil, "", errors.New("empty image")
	}
	scale := float64(thumbMaxEdge) / float64(max(w, h))
	if scale > 1 {
		scale = 1
	}
	tw, th := max(1, int(float64(w)*scale)), max(1, int(float64(h)*scale))
	dst := image.NewNRGBA(image.Rect(0, 0, tw, th))
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), src, b, draw.Src, nil)

	var buf bytes.Buffer
	if hasAlpha(dst) {
		enc := png.Encoder{CompressionLevel: png.BestSpeed}
		if err := enc.Encode(&buf, dst); err != nil {
			return nil, "", err
		}
		return buf.Bytes(), ".png", nil
	}
	if err := jpeg.Encode(&buf, dst, &jpeg.Options{Quality: 84}); err != nil {
		return nil, "", err
	}
	return buf.Bytes(), ".jpg", nil
}

func hasAlpha(img *image.NRGBA) bool {
	for i := 3; i < len(img.Pix); i += 4 {
		if img.Pix[i] != 0xff {
			return true
		}
	}
	return false
}

// Abs resolves a stored relative path, refusing anything that escapes root.
func (s *Store) Abs(rel string) (string, error) {
	p := filepath.Join(s.root, filepath.Clean("/"+rel))
	if !strings.HasPrefix(p, s.root+string(os.PathSeparator)) {
		return "", errors.New("invalid path")
	}
	return p, nil
}

func (s *Store) Read(rel string) ([]byte, error) {
	p, err := s.Abs(rel)
	if err != nil {
		return nil, err
	}
	return os.ReadFile(p)
}

func (s *Store) Remove(rels ...string) {
	for _, r := range rels {
		if r == "" {
			continue
		}
		if p, err := s.Abs(r); err == nil {
			_ = os.Remove(p)
		}
	}
}
