// Command arcade serves the arcade site and its API from a single process.
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
	"path/filepath"
	"syscall"
	"time"

	"arcade"
	"arcade/internal/auth"
	"arcade/internal/catalog"
	"arcade/internal/config"
	"arcade/internal/server"
	"arcade/internal/store"
)

// Set at build time with -ldflags "-X main.version=... -X main.commit=...".
var (
	version = "dev"
	commit  = "unknown"
)

func main() {
	configPath := flag.String("config", "config.yaml", "path to the YAML config file")
	showVersion := flag.Bool("version", false, "print version and exit")
	flag.Parse()

	if *showVersion {
		fmt.Printf("arcade %s (%s)\n", version, commit)
		return
	}
	if err := run(*configPath); err != nil {
		slog.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run(configPath string) error {
	cfg, err := config.Load(configPath)
	if err != nil {
		return err
	}
	// games.yaml sits next to the config file; restart to apply edits.
	catalogPath := filepath.Join(filepath.Dir(configPath), catalog.FileName)
	games, err := catalog.Load(catalogPath)
	if errors.Is(err, fs.ErrNotExist) {
		slog.Warn("no games catalogue: the home page shows no configured games", "path", catalogPath)
	} else if err != nil {
		return err
	}
	st, err := store.Open(cfg.Database)
	if err != nil {
		return err
	}
	defer st.Close()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if cfg.DevUser != "" {
		slog.Warn("dev_user is set: OIDC is disabled and every request is signed in as this user", "user", cfg.DevUser)
	}
	authn := auth.New(st, auth.Config{
		PublicURL:    cfg.PublicURL,
		Issuer:       cfg.OIDC.Issuer,
		ClientID:     cfg.OIDC.ClientID,
		ClientSecret: cfg.OIDC.ClientSecret,
		DevUser:      cfg.DevUser,
	})
	handler, err := server.New(authn, arcade.Frontend(), server.Options{Version: version, GamesDir: cfg.GamesDir, Catalog: games, Store: st})
	if err != nil {
		return err
	}
	srv := &http.Server{
		Addr:              cfg.Listen,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}

	errc := make(chan error, 1)
	go func() {
		slog.Info("listening", "addr", cfg.Listen, "database", cfg.Database, "games_dir", cfg.GamesDir, "version", version)
		errc <- srv.ListenAndServe()
	}()

	select {
	case err := <-errc:
		stop()
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	case <-ctx.Done():
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}
