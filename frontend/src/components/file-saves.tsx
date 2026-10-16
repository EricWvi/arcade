import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { describeSave } from "@/games";
import { api, type Game } from "@/lib/api";
import { catchFileDialogs, type LoadRequest, type SaveRequest } from "@/lib/file-saves";
import { dateTime } from "@/lib/format";
import { maxTitle, type SlotSave, toSlots, validTitle, writeSlot } from "@/lib/save-slots";

type Dialog = { kind: "save"; request: SaveRequest } | { kind: "load"; request: LoadRequest };

/**
 * Save and load dialogs for a game that saves to files, shown over the
 * stage when the game asks. Saves live on the server in six slots; see
 * lib/save-slots.ts. onSaved runs after each successful save; onClose
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

/** The user's saves for game, in their slots. */
function useSlots(game: Game) {
  const query = useQuery({ queryKey: ["saves", game.id], queryFn: () => api.saves(game.id) });
  const slots = query.data ? toSlots(query.data.saves, query.data.updated) : [];
  return { ...query, slots };
}

function SaveDialog({
  game,
  request,
  onDone,
  onCancel,
}: {
  game: Game;
  request: SaveRequest;
  onDone: (title: string) => void;
  onCancel: () => void;
}) {
  const saves = useSlots(game);
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(() => describeSave[game.id]?.(request.data) ?? "存档");
  // The player always picks the slot; none is chosen for them.
  const [slot, setSlot] = useState(-1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const trimmed = title.trim();
  const replaces = slot >= 0 ? saves.slots[slot] : undefined;

  const save = async () => {
    if (!validTitle(trimmed)) return setError(`请输入 1 到 ${maxTitle} 个字的存档名`);
    if (slot < 0) return setError("请选择要保存到的位置");
    setSaving(true);
    setError("");
    try {
      await api.putSaves(game.id, writeSlot(saves.slots, slot, trimmed, request.data));
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
          value={title}
          maxLength={maxTitle}
          onChange={(e) => setTitle(e.target.value)}
          onFocus={(e) => e.target.select()}
          className="mt-2 w-full rounded-xl border bg-surface px-3 py-2 outline-none focus:border-accent"
        />
        <SlotView saves={saves} selected={slot} onPick={setSlot} />
        <p className={`mt-2 min-h-5 text-sm ${error ? "text-danger" : "text-muted"}`}>
          {error || (slot < 0 ? "选择要保存到的位置" : replaces ? `将覆盖「${replaces.title}」` : "")}
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <Button onClick={onCancel}>取消</Button>
          <Button primary type="submit" disabled={saving || slot < 0}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function LoadDialog({ game, request, onDone }: { game: Game; request: LoadRequest; onDone: (message?: string) => void }) {
  const saves = useSlots(game);
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const cancel = () => {
    request.cancel();
    onDone();
  };

  const remove = async (save: SlotSave) => {
    if (!window.confirm(`删除存档「${save.title}」？删除后无法恢复。`)) return;
    try {
      await api.putSaves(game.id, { [save.name]: null });
      await queryClient.invalidateQueries({ queryKey: ["saves", game.id] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  };

  // A file imported from disk is also kept on the server, in the first
  // empty slot, under its name.
  const importFile = () => {
    const slots = saves.slots;
    request.browse((fileName, data) => {
      const slot = slots.findIndex((s) => !s);
      if (slot < 0) return;
      const title = fileName.replace(/\.[^.]*$/, "").trim().slice(0, maxTitle) || "导入的存档";
      api
        .putSaves(game.id, writeSlot(slots, slot, title, data))
        .then(() => queryClient.invalidateQueries({ queryKey: ["saves", game.id] }))
        .catch((err: unknown) => console.error("keep imported save", err));
    });
    onDone();
  };

  return (
    <Panel title="继续游戏" onEscape={cancel}>
      <SlotView
        saves={saves}
        onPick={(i) => {
          const save = saves.slots[i];
          if (!save) return;
          request.pick(`${save.title}.json`, save.data);
          onDone(`已读取「${save.title}」`);
        }}
        onDelete={(save) => void remove(save)}
      />
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

/**
 * The slots in two columns of three, slot 1 at the top left. Without
 * onDelete the dialog is saving, so empty slots can be picked too.
 */
function SlotView({
  saves,
  selected,
  onPick,
  onDelete,
}: {
  saves: ReturnType<typeof useSlots>;
  selected?: number;
  onPick: (slot: number) => void;
  onDelete?: (save: SlotSave) => void;
}) {
  if (saves.isPending) return <p className="py-6 text-center text-sm text-muted">读取存档…</p>;
  if (saves.error) return <p className="py-6 text-center text-sm text-danger">{saves.error.message}</p>;
  return (
    <ol className="mt-4 grid grid-flow-col grid-cols-2 grid-rows-3 gap-2">
      {saves.slots.map((save, i) => (
        <li key={i} className="relative">
          <button
            type="button"
            disabled={!save && !!onDelete}
            onClick={() => onPick(i)}
            aria-pressed={selected === undefined ? undefined : selected === i}
            className={`h-full w-full rounded-xl border px-3 py-2 text-left hover:bg-surface disabled:hover:bg-transparent ${
              selected === i ? "border-accent bg-surface" : ""
            } ${save && onDelete ? "pr-9" : ""}`}
          >
            <span className="block text-xs text-muted">存档 {i + 1}</span>
            {save ? (
              <>
                <span className="block truncate font-semibold">{save.title}</span>
                <span className="block text-xs text-muted tabular-nums">{dateTime(save.updated)}</span>
              </>
            ) : (
              <span className="block py-2 text-sm text-muted">无存档</span>
            )}
          </button>
          {save && onDelete && (
            <button
              type="button"
              onClick={() => onDelete(save)}
              aria-label={`删除存档「${save.title}」`}
              className="absolute top-1 right-1 grid size-8 place-items-center rounded-full text-muted hover:bg-pill hover:text-danger"
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </li>
      ))}
    </ol>
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
      className="w-full max-w-md rounded-3xl bg-background p-6 text-foreground shadow-2xl outline-none"
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
