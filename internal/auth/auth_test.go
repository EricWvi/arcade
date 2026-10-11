package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"arcade/internal/store"
)

func newService(t *testing.T, cfg Config) (*Service, http.Handler) {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "arcade.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	svc := New(st, cfg)
	mux := http.NewServeMux()
	svc.Register(mux)
	mux.Handle("GET /whoami", svc.Require(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(User(r.Context()))
	})))
	return svc, mux
}

func serve(h http.Handler, method, path string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(method, path, nil))
	return rec
}

func TestDevUserSignsEveryRequestIn(t *testing.T) {
	_, h := newService(t, Config{DevUser: "eric"})
	rec := serve(h, "GET", "/whoami")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var u store.User
	json.Unmarshal(rec.Body.Bytes(), &u)
	if u.Name != "eric" {
		t.Fatalf("user = %+v", u)
	}
	if rec := serve(h, "GET", "/auth/login"); rec.Code != http.StatusFound || rec.Header().Get("Location") != "/" {
		t.Fatalf("login: status = %d, location = %q", rec.Code, rec.Header().Get("Location"))
	}
}

func TestCallbackWithoutLoginCookieIsRejected(t *testing.T) {
	_, h := newService(t, Config{PublicURL: "https://arcade.test", Issuer: "https://idp.invalid", ClientID: "x", ClientSecret: "y"})
	rec := serve(h, "GET", "/auth/callback?code=c&state=s")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d", rec.Code)
	}
	for _, c := range rec.Result().Cookies() {
		if c.Name == sessionCookie {
			t.Fatalf("session cookie set: %+v", c)
		}
	}
}

func TestLoginReportsUnavailableProvider(t *testing.T) {
	_, h := newService(t, Config{
		PublicURL: "https://arcade.test", Issuer: "http://127.0.0.1:1", ClientID: "x", ClientSecret: "y",
	})
	if rec := serve(h, "GET", "/auth/login"); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d", rec.Code)
	}
}

func TestSessionCookieSignsInUntilLogout(t *testing.T) {
	svc, h := newService(t, Config{PublicURL: "https://arcade.test", Issuer: "https://idp.invalid", ClientID: "x", ClientSecret: "y"})
	ctx := t.Context()
	u, err := svc.store.UpsertUser(ctx, store.Identity{Issuer: "https://idp.invalid", Subject: "alice", Name: "Alice"})
	if err != nil {
		t.Fatal(err)
	}
	token, err := svc.store.CreateSession(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	withSession := func(method, path, origin string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, nil)
		req.AddCookie(&http.Cookie{Name: sessionCookie, Value: token})
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}

	if rec := serve(h, "GET", "/whoami"); rec.Code != http.StatusUnauthorized {
		t.Fatalf("without cookie: status = %d", rec.Code)
	}
	rec := withSession("GET", "/whoami", "")
	var got store.User
	json.Unmarshal(rec.Body.Bytes(), &got)
	if rec.Code != http.StatusOK || got.Name != "Alice" {
		t.Fatalf("with cookie: status = %d, user = %+v", rec.Code, got)
	}
	if rec := withSession("POST", "/auth/logout", "https://evil.test"); rec.Code != http.StatusForbidden {
		t.Fatalf("cross-origin logout: status = %d", rec.Code)
	}
	if rec := withSession("POST", "/auth/logout", "https://arcade.test"); rec.Code != http.StatusNoContent {
		t.Fatalf("logout: status = %d", rec.Code)
	}
	if rec := withSession("GET", "/whoami", ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("after logout: status = %d", rec.Code)
	}
}
