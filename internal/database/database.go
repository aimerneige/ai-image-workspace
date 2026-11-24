// Package database opens the configured SQL database through GORM.
package database

import (
	"fmt"
	"log"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/aimerneige/ai-image-workspace/internal/config"
	"github.com/aimerneige/ai-image-workspace/internal/model"
)

// Open connects to the database (retrying for networked databases, which may
// still be starting under docker compose) and runs migrations.
func Open(cfg config.DatabaseConfig) (*gorm.DB, error) {
	dialector, err := dialectorFor(cfg)
	if err != nil {
		return nil, err
	}
	gcfg := &gorm.Config{Logger: logger.New(log.New(os.Stderr, "\n", log.LstdFlags), logger.Config{
		SlowThreshold:             time.Second,
		LogLevel:                  logLevel(cfg.LogLevel),
		IgnoreRecordNotFoundError: true, // misses are normal (e.g. expired sessions)
		Colorful:                  false,
	})}

	var db *gorm.DB
	attempts := 1
	if cfg.Driver != "sqlite" {
		attempts = 30
	}
	for i := 1; i <= attempts; i++ {
		db, err = gorm.Open(dialector, gcfg)
		if err == nil {
			var sqlDB interface{ Ping() error }
			if sqlDB, err = db.DB(); err == nil {
				err = sqlDB.Ping()
			}
		}
		if err == nil {
			break
		}
		if i < attempts {
			slog.Warn("database not ready, retrying", "attempt", i, "err", err)
			time.Sleep(2 * time.Second)
		}
	}
	if err != nil {
		return nil, fmt.Errorf("connect %s: %w", cfg.Driver, err)
	}

	sqlDB, _ := db.DB()
	if cfg.Driver == "sqlite" {
		// One writer at a time avoids SQLITE_BUSY under concurrent goroutines.
		sqlDB.SetMaxOpenConns(1)
	} else {
		sqlDB.SetMaxOpenConns(20)
		sqlDB.SetMaxIdleConns(5)
		sqlDB.SetConnMaxLifetime(time.Hour)
	}

	if err := db.AutoMigrate(model.All()...); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return db, nil
}

func dialectorFor(cfg config.DatabaseConfig) (gorm.Dialector, error) {
	switch cfg.Driver {
	case "sqlite":
		dsn := cfg.DSN
		if dsn != ":memory:" && !strings.HasPrefix(dsn, "file:") {
			path := dsn
			if i := strings.IndexByte(path, '?'); i >= 0 {
				path = path[:i]
			}
			if dir := filepath.Dir(path); dir != "" {
				if err := os.MkdirAll(dir, 0o755); err != nil {
					return nil, fmt.Errorf("create sqlite dir: %w", err)
				}
			}
		}
		if !strings.Contains(dsn, "_pragma") {
			sep := "?"
			if strings.Contains(dsn, "?") {
				sep = "&"
			}
			dsn += sep + "_pragma=busy_timeout(10000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)"
		}
		return sqlite.Open(dsn), nil
	case "mysql":
		// time.Time columns need parseTime; add it (and utf8mb4) when omitted.
		dsn := withParam(cfg.DSN, "parseTime", "true")
		dsn = withParam(dsn, "charset", "utf8mb4")
		return mysql.Open(dsn), nil
	case "postgres":
		return postgres.Open(cfg.DSN), nil
	}
	return nil, fmt.Errorf("unsupported driver %q", cfg.Driver)
}

// withParam appends key=value to a DSN query string unless key is present.
func withParam(dsn, key, value string) string {
	if strings.Contains(strings.ToLower(dsn), strings.ToLower(key)+"=") {
		return dsn
	}
	sep := "?"
	if strings.Contains(dsn, "?") {
		sep = "&"
	}
	return dsn + sep + key + "=" + value
}

func logLevel(s string) logger.LogLevel {
	switch strings.ToLower(s) {
	case "silent":
		return logger.Silent
	case "error":
		return logger.Error
	case "info":
		return logger.Info
	}
	return logger.Warn
}
