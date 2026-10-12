package server

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"regexp"

	"arcade/internal/auth"
	"arcade/internal/catalog"
	"arcade/internal/store"
)

// recentLimit is how many games the home page's recently played row shows.
const recentLimit = 6

// A play id is a UUID made by the page when a game starts.
var playID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

var viewportSize = regexp.MustCompile(`^[0-9]{1,5}x[0-9]{1,5}$`)

type playBody struct {
	Game         string `json:"game"`
	ActiveMS     int64  `json:"activeMs"`
	FullscreenMS int64  `json:"fullscreenMs"`
	Keys         int64  `json:"keys"`
	Clicks       int64  `json:"clicks"`
	SaveWrites   int64  `json:"saveWrites"`
	Muted        bool   `json:"muted"`
	Timezone     string `json:"timezone"`
	Viewport     string `json:"viewport"`
}

// putPlay records a play's running totals; see store.RecordPlay.
func (s *server) putPlay(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var body playBody
	if !playID.MatchString(id) || json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body) != nil {
		writeError(w, http.StatusBadRequest, "游玩记录格式不对")
		return
	}
	if _, ok := s.opts.Catalog.Games[body.Game]; !ok {
		writeError(w, http.StatusNotFound, "游戏不存在")
		return
	}
	if body.ActiveMS < 0 || body.FullscreenMS < 0 || body.Keys < 0 || body.Clicks < 0 || body.SaveWrites < 0 ||
		len(body.Timezone) > 64 || (body.Viewport != "" && !viewportSize.MatchString(body.Viewport)) {
		writeError(w, http.StatusBadRequest, "游玩记录格式不对")
		return
	}
	ua := r.UserAgent()
	if len(ua) > 512 {
		ua = ua[:512]
	}
	err := s.opts.Store.RecordPlay(r.Context(), auth.User(r.Context()).ID, store.Play{
		ID: id, Game: body.Game, ActiveMS: body.ActiveMS, FullscreenMS: body.FullscreenMS,
		Keys: body.Keys, Clicks: body.Clicks, SaveWrites: body.SaveWrites, Muted: body.Muted,
		Timezone: body.Timezone, Viewport: body.Viewport, UserAgent: ua,
	})
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusConflict, "游玩记录不属于这个游戏")
		return
	}
	if err != nil {
		slog.Error("record play", "game", body.Game, "err", err)
		writeError(w, http.StatusInternalServerError, "记录游玩失败")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type recentGame struct {
	catalog.ListedGame
	// LastPlayedAt is unix milliseconds; PlayedMS is active time over all plays.
	LastPlayedAt int64 `json:"lastPlayedAt"`
	PlayedMS     int64 `json:"playedMs"`
}

// getRecentPlays lists the user's most recently played games that are
// still in games.yaml.
func (s *server) getRecentPlays(w http.ResponseWriter, r *http.Request) {
	// Removed games are skipped, so ask for more than needed.
	played, err := s.opts.Store.RecentGames(r.Context(), auth.User(r.Context()).ID, 50)
	if err != nil {
		slog.Error("read recent plays", "err", err)
		writeError(w, http.StatusInternalServerError, "读取游玩记录失败")
		return
	}
	games := []recentGame{}
	for _, p := range played {
		if len(games) == recentLimit {
			break
		}
		if _, ok := s.opts.Catalog.Games[p.Game]; !ok {
			continue
		}
		games = append(games, recentGame{ListedGame: s.opts.Catalog.Describe(s.opts.GamesDir, p.Game), LastPlayedAt: p.LastPlayedAt, PlayedMS: p.ActiveMS})
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string][]recentGame{"games": games})
}
