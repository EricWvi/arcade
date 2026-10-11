import { LogOut, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import logo from "@/assets/logo.png";
import type { User } from "@/lib/api";

export function SiteHeader({ user, onSignOut }: { user?: User; onSignOut: () => Promise<void> }) {
  return (
    <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
        <a href="/" className="mr-auto flex items-center gap-2.5">
          <img src={logo} alt="" className="size-8" />
          <span className="text-lg font-semibold tracking-tight">Arcade</span>
        </a>
        <label className="flex h-8 w-40 items-center gap-2 rounded-full bg-surface px-3 text-sm text-muted sm:w-64">
          <Search className="size-4 shrink-0" />
          <input type="search" placeholder="搜索游戏" className="w-full bg-transparent text-foreground outline-none placeholder:text-muted" />
        </label>
        {user && <UserMenu user={user} onSignOut={onSignOut} />}
      </div>
    </header>
  );
}

function UserMenu({ user, onSignOut }: { user: User; onSignOut: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const label = user.name || user.email;

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const signOut = async () => {
    setError("");
    try {
      await onSignOut();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="grid size-8 place-items-center rounded-full bg-surface text-sm font-semibold"
        aria-label={`账户（${label}）`}
        aria-expanded={open}
      >
        {label.slice(0, 1).toUpperCase()}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-56 rounded-xl border bg-background p-1.5 text-sm shadow-lg">
          <p className="truncate px-3 py-2 text-muted">{label}</p>
          <button onClick={signOut} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-surface">
            <LogOut className="size-4" />
            退出登录
          </button>
          {error && <p className="px-3 py-2 text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}
