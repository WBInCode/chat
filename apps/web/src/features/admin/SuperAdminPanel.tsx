import { useEffect, useState } from "react";
import type { PlatformUserDto, PlatformOrgDto } from "@chatv2/shared";
import { apiFetch, ApiError } from "../../lib/api.js";
import { glassButtonGhost, glassButtonPrimary, glassInput } from "../../styles/glass.js";

const ROLE_OPTIONS = ["OWNER", "ADMIN", "HR", "MEMBER"] as const;

/**
 * Platform-level super-admin panel (F5-H). Only rendered/reachable for
 * accounts with `isSuperAdmin` (guarded in App.tsx routing) — operates
 * ACROSS every organization on the install, independent of the per-org
 * Admin Panel (features/admin/AdminPanel.tsx). Primary purpose: assign a
 * freshly self-registered user (who has zero memberships by design — see
 * PLAN.md) to an organization without needing a raw DB script.
 */
export function SuperAdminPanel() {
  const [users, setUsers] = useState<PlatformUserDto[]>([]);
  const [orgs, setOrgs] = useState<PlatformOrgDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null); // userId currently showing the assign form
  const [assignOrgId, setAssignOrgId] = useState("");
  const [assignRole, setAssignRole] = useState<(typeof ROLE_OPTIONS)[number]>("MEMBER");
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgSlug, setNewOrgSlug] = useState("");

  function reload() {
    void apiFetch<PlatformUserDto[]>("/platform/users")
      .then(setUsers)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Błąd"));
    void apiFetch<PlatformOrgDto[]>("/platform/orgs")
      .then(setOrgs)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Błąd"));
  }
  useEffect(reload, []);

  async function createOrg() {
    try {
      await apiFetch("/platform/orgs", {
        method: "POST",
        body: JSON.stringify({ name: newOrgName, slug: newOrgSlug })
      });
      setShowCreateOrg(false);
      setNewOrgName("");
      setNewOrgSlug("");
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Błąd tworzenia organizacji");
    }
  }

  async function assign(userId: string) {
    if (!assignOrgId) return;
    try {
      await apiFetch("/platform/memberships", {
        method: "POST",
        body: JSON.stringify({ userId, orgId: assignOrgId, role: assignRole })
      });
      setAssigning(null);
      setAssignOrgId("");
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Błąd przypisania");
    }
  }

  async function removeMembership(userId: string, orgId: string) {
    try {
      await apiFetch(`/platform/memberships/${userId}/${orgId}`, { method: "DELETE" });
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Błąd usuwania członkostwa");
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col gap-4 overflow-y-auto p-6">
      <div>
        <h1 className="text-lg font-semibold">Panel super-admina</h1>
        <p className="text-xs text-[var(--text-dim)]">
          Zarządzanie użytkownikami i organizacjami w całej instalacji — niezależnie od ról w konkretnej organizacji.
        </p>
      </div>

      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

      <section className="glass flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Organizacje ({orgs.length})</h2>
          <button onClick={() => setShowCreateOrg((v) => !v)} className={glassButtonGhost}>
            + Nowa organizacja
          </button>
        </div>
        {showCreateOrg && (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="text-xs text-[var(--text-dim)]">Nazwa</label>
              <input value={newOrgName} onChange={(e) => setNewOrgName(e.target.value)} className={glassInput} />
            </div>
            <div className="flex-1">
              <label className="text-xs text-[var(--text-dim)]">Slug</label>
              <input value={newOrgSlug} onChange={(e) => setNewOrgSlug(e.target.value)} className={glassInput} />
            </div>
            <button
              onClick={() => void createOrg()}
              disabled={newOrgName.trim().length < 2 || newOrgSlug.trim().length < 2}
              className={glassButtonPrimary}
            >
              Utwórz
            </button>
          </div>
        )}
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--glass-border)] text-left text-xs uppercase tracking-wide text-[var(--text-dim)]">
              <th className="pb-2">Nazwa</th>
              <th className="pb-2">Slug</th>
              <th className="pb-2">Członkowie</th>
              <th className="pb-2">Kanały</th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((o) => (
              <tr key={o.id} className="border-b border-[var(--glass-border)]/50">
                <td className="py-1.5">{o.name}</td>
                <td className="py-1.5 text-[var(--text-dim)]">{o.slug}</td>
                <td className="py-1.5">{o.memberCount}</td>
                <td className="py-1.5">{o.channelCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="glass flex flex-col gap-3 p-4">
        <h2 className="text-sm font-semibold">Użytkownicy ({users.length})</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--glass-border)] text-left text-xs uppercase tracking-wide text-[var(--text-dim)]">
              <th className="pb-2">Użytkownik</th>
              <th className="pb-2">Organizacje</th>
              <th className="pb-2 text-right">Akcje</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-[var(--glass-border)]/50 align-top">
                <td className="py-2">
                  <div className="font-medium">
                    {u.displayName} {u.isSuperAdmin && <span className="text-[var(--warning)]">★</span>}
                  </div>
                  <div className="text-xs text-[var(--text-dim)]">{u.email}</div>
                </td>
                <td className="py-2">
                  {u.memberships.length === 0 ? (
                    <span className="text-xs text-[var(--text-dim)]">brak organizacji</span>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {u.memberships.map((m) => (
                        <div key={m.orgId} className="flex items-center gap-2 text-xs">
                          <span className="rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-[var(--accent)]">
                            {m.orgName} · {m.role}
                          </span>
                          <button
                            onClick={() => void removeMembership(u.id, m.orgId)}
                            className="text-[var(--text-dim)] hover:text-[var(--danger)]"
                          >
                            usuń
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </td>
                <td className="py-2 text-right">
                  {assigning === u.id ? (
                    <div className="flex items-center justify-end gap-1">
                      <select
                        value={assignOrgId}
                        onChange={(e) => setAssignOrgId(e.target.value)}
                        className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass)] px-1.5 py-1 text-xs"
                      >
                        <option value="">Wybierz organizację…</option>
                        {orgs.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </select>
                      <select
                        value={assignRole}
                        onChange={(e) => setAssignRole(e.target.value as (typeof ROLE_OPTIONS)[number])}
                        className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass)] px-1.5 py-1 text-xs"
                      >
                        {ROLE_OPTIONS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      <button onClick={() => void assign(u.id)} disabled={!assignOrgId} className={glassButtonPrimary}>
                        OK
                      </button>
                      <button onClick={() => setAssigning(null)} className={glassButtonGhost}>
                        Anuluj
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setAssigning(u.id);
                        setAssignOrgId("");
                        setAssignRole("MEMBER");
                      }}
                      className={glassButtonGhost}
                    >
                      + Dodaj do organizacji
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
