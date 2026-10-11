import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Route, Switch } from "wouter";

import { SiteHeader } from "@/components/site-header";
import { api, goToLogin, logout } from "@/lib/api";
import { GamePage } from "@/pages/game";
import { HomePage } from "@/pages/home";
import { NotFound } from "@/pages/not-found";

export function App() {
  const [signedOut, setSignedOut] = useState(false);
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, staleTime: Infinity, enabled: !signedOut });

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
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/games/:id">{(params) => <GamePage key={params.id} id={params.id} />}</Route>
        <Route>
          <NotFound />
        </Route>
      </Switch>
    </div>
  );
}
