import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { api, goToLogin, logout } from "@/lib/api";

export function App() {
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState("");
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
    try {
      await logout();
      setSignedOut(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <main className="grid min-h-svh place-items-center p-4 text-center">
      {me.error ? (
        <p className="text-sm text-danger">{me.error.message}</p>
      ) : me.data ? (
        <div className="space-y-4">
          <p className="text-2xl font-medium">Hello, {me.data.name || me.data.email || "World"}!</p>
          <button onClick={signOut} className="text-sm font-semibold text-accent">
            退出登录
          </button>
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
      ) : null}
    </main>
  );
}
