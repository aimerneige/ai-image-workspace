package secret

import (
	"strings"
	"testing"
)

func TestRoundTripAndWrongKey(t *testing.T) {
	a, _ := New("key-a")
	enc, err := a.Encrypt("sk-live-123456")
	if err != nil || !strings.HasPrefix(enc, "v1:") || strings.Contains(enc, "sk-live") {
		t.Fatalf("encrypt: %q %v", enc, err)
	}
	if got, err := a.Decrypt(enc); err != nil || got != "sk-live-123456" {
		t.Fatalf("decrypt: %q %v", got, err)
	}
	b, _ := New("key-b")
	if _, err := b.Decrypt(enc); err == nil {
		t.Fatal("decrypt with wrong key must fail")
	}
}

func TestLoadOrCreatePersists(t *testing.T) {
	dir := t.TempDir()
	a, err := LoadOrCreate("", dir)
	if err != nil {
		t.Fatal(err)
	}
	enc, _ := a.Encrypt("x")
	b, _ := LoadOrCreate("", dir)
	if got, err := b.Decrypt(enc); err != nil || got != "x" {
		t.Fatalf("persisted key not reused: %v", err)
	}
}

func TestMask(t *testing.T) {
	if Mask("sk-proj-abcdefgh1234") != "sk-…1234" || Mask("short") != "•••••" || Mask("") != "" {
		t.Fatal("mask")
	}
}
