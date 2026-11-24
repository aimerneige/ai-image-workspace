package config

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLoadExpandsEnvAndNormalizes(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	data := `
database:
  driver: pgsql
  dsn: "host=db password=${TEST_DB_PASS}"
auth:
  allow_registration: false
  admin:
    password: "pa$$word"
generation:
  timeout: 90s
providers:
  - key: oa
    type: OpenAI
    api_key: ${TEST_OA_KEY}
`
	if err := os.WriteFile(path, []byte(data), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("TEST_DB_PASS", "s3cret")
	t.Setenv("TEST_OA_KEY", "sk-abc")
	t.Setenv("AIW_ADMIN_USERNAME", "boss")

	cfg, err := Load(path, true)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Database.Driver != "postgres" || cfg.Database.DSN != "host=db password=s3cret" {
		t.Fatalf("database: %+v", cfg.Database)
	}
	if cfg.Auth.AllowRegistration || cfg.Auth.Admin.Username != "boss" || cfg.Auth.Admin.Password != "pa$$word" {
		t.Fatalf("auth: %+v", cfg.Auth)
	}
	if cfg.Generate.Timeout != 90*time.Second {
		t.Fatalf("timeout: %v", cfg.Generate.Timeout)
	}
	if p := cfg.Providers[0]; p.Type != "openai" || p.APIKey != "sk-abc" || p.Name != "oa" {
		t.Fatalf("provider: %+v", p)
	}
}

func TestLoadRejectsBadDriver(t *testing.T) {
	t.Setenv("AIW_DB_DRIVER", "oracle")
	if _, err := Load("", false); err == nil {
		t.Fatal("expected error for unsupported driver")
	}
}

func TestMissingOptionalFile(t *testing.T) {
	cfg, err := Load(filepath.Join(t.TempDir(), "nope.yaml"), false)
	if err != nil || cfg.Database.Driver != "sqlite" {
		t.Fatalf("defaults: %v %+v", err, cfg)
	}
	if _, err := Load(filepath.Join(t.TempDir(), "nope.yaml"), true); err == nil {
		t.Fatal("explicit missing file must fail")
	}
}
