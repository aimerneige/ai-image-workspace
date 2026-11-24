// Package config loads the YAML configuration file and applies environment
// variable overrides.
package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Server    ServerConfig     `yaml:"server"`
	Database  DatabaseConfig   `yaml:"database"`
	Auth      AuthConfig       `yaml:"auth"`
	Storage   StorageConfig    `yaml:"storage"`
	Security  SecurityConfig   `yaml:"security"`
	Generate  GenerateConfig   `yaml:"generation"`
	Providers []ProviderConfig `yaml:"providers"`
}

type ServerConfig struct {
	Addr string `yaml:"addr"`
	// StaticDir serves the frontend from disk instead of the embedded build.
	StaticDir string `yaml:"static_dir"`
	// TrustedProxies is passed to gin so ClientIP() honours X-Forwarded-For.
	TrustedProxies []string `yaml:"trusted_proxies"`
	Mode           string   `yaml:"mode"` // debug | release
}

type DatabaseConfig struct {
	// Driver is one of sqlite, mysql, postgres.
	Driver string `yaml:"driver"`
	DSN    string `yaml:"dsn"`
	// LogLevel: silent | error | warn | info
	LogLevel string `yaml:"log_level"`
}

type AuthConfig struct {
	AllowRegistration bool          `yaml:"allow_registration"`
	SessionTTL        time.Duration `yaml:"session_ttl"`
	CookieSecure      bool          `yaml:"cookie_secure"`
	// Admin is created at startup when the users table is empty.
	Admin AdminSeed `yaml:"admin"`
}

type AdminSeed struct {
	Username string `yaml:"username"`
	Password string `yaml:"password"`
}

type StorageConfig struct {
	Dir string `yaml:"dir"`
	// MaxUploadMB caps every individual reference image.
	MaxUploadMB int `yaml:"max_upload_mb"`
}

type SecurityConfig struct {
	// SecretKey encrypts provider API keys at rest. When empty a random key is
	// generated and persisted to <storage.dir>/secret.key.
	SecretKey string `yaml:"secret_key"`
}

type GenerateConfig struct {
	Timeout time.Duration `yaml:"timeout"`
	// MaxConcurrentPerUser limits how many generations a user may run at once.
	MaxConcurrentPerUser int `yaml:"max_concurrent_per_user"`
}

// ProviderConfig declares a provider from the config file. Such providers are
// synchronised into the database on every start and are read-only in the UI.
type ProviderConfig struct {
	Key     string   `yaml:"key"`
	Name    string   `yaml:"name"`
	Type    string   `yaml:"type"` // openai | gemini
	BaseURL string   `yaml:"base_url"`
	APIKey  string   `yaml:"api_key"`
	Models  []string `yaml:"models"`
	Enabled *bool    `yaml:"enabled"`
}

func Default() *Config {
	return &Config{
		Server:   ServerConfig{Addr: ":8080", Mode: "release"},
		Database: DatabaseConfig{Driver: "sqlite", DSN: "data/app.db", LogLevel: "warn"},
		Auth: AuthConfig{
			AllowRegistration: true,
			SessionTTL:        30 * 24 * time.Hour,
		},
		Storage:  StorageConfig{Dir: "data", MaxUploadMB: 20},
		Generate: GenerateConfig{Timeout: 6 * time.Minute, MaxConcurrentPerUser: 6},
	}
}

// Load reads path (if it exists) on top of the defaults, then applies AIW_*
// environment overrides. A missing file is not an error unless explicit.
func Load(path string, explicit bool) (*Config, error) {
	cfg := Default()
	if path != "" {
		data, err := os.ReadFile(path)
		switch {
		case err == nil:
			// ${VAR} expansion lets secrets live in the environment.
			if err := yaml.Unmarshal(expandEnv(data), cfg); err != nil {
				return nil, fmt.Errorf("parse %s: %w", path, err)
			}
		case errors.Is(err, os.ErrNotExist) && !explicit:
		default:
			return nil, fmt.Errorf("read config: %w", err)
		}
	}
	applyEnv(cfg)
	if err := cfg.normalize(); err != nil {
		return nil, err
	}
	return cfg, nil
}

