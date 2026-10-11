package server

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"unicode"
	"unicode/utf8"

	"arcade/internal/auth"
)

// Limits on what a game may save. Flash allowed 100 KB per SharedObject
// by default, so these leave plenty of room.
const (
	maxSaveName  = 200
	maxSaveData  = 1 << 20
	maxSaveBatch = 64
	maxSaveBody  = 8 << 20
)

type savesBody struct {
	// Saves maps a save name to its data. In a PUT, null deletes the save.
	Saves map[string]*string `json:"saves"`
}

// getSaves returns the signed-in user's saves for a game.
func (s *server) getSaves(w http.ResponseWriter, r *http.Request) {
	key, ok := s.gameKey(w, r)
	if !ok {
		return
	}
	saves, err := s.opts.Store.Saves(r.Context(), auth.User(r.Context()).ID, key)
	if err != nil {
		slog.Error("read saves", "game", key, "err", err)
		writeError(w, http.StatusInternalServerError, "读取存档失败")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]map[string]string{"saves": saves})
}

// putSaves writes the saves named in the body and leaves the rest alone.
func (s *server) putSaves(w http.ResponseWriter, r *http.Request) {
	key, ok := s.gameKey(w, r)
	if !ok {
		return
	}
	var body savesBody
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxSaveBody)).Decode(&body); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeError(w, http.StatusRequestEntityTooLarge, "存档太大")
			return
		}
		writeError(w, http.StatusBadRequest, "存档格式不对")
		return
	}
	if len(body.Saves) == 0 || len(body.Saves) > maxSaveBatch {
		writeError(w, http.StatusBadRequest, "一次只能写 1 到 64 个存档")
		return
	}
	for name, data := range body.Saves {
		if !validSaveName(name) {
			writeError(w, http.StatusBadRequest, "存档名不合法")
			return
		}
		if data != nil && len(*data) > maxSaveData {
			writeError(w, http.StatusRequestEntityTooLarge, "存档太大")
			return
		}
	}
	if err := s.opts.Store.PutSaves(r.Context(), auth.User(r.Context()).ID, key, body.Saves); err != nil {
		slog.Error("write saves", "game", key, "err", err)
		writeError(w, http.StatusInternalServerError, "保存存档失败")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// gameKey returns the game in the path if games.yaml lists it.
func (s *server) gameKey(w http.ResponseWriter, r *http.Request) (string, bool) {
	key := r.PathValue("key")
	if _, ok := s.opts.Catalog.Games[key]; !ok {
		writeError(w, http.StatusNotFound, "游戏不存在")
		return "", false
	}
	return key, true
}

// validSaveName accepts printable text. Names come from the game (a
// SharedObject's name and path), so they are otherwise unrestricted.
func validSaveName(name string) bool {
	if name == "" || len(name) > maxSaveName || !utf8.ValidString(name) {
		return false
	}
	for _, r := range name {
		if !unicode.IsPrint(r) {
			return false
		}
	}
	return true
}
