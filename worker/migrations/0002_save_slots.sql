-- As migration 4 in internal/store/migrate.go: 造梦西游's saves moved into
-- six slots named "<slot>/<title>" (frontend/src/lib/save-slots.ts). Saves
-- from before go into slots 1, 2, … newest first, keeping their titles and
-- times.
UPDATE saves SET name = r.slot || '/' || saves.name
FROM (
	SELECT user_id, game, name,
	       ROW_NUMBER() OVER (PARTITION BY user_id, game ORDER BY updated_at DESC, name) AS slot
	FROM saves
	WHERE game IN ('zmxy-1', 'zmxy-2') AND name NOT GLOB '[1-6]/*'
) AS r
WHERE r.user_id = saves.user_id AND r.game = saves.game AND r.name = saves.name;