var envRef = regexp.MustCompile(`\$\{([A-Za-z_][A-Za-z0-9_]*)\}`)

// expandEnv replaces ${VAR} references only, so a bare "$" inside a value
// (for example in a password) is left untouched.
func expandEnv(data []byte) []byte {
	return envRef.ReplaceAllFunc(data, func(m []byte) []byte {
		return []byte(os.Getenv(string(m[2 : len(m)-1])))
	})
}

func applyEnv(c *Config) {
	str := func(key string, dst *string) {
		if v, ok := os.LookupEnv(key); ok {
			*dst = v
		}
	}
	boolean := func(key string, dst *bool) {
		if v, ok := os.LookupEnv(key); ok {
			if b, err := strconv.ParseBool(v); err == nil {
				*dst = b
			}
		}
	}
	str("AIW_ADDR", &c.Server.Addr)
	str("AIW_STATIC_DIR", &c.Server.StaticDir)
	str("AIW_DB_DRIVER", &c.Database.Driver)
	str("AIW_DB_DSN", &c.Database.DSN)
	str("AIW_STORAGE_DIR", &c.Storage.Dir)
	str("AIW_SECRET_KEY", &c.Security.SecretKey)
	str("AIW_ADMIN_USERNAME", &c.Auth.Admin.Username)
	str("AIW_ADMIN_PASSWORD", &c.Auth.Admin.Password)
	boolean("AIW_ALLOW_REGISTRATION", &c.Auth.AllowRegistration)
	boolean("AIW_COOKIE_SECURE", &c.Auth.CookieSecure)
}

func (c *Config) normalize() error {
	c.Database.Driver = strings.ToLower(strings.TrimSpace(c.Database.Driver))
	switch c.Database.Driver {
	case "sqlite", "sqlite3":
		c.Database.Driver = "sqlite"
	case "mysql", "mariadb":
		c.Database.Driver = "mysql"
	case "postgres", "postgresql", "pgsql", "pg":
		c.Database.Driver = "postgres"
	default:
		return fmt.Errorf("unsupported database driver %q (use sqlite, mysql or postgres)", c.Database.Driver)
	}
	if c.Database.DSN == "" {
		return errors.New("database.dsn is required")
	}
	if c.Storage.Dir == "" {
		c.Storage.Dir = "data"
	}
	if abs, err := filepath.Abs(c.Storage.Dir); err == nil {
		c.Storage.Dir = abs
	}
	if c.Storage.MaxUploadMB <= 0 {
		c.Storage.MaxUploadMB = 20
	}
	if c.Auth.SessionTTL <= 0 {
		c.Auth.SessionTTL = 30 * 24 * time.Hour
	}
	if c.Generate.Timeout <= 0 {
		c.Generate.Timeout = 6 * time.Minute
	}
	if c.Generate.MaxConcurrentPerUser <= 0 {
		c.Generate.MaxConcurrentPerUser = 6
	}
	seen := map[string]bool{}
	for i := range c.Providers {
		p := &c.Providers[i]
		p.Key = strings.TrimSpace(p.Key)
		p.Type = strings.ToLower(strings.TrimSpace(p.Type))
		if p.Key == "" {
			return fmt.Errorf("providers[%d].key is required", i)
		}
		if seen[p.Key] {
			return fmt.Errorf("duplicate provider key %q", p.Key)
		}
		seen[p.Key] = true
		if p.Type != "openai" && p.Type != "gemini" {
			return fmt.Errorf("provider %q: type must be openai or gemini", p.Key)
		}
		if p.Name == "" {
			p.Name = p.Key
		}
	}
	return nil
}
