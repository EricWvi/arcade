package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func write(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

const validOIDC = `
public_url: https://arcade.test
oidc:
  issuer: https://auth.test
  client_id: arcade
  client_secret: secret
`

func TestLoadRequiresAuthentication(t *testing.T) {
	_, err := Load(filepath.Join(t.TempDir(), "nope.yaml"))
	if err == nil || !strings.Contains(err.Error(), "public_url") {
		t.Fatalf("err = %v, want public_url error", err)
	}
}

func TestLoadOIDC(t *testing.T) {
	path := write(t, "listen: \":9000\"\n"+validOIDC)
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	want := Config{
		Listen:    ":9000",
		Database:  filepath.Join(filepath.Dir(path), "arcade.db"),
		GamesDir:  filepath.Join(filepath.Dir(path), "games"),
		PublicURL: "https://arcade.test",
		OIDC:      OIDC{Issuer: "https://auth.test", ClientID: "arcade", ClientSecret: "secret"},
	}
	if cfg != want {
		t.Fatalf("got %+v, want %+v", cfg, want)
	}
}

func TestLoadPaths(t *testing.T) {
	cfg, err := Load(write(t, "dev_user: eric\ndatabase: /var/lib/arcade.db\ngames_dir: /srv/games\n"))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Database != "/var/lib/arcade.db" || cfg.GamesDir != "/srv/games" {
		t.Fatalf("absolute paths = %q, %q", cfg.Database, cfg.GamesDir)
	}
	path := write(t, "dev_user: eric\ndatabase: db/arcade.db\ngames_dir: ../games\n")
	if cfg, err = Load(path); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Dir(path)
	if want := filepath.Join(dir, "db", "arcade.db"); cfg.Database != want {
		t.Fatalf("relative database = %q, want %q", cfg.Database, want)
	}
	if want := filepath.Join(filepath.Dir(dir), "games"); cfg.GamesDir != want {
		t.Fatalf("relative games_dir = %q, want %q", cfg.GamesDir, want)
	}
}

func TestLoadClientSecretFromEnv(t *testing.T) {
	t.Setenv(ClientSecretEnv, "from-env")
	cfg, err := Load(write(t, strings.Replace(validOIDC, "  client_secret: secret\n", "", 1)))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.OIDC.ClientSecret != "from-env" {
		t.Fatalf("secret = %q", cfg.OIDC.ClientSecret)
	}
}

func TestLoadDevUserNeedsNoOIDC(t *testing.T) {
	if _, err := Load(write(t, "dev_user: eric\n")); err != nil {
		t.Fatal(err)
	}
}

func TestLoadRejectsUnknownKeys(t *testing.T) {
	// A misplaced dev_user under oidc must not silently fall back to OIDC.
	_, err := Load(write(t, validOIDC+"  dev_user: eric\n"))
	if err == nil || !strings.Contains(err.Error(), "dev_user") {
		t.Fatalf("err = %v, want unknown dev_user error", err)
	}
}

func TestLoadRejectsInvalidValues(t *testing.T) {
	for _, content := range []string{
		"listen: \"\"\ndev_user: eric\n",
		"database: \"\"\ndev_user: eric\n",
		"games_dir: \"\"\ndev_user: eric\n",
		strings.Replace(validOIDC, "https://arcade.test", "https://arcade.test/sub", 1),
		strings.Replace(validOIDC, "https://arcade.test", "arcade.test", 1),
		strings.Replace(validOIDC, "  issuer: https://auth.test\n", "", 1),
	} {
		if _, err := Load(write(t, content)); err == nil {
			t.Errorf("expected error for:\n%s", content)
		}
	}
}
