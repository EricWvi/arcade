import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { describeSave } from "@/games";
import { api, type Game } from "@/lib/api";
import { catchFileDialogs, type LoadRequest, type SaveRequest } from "@/lib/file-saves";
import { timeAgo } from "@/lib/format";

type Dialog = { kind: "save"; request: SaveRequest } | { kind: "load"; request: LoadRequest };

/**
 * Save and load dialogs for a game that saves to files, shown over the
 * stage when the game asks. Saves live on the server under the names the
 * player gives them. onSaved runs after each successful save; onClose
 * returns the keyboard to the game.
 */
export function FileSaves({ game, onSaved, onClose }: { game: Game; onSaved: () => void; onClose: () => void }) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(
    () =>
      catchFileDialogs({
        onSave: (request) => setDialog({ kind: "save", request }),
        onLoad: (request) => setDialog({ kind: "load", request }),
      }),
    [],
  );

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const close = (message = "") => {
    setDialog(null);
    setNotice(message);
    onClose();
  };

  return (
    <>
      {notice && (
        <p className="absolute top-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-black/75 px-4 py-1.5 text-sm font-semibold text-white shadow-lg">
          {notice}
        </p>
      )}
      {dialog && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
          {dialog.kind === "save" ? (
            <SaveDialog
              game={game}
              request={dialog.request}
              onDone={(name) => {
                onSaved();
                close(`已保存「${name}」`);
              }}
              onCancel={() => close()}
            />
          ) : (
            <LoadDialog game={game} request={dialog.request} onDone={(message) => close(message)} />
          )}
        </div>
      )}
    </>
  );
}

/** The user's saves for game, newest first. */
function useSaves(game: Game) {
  const query = useQuery({ queryKey: ["saves", game.id], queryFn: () => api.saves(game.id) });
  const list = Object.entries(query.data?.saves ?? {})
    .map(([name, data]) => ({ name, data, updated: query.data?.updated[name] ?? 0 }))
    .sort((a, b) => b.updated - a.updated);
  return { ...query, list };
}

const validName = (name: string) => name.length > 0 && name.length <= 100 && !/[\p{Cc}]/u.test(name);

function SaveDialog({
  game,
  request,
  onDone,
  onCancel,
}: {
  game: Game;
  request: SaveRequest;
  onDone: (name: string) => void;
  onCancel: () => void;
}) {
  const saves = useSaves(game);
  const queryClient = useQueryClient();
  const [name, setName] = useState(() => describeSave[game.id]?.(request.data) ?? "存档");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const trimmed = name.trim();
  const overwrites = saves.list.some((s) => s.name === trimmed);

  const save = async () => {
    if (!validName(trimmed)) return setError("请输入 1 到 100 个字的存档名");
    setSaving(true);
    setError("");
    try {
      await api.putSaves(game.id, { [trimmed]: request.data });
      await queryClient.invalidateQueries({ queryKey: ["saves", game.id] });
      onDone(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
      setSaving(false);
    }
  };

  return (
    <Panel title="保存游戏" onEscape={onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="block text-sm font-semibold" htmlFor="save-name">
          存档名
        </label>
        <input
          id="save-name"
          autoFocus
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          onFocus={(e) => e.target.select()}
          className="mt-2 w-full rounded-xl border bg-surface px-3 py-2 outline-none focus:border-accent"
        />
        <p className={`mt-2 min-h-5 text-sm ${error ? "text-danger" : "text-muted"}`}>
          {error || (overwrites ? "将覆盖同名存档" : "")}
        </p>
        {saves.list.length > 0 && (
          <>
            <p className="mt-2 text-sm font-semibold">覆盖已有存档</p>
            <SaveList saves={saves.list} onPick={(s) => setName(s.name)} selected={trimmed} />
          </>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onCancel}>取消</Button>
          <Button primary type="submit" disabled={saving}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function LoadDialog({ game, request, onDone }: { game: Game; request: LoadRequest; onDone: (message?: string) => void }) {
  const saves = useSaves(game);
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const cancel = () => {
    request.cancel();
    onDone();
  };

  const remove = async (name: string) => {
    if (!window.confirm(`删除存档「${name}」？删除后无法恢复。`)) return;
    try {
      await api.putSaves(game.id, { [name]: null });
      await queryClient.invalidateQueries({ queryKey: ["saves", game.id] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  };

  // A file imported from disk is also kept on the server, under its name.
  const importFile = () => {
    request.browse((fileName, data) => {
      const name = fileName.replace(/\.[^.]*$/, "").trim().slice(0, 100) || "导入的存档";
      api
        .putSaves(game.id, { [name]: data })
        .then(() => queryClient.invalidateQueries({ queryKey: ["saves", game.id] }))
        .catch((err: unknown) => console.error("keep imported save", err));
    });
    onDone();
  };

  return (
    <Panel title="继续游戏" onEscape={cancel}>
      {saves.isPending ? (
        <p className="py-6 text-center text-sm text-muted">读取存档…</p>
      ) : saves.error ? (
        <p className="py-6 text-center text-sm text-danger">{saves.error.message}</p>
      ) : saves.list.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">还没有存档。在大地图点「保存游戏」即可存档。</p>
      ) : (
        <SaveList
          saves={saves.list}
          onPick={(s) => {
            request.pick(`${s.name}.json`, s.data);
            onDone(`已读取「${s.name}」`);
          }}
          onDelete={(s) => void remove(s.name)}
        />
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      <div className="mt-5 flex items-center justify-between gap-2">
        <button type="button" onClick={importFile} className="flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline">
          <Upload className="size-4" />
          从电脑导入存档文件
        </button>
        <Button onClick={cancel}>取消</Button>
      </div>
    </Panel>
  );
}

type SaveItem = { name: string; data: string; updated: number };

function SaveList({
  saves,
  onPick,
  onDelete,
  selected,
}: {
  saves: SaveItem[];
  onPick: (save: SaveItem) => void;
  onDelete?: (save: SaveItem) => void;
  selected?: string;
}) {
  return (
    <ul className="mt-2 max-h-60 space-y-1 overflow-y-auto">
      {saves.map((s) => (
        <li key={s.name} className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPick(s)}
            className={`min-w-0 flex-1 rounded-xl px-3 py-2 text-left hover:bg-surface ${selected === s.name ? "bg-surface" : ""}`}
          >
            <span className="block truncate font-semibold">{s.name}</span>
            <span className="block truncate text-xs text-muted">{timeAgo(s.updated)}保存</span>
          </button>
          {onDelete && (
            <button
              type="button"
              onClick={() => onDelete(s)}
              aria-label={`删除存档「${s.name}」`}
              className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-surface hover:text-danger"
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function Panel({ title, onEscape, children }: { title: string; onEscape: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  // Takes the keyboard from the game, unless a field already has it.
  useEffect(() => {
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus();
  }, []);
  return (
    <section
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-modal
      aria-label={title}
      onKeyDown={(e) => {
        // Keys stay in the dialog rather than reaching the game.
        e.stopPropagation();
        if (e.key === "Escape") onEscape();
      }}
      className="w-full max-w-sm rounded-3xl bg-background p-6 text-foreground shadow-2xl outline-none"
    >
      <h2 className="text-lg font-bold tracking-tight">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Button({
  primary,
  type = "button",
  disabled,
  onClick,
  children,
}: {
  primary?: boolean;
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full px-4 py-1.5 text-sm font-bold disabled:opacity-60 ${primary ? "bg-accent text-white" : "bg-pill text-accent"}`}
    >
      {children}
    </button>
  );
}
