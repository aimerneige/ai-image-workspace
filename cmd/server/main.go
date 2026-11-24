// Command server runs the AI Image Workspace.
//
//	server [-config config.yaml]                       start the web server
//	server [-config ...] user create <name> <password> [admin]
//	server [-config ...] user passwd <name> <password>
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"gorm.io/gorm"

	"github.com/aimerneige/ai-image-workspace/internal/api"
	"github.com/aimerneige/ai-image-workspace/internal/config"
	"github.com/aimerneige/ai-image-workspace/internal/database"
	"github.com/aimerneige/ai-image-workspace/internal/model"
	"github.com/aimerneige/ai-image-workspace/internal/secret"
	"github.com/aimerneige/ai-image-workspace/internal/service"
	"github.com/aimerneige/ai-image-workspace/internal/storage"
	"github.com/aimerneige/ai-image-workspace/internal/webui"
)

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, nil)))

	cfgPath := flag.String("config", "", "path to config file (default: $AIW_CONFIG or ./config.yaml)")
	showVersion := flag.Bool("version", false, "print version and exit")
	flag.Parse()
	if *showVersion {
		fmt.Println(api.Version)
		return
	}

	explicit := true
	if *cfgPath == "" {
		*cfgPath = os.Getenv("AIW_CONFIG")
	}
	if *cfgPath == "" {
		*cfgPath, explicit = "config.yaml", false
	}
	cfg, err := config.Load(*cfgPath, explicit)
	if err != nil {
		fatal("load config", err)
	}

	db, err := database.Open(cfg.Database)
	if err != nil {
		fatal("open database", err)
	}
	users := service.NewUsers(db, cfg.Auth.SessionTTL)

	if args := flag.Args(); len(args) > 0 {
		if err := runCLI(users, args); err != nil {
			fatal(args[0], err)
		}
		return
	}

	if err := serve(cfg, db, users); err != nil {
		fatal("server", err)
	}
}

func serve(cfg *config.Config, db *gorm.DB, users *service.Users) error {
	box, err := secret.LoadOrCreate(cfg.Security.SecretKey, cfg.Storage.Dir)
	if err != nil {
		return fmt.Errorf("init secret: %w", err)
	}
	store, err := storage.New(cfg.Storage.Dir)
	if err != nil {
		return fmt.Errorf("init storage: %w", err)
	}
	audit := service.NewAudit(db)
	providers := service.NewProviders(db, box)
	if err := providers.SyncConfig(cfg.Providers); err != nil {
		return fmt.Errorf("sync providers: %w", err)
	}
	if err := users.SeedAdmin(cfg.Auth.Admin.Username, cfg.Auth.Admin.Password); err != nil {
		return fmt.Errorf("seed admin: %w", err)
	}
	if n, _ := users.Count(); n == 0 && !cfg.Auth.AllowRegistration {
		slog.Warn("no users exist and registration is disabled: set auth.admin in the config or run `server user create <name> <password> admin`")
	}
	users.PurgeExpiredSessions()

	gens := service.NewGenerations(db, store, providers, audit, cfg.Generate.Timeout, cfg.Generate.MaxConcurrentPerUser)
	gens.RecoverInterrupted()

	var static fs.FS = webui.FS()
	if cfg.Server.StaticDir != "" {
		static = os.DirFS(cfg.Server.StaticDir)
	}
	if static == nil {
		slog.Warn("frontend is not embedded; build web/ first or set server.static_dir")
	}

	srv := api.New(api.Deps{
		Config: cfg, Users: users, Providers: providers, Generations: gens, Audit: audit, Store: store, Static: static,
	})
	httpSrv := &http.Server{
		Addr:              cfg.Server.Addr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 15 * time.Second,
	}

	go func() {
		t := time.NewTicker(6 * time.Hour)
		for range t.C {
			users.PurgeExpiredSessions()
		}
	}()

	errCh := make(chan error, 1)
	go func() {
		slog.Info("listening", "addr", cfg.Server.Addr, "db", cfg.Database.Driver, "version", api.Version)
		errCh <- httpSrv.ListenAndServe()
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	select {
	case err := <-errCh:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case s := <-sig:
		slog.Info("shutting down", "signal", s.String())
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(ctx)
	gens.Shutdown(ctx)
	return nil
}

func runCLI(users *service.Users, args []string) error {
	usage := errors.New("usage: server user create <name> <password> [admin] | server user passwd <name> <password>")
	if len(args) < 4 || args[0] != "user" {
		return usage
	}
	switch args[1] {
	case "create":
		role := model.RoleUser
		if len(args) > 4 && args[4] == "admin" {
			role = model.RoleAdmin
		}
		u, err := users.Create(args[2], args[3], role)
		if err != nil {
			return err
		}
		fmt.Printf("created %s user %q\n", u.Role, u.Username)
	case "passwd":
		id, err := users.IDByName(args[2])
		if err != nil {
			return err
		}
		if err := users.SetPassword(id, args[3]); err != nil {
			return err
		}
		users.DeleteSessionsFor(id, "")
		fmt.Printf("password updated for %q\n", args[2])
	default:
		return usage
	}
	return nil
}

func fatal(what string, err error) {
	slog.Error(what, "err", err)
	os.Exit(1)
}
