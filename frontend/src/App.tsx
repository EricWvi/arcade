import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { RecentlyPlayed } from "@/components/recently-played";
import { Shelf } from "@/components/shelf";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { mockShelves, recentlyPlayed } from "@/data/home";
import { api, goToLogin, logout } from "@/lib/api";

export function App() {
  const [signedOut, setSignedOut] = useState(false);
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, staleTime: Infinity, enabled: !signedOut });
  const catalog = useQuery({ queryKey: ["catalog"], queryFn: api.catalog, enabled: !signedOut });

  if (signedOut) {
    return (
      <main className="grid min-h-svh place-items-center p-4 text-center">
        <div className="space-y-4">
          <p>已退出登录</p>
          <button onClick={goToLogin} className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-white">
            登录
          </button>
        </div>
      </main>
    );
  }

  const signOut = async () => {
    await logout();
    setSignedOut(true);
  };

  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader user={me.data} onSignOut={signOut} />
      <main className="mx-auto w-full max-w-7xl flex-1 space-y-10 px-4 pt-6 sm:px-6 lg:px-8">
        <RecentlyPlayed games={recentlyPlayed} />
        {catalog.error && <p className="text-sm text-danger">{catalog.error.message}</p>}
        {/* Mock shelves wait for the catalogue so the configured ones never jump in above them. */}
        {!catalog.isPending && [...(catalog.data?.shelves ?? []), ...mockShelves].map((s) => <Shelf key={s.id} shelf={s} />)}
      </main>
      <SiteFooter />
    </div>
  );
}
