import { Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { LoginPage } from "./features/auth/LoginPage.js";
import { RegisterPage } from "./features/auth/RegisterPage.js";
import { ChatLayout } from "./features/chat/ChatLayout.js";
import { SettingsPage } from "./features/settings/SettingsPage.js";
import { AdminPanel } from "./features/admin/AdminPanel.js";
import { useAuthStore } from "./stores/auth.js";
import { apiFetch } from "./lib/api.js";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  if (!accessToken) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

interface MeResponse {
  id: string;
  email: string;
  displayName: string;
}

export function App() {
  const setAuth = useAuthStore((s) => s.setAuth);
  const accessToken = useAuthStore((s) => s.accessToken);
  const [booting, setBooting] = useState(true);

  // Silent session restore: access token lives only in memory, so on a full
  // page reload we try the refresh cookie once to re-establish the session.
  useEffect(() => {
    if (accessToken) {
      setBooting(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const me = await apiFetch<MeResponse>("/auth/me");
        if (!cancelled) {
          setAuth(useAuthStore.getState().accessToken ?? "", me);
        }
      } catch {
        // no valid refresh cookie — stay logged out
      } finally {
        // Always clear the boot gate (idempotent), even if this effect
        // instance was cancelled by StrictMode's double-mount.
        setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (booting) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--text-dim)]">
        Ładowanie...
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/settings"
        element={
          <RequireAuth>
            <SettingsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/admin/*"
        element={
          <RequireAuth>
            <AdminPanel />
          </RequireAuth>
        }
      />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <ChatLayout />
          </RequireAuth>
        }
      />
    </Routes>
  );
}
