// Package secret encrypts provider API keys at rest with AES-256-GCM.
package secret

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const prefix = "v1:"

type Box struct{ aead cipher.AEAD }

// New derives a 256-bit key from secret.
func New(secret string) (*Box, error) {
	if secret == "" {
		return nil, errors.New("empty secret")
	}
	key := sha256.Sum256([]byte(secret))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Box{aead: aead}, nil
}

// LoadOrCreate returns secret if set; otherwise it reads or creates a random
// key file inside dir.
func LoadOrCreate(secret, dir string) (*Box, error) {
	if secret != "" {
		return New(secret)
	}
	path := filepath.Join(dir, "secret.key")
	if data, err := os.ReadFile(path); err == nil {
		if s := strings.TrimSpace(string(data)); s != "" {
			return New(s)
		}
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return nil, err
	}
	s := hex.EncodeToString(buf)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	if err := os.WriteFile(path, []byte(s+"\n"), 0o600); err != nil {
		return nil, fmt.Errorf("write %s: %w", path, err)
	}
	return New(s)
}

func (b *Box) Encrypt(plain string) (string, error) {
	if plain == "" {
		return "", nil
	}
	nonce := make([]byte, b.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	out := b.aead.Seal(nonce, nonce, []byte(plain), nil)
	return prefix + base64.StdEncoding.EncodeToString(out), nil
}

func (b *Box) Decrypt(enc string) (string, error) {
	if enc == "" {
		return "", nil
	}
	if !strings.HasPrefix(enc, prefix) {
		return "", errors.New("unknown ciphertext format")
	}
	raw, err := base64.StdEncoding.DecodeString(enc[len(prefix):])
	if err != nil {
		return "", err
	}
	ns := b.aead.NonceSize()
	if len(raw) < ns {
		return "", errors.New("ciphertext too short")
	}
	plain, err := b.aead.Open(nil, raw[:ns], raw[ns:], nil)
	if err != nil {
		return "", errors.New("cannot decrypt API key: was security.secret_key changed?")
	}
	return string(plain), nil
}

// Mask renders a key as "sk-a…wxyz" for display.
func Mask(key string) string {
	if key == "" {
		return ""
	}
	r := []rune(key)
	if len(r) <= 8 {
		return strings.Repeat("•", len(r))
	}
	return string(r[:3]) + "…" + string(r[len(r)-4:])
}
