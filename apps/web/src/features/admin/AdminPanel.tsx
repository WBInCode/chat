import { useEffect, useState } from "react";
import { NavLink, Route, Routes, Navigate } from "react-router-dom";
import type {
  AdminMemberDto,
  AdminChannelDto,
  AuditLogEntryDto,
  AdminDashboardDto,
  AdminModuleDto,
  ModuleKey,
  OrgRole,
  RoleDto,
  OrgPermission,
  IntegrationWebhookDto
} from "@chatv2/shared";
import { ORG_PERMISSIONS } from "@chatv2/shared";
import { apiFetch, ApiError } from "../../lib/api.js";
import { useModulesStore } from "../../stores/modules.js";
import { glassButtonGhost, glassButtonPrimary, glassInput } from "../../styles/glass.js";

interface OrgItem {
  id: string;
  name: string;
  slug: string;
  role: OrgRole;
}

/** Shape of GET /orgs/:id/admin/analytics (F6-I). */
interface WorkspaceAnalytics {
  memberCount: number;
  channelCount: number;
  totalMessages: number;
  messages7d: number;
  activeMembers7d: number;
  dailyMessages: { date: string; count: number }[];
  topChannels: { channelId: string; name: string; messageCount: number }[];
}

/** Top-level admin shell: org picker + tab navigation (own routes). */
export function AdminPanel() {
  const [orgs, setOrgs] = useState<OrgItem[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);

  useEffect(() => {
    void apiFetch<OrgItem[]>("/orgs").then((data) => {
      setOrgs(data);
      const manageable = data.find((o) => o.role === "OWNER" || o.role === "ADMIN" || o.role === "HR");
      setActiveOrgId(manageable?.id ?? data[0]?.id ?? null);
    });
  }, []);

  if (!activeOrgId) {
    return <p className="p-6 text-sm text-[var(--text-dim)]">Ładowanie organizacji...</p>;
  }

  const org = orgs.find((o) => o.id === activeOrgId);

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Panel administracyjny</h1>
          <p className="text-xs text-[var(--text-dim)]">
            {org?.name} · rola: {org?.role}
          </p>
        </div>
        <NavLink to="/" className={glassButtonGhost}>
          ← Wróć do czatu
        </NavLink>
      </div>

      <nav className="glass flex w-fit gap-1 p-1">
        {[
          { to: "members", label: "Członkowie" },
          { to: "roles", label: "Role" },
          { to: "channels", label: "Kanały" },
          { to: "modules", label: "Moduły" },
          { to: "integrations", label: "Integracje" },
          { to: "audit", label: "Audit log" },
          { to: "settings", label: "Ustawienia" },
          { to: "dashboard", label: "Dashboard" }
        ].map((tab) => (
          <NavLink
            key={tab.to}
            to={`/admin/${tab.to}`}
            className={({ isActive }) =>
              `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-[var(--accent)]/15 text-[var(--accent)]"
                  : "text-[var(--text-dim)] hover:bg-[var(--border)]/50"
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <div className="glass flex-1 overflow-y-auto p-5">
        <Routes>
          <Route path="members" element={<MembersTab orgId={activeOrgId} viewerRole={org?.role ?? "MEMBER"} />} />
          <Route path="roles" element={<RolesTab orgId={activeOrgId} viewerRole={org?.role ?? "MEMBER"} />} />
          <Route path="channels" element={<ChannelsTab orgId={activeOrgId} />} />
          <Route path="modules" element={<ModulesTab orgId={activeOrgId} />} />
          <Route path="integrations" element={<IntegrationsTab orgId={activeOrgId} />} />
          <Route path="audit" element={<AuditTab orgId={activeOrgId} />} />
          <Route path="settings" element={<SettingsTab orgId={activeOrgId} />} />
          <Route path="dashboard" element={<DashboardTab orgId={activeOrgId} />} />
          <Route path="*" element={<Navigate to="members" replace />} />
        </Routes>
      </div>
    </div>
  );
}

// ── Members ────────────────────────────────────────────────────────────
function MembersTab({ orgId, viewerRole }: { orgId: string; viewerRole: OrgRole }) {
  const [members, setMembers] = useState<AdminMemberDto[]>([]);
  const [roles, setRoles] = useState<RoleDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);

  function reload() {
    void apiFetch<AdminMemberDto[]>(`/orgs/${orgId}/admin/members`)
      .then(setMembers)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Błąd"));
    if (viewerRole === "OWNER") {
      void apiFetch<RoleDto[]>(`/orgs/${orgId}/roles`)
        .then(setRoles)
        .catch(() => setRoles([]));
    }
  }

  useEffect(reload, [orgId]);

  async function changeRole(userId: string, role: string) {
    try {
      await apiFetch(`/orgs/${orgId}/admin/members/${userId}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role })
      });
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Błąd zmiany roli");
    }
  }

  async function changeCustomRole(userId: string, roleId: string | null) {
    try {
      await apiFetch(`/orgs/${orgId}/admin/members/${userId}/custom-role`, {
        method: "PATCH",
        body: JSON.stringify({ roleId })
      });
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Błąd zmiany roli niestandardowej");
    }
  }

  async function toggleDeactivate(userId: string, disabled: boolean) {
    try {
      await apiFetch(`/orgs/${orgId}/admin/members/${userId}/deactivate`, {
        method: "PATCH",
        body: JSON.stringify({ disabled })
      });
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Błąd deaktywacji");
    }
  }

  async function requestExport(userId: string) {
    setExportingId(userId);
    try {
      const created = await apiFetch<{ id: string; status: string; downloadUrl: string | null }>(
        `/orgs/${orgId}/admin/members/${userId}/export`,
        { method: "POST" }
      );
      const poll = setInterval(async () => {
        const updated = await apiFetch<{ id: string; status: string; downloadUrl: string | null }>(
          `/orgs/${orgId}/admin/exports/${created.id}`
        );
        if (updated.status !== "PENDING") {
          clearInterval(poll);
          setExportingId(null);
          if (updated.status === "READY" && updated.downloadUrl) {
            window.open(updated.downloadUrl, "_blank", "noopener");
          } else {
            setError("Eksport danych członka nie powiódł się");
          }
        }
      }, 2000);
    } catch (e) {
      setExportingId(null);
      setError(e instanceof ApiError ? e.message : "Błąd eksportu danych");
    }
  }

  if (error) return <p className="text-sm text-[var(--danger)]">{error}</p>;

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-[var(--glass-border)] text-left text-xs uppercase tracking-wide text-[var(--text-dim)]">
          <th className="pb-2">Użytkownik</th>
          <th className="pb-2">Rola</th>
          {viewerRole === "OWNER" && <th className="pb-2">Rola niestandardowa</th>}
          <th className="pb-2">2FA</th>
          <th className="pb-2">Status</th>
          <th className="pb-2 text-right">Akcje</th>
        </tr>
      </thead>
      <tbody>
        {members.map((m) => (
          <tr key={m.userId} className="border-b border-[var(--glass-border)]/50">
            <td className="py-2">
              <div className="font-medium">{m.displayName}</div>
              <div className="text-xs text-[var(--text-dim)]">{m.email}</div>
            </td>
            <td>
              {m.role === "OWNER" ? (
                <span className="text-xs font-medium text-[var(--warning)]">OWNER</span>
              ) : (
                <select
                  value={m.role}
                  onChange={(e) => changeRole(m.userId, e.target.value)}
                  className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass)] px-2 py-1 text-xs"
                >
                  <option value="ADMIN">ADMIN</option>
                  <option value="HR">HR</option>
                  <option value="MEMBER">MEMBER</option>
                </select>
              )}
            </td>
            {viewerRole === "OWNER" && (
              <td>
                <select
                  value={m.customRoleId ?? ""}
                  onChange={(e) => changeCustomRole(m.userId, e.target.value || null)}
                  className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass)] px-2 py-1 text-xs"
                >
                  <option value="">— brak —</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </td>
            )}
            <td className="text-xs">{m.totpEnabled ? "✅" : "—"}</td>
            <td className="text-xs">
              {m.disabled ? (
                <span className="text-[var(--danger)]">Zdezaktywowany</span>
              ) : (
                <span className="text-[var(--accent-2)]">Aktywny</span>
              )}
            </td>
            <td className="text-right">
              <div className="flex justify-end gap-1">
                {viewerRole === "OWNER" && (
                  <button
                    onClick={() => requestExport(m.userId)}
                    disabled={exportingId === m.userId}
                    className="rounded-lg px-2 py-1 text-xs text-[var(--text-dim)] transition-colors hover:bg-[var(--border)]/50"
                    title="Eksportuj dane RODO tego członka"
                  >
                    {exportingId === m.userId ? "Eksport…" : "⬇ Eksport"}
                  </button>
                )}
                {m.role !== "OWNER" && (
                  <button
                    onClick={() => toggleDeactivate(m.userId, !m.disabled)}
                    className="rounded-lg px-2 py-1 text-xs text-[var(--text-dim)] transition-colors hover:bg-[var(--border)]/50"
                  >
                    {m.disabled ? "Aktywuj" : "Deaktywuj"}
                  </button>
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Roles (F5-C custom roles) ────────────────────────────────────────────
const PERMISSION_GROUPS: { label: string; permissions: OrgPermission[] }[] = [
  { label: "Członkowie", permissions: ["member.invite", "member.remove", "member.changeRole", "member.deactivate"] },
  { label: "Kanały", permissions: ["channel.manage", "channel.create"] },
  {
    label: "Organizacja",
    permissions: ["org.settings", "org.auditLog", "org.auditLogFull", "org.export", "org.transferOwnership", "role.manage"]
  },
  { label: "AI", permissions: ["ai.use"] },
  { label: "Głos", permissions: ["voice.use"] }
];

const PERMISSION_LABELS: Record<OrgPermission, string> = {
  "member.invite": "Zapraszanie członków",
  "member.remove": "Usuwanie członków",
  "member.changeRole": "Zmiana ról",
  "member.deactivate": "Deaktywacja członków",
  "channel.manage": "Zarządzanie kanałami (rename/archiwizacja)",
  "channel.create": "Tworzenie kanałów",
  "org.settings": "Ustawienia organizacji",
  "org.auditLog": "Podgląd audit logu",
  "org.auditLogFull": "Pełny audit log (w tym adminów)",
  "org.export": "Eksport danych RODO",
  "org.transferOwnership": "Przeniesienie własności",
  "role.manage": "Zarządzanie rolami",
  "ai.use": "Korzystanie z asystenta AI",
  "voice.use": "Korzystanie z rozmów głosowych"
};

function RolesTab({ orgId, viewerRole }: { orgId: string; viewerRole: OrgRole }) {
  const [roles, setRoles] = useState<RoleDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftColor, setDraftColor] = useState("#8b5cf6");
  const [draftPermissions, setDraftPermissions] = useState<Set<OrgPermission>>(new Set());

  function reload() {
    void apiFetch<RoleDto[]>(`/orgs/${orgId}/roles`)
      .then(setRoles)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Błąd"));
  }
  useEffect(reload, [orgId]);

  if (viewerRole !== "OWNER") {
    return <p className="text-sm text-[var(--text-dim)]">Tylko właściciel organizacji może zarządzać rolami.</p>;
  }

  function startCreate() {
    setEditingId("new");
    setDraftName("");
    setDraftColor("#8b5cf6");
    setDraftPermissions(new Set());
  }

  function startEdit(role: RoleDto) {
    setEditingId(role.id);
    setDraftName(role.name);
    setDraftColor(role.color);
    setDraftPermissions(new Set(role.permissions));
  }

  function togglePermission(p: OrgPermission) {
    setDraftPermissions((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  async function save() {
    try {
      const payload = { name: draftName, color: draftColor, permissions: [...draftPermissions] };
      if (editingId === "new") {
        await apiFetch(`/orgs/${orgId}/roles`, { method: "POST", body: JSON.stringify(payload) });
      } else if (editingId) {
        await apiFetch(`/orgs/${orgId}/roles/${editingId}`, { method: "PATCH", body: JSON.stringify(payload) });
      }
      setEditingId(null);
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Błąd zapisu roli");
    }
  }

  async function remove(roleId: string) {
    try {
      await apiFetch(`/orgs/${orgId}/roles/${roleId}`, { method: "DELETE" });
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Nie można usunąć roli (być może jest przypisana)");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

      {editingId ? (
        <div className="glass flex flex-col gap-3 p-4">
          <h2 className="text-sm font-semibold">{editingId === "new" ? "Nowa rola" : "Edytuj rolę"}</h2>
          <div className="flex items-center gap-3">
            <input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="np. Moderator"
              className={`${glassInput} flex-1`}
            />
            <input
              type="color"
              value={draftColor}
              onChange={(e) => setDraftColor(e.target.value)}
              className="h-9 w-12 cursor-pointer rounded-lg border border-[var(--glass-border)] bg-transparent"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            {PERMISSION_GROUPS.map((group) => (
              <div key={group.label}>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--text-dim)]">
                  {group.label}
                </div>
                <div className="flex flex-col gap-1">
                  {group.permissions.map((p) => (
                    <label key={p} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={draftPermissions.has(p)}
                        onChange={() => togglePermission(p)}
                      />
                      {PERMISSION_LABELS[p]}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditingId(null)} className={glassButtonGhost}>
              Anuluj
            </button>
            <button onClick={() => void save()} disabled={draftName.trim().length < 2} className={glassButtonPrimary}>
              Zapisz
            </button>
          </div>
        </div>
      ) : (
        <button onClick={startCreate} className={`${glassButtonPrimary} w-fit`}>
          + Nowa rola
        </button>
      )}

      <div className="flex flex-col gap-2">
        {roles.map((r) => (
          <div key={r.id} className="glass flex items-center justify-between p-3">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: r.color }} />
              <span className="text-sm font-medium">{r.name}</span>
              <span className="text-xs text-[var(--text-dim)]">
                {r.memberCount} {r.memberCount === 1 ? "członek" : "członków"}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => startEdit(r)}
                className="rounded-lg px-2 py-1 text-xs text-[var(--text-dim)] transition-colors hover:bg-[var(--border)]/50"
              >
                Edytuj
              </button>
              <button
                onClick={() => void remove(r.id)}
                disabled={r.memberCount > 0}
                title={r.memberCount > 0 ? "Odepnij rolę od wszystkich członków przed usunięciem" : undefined}
                className="rounded-lg px-2 py-1 text-xs text-[var(--danger)] transition-colors hover:bg-[var(--border)]/50 disabled:opacity-40"
              >
                Usuń
              </button>
            </div>
          </div>
        ))}
        {roles.length === 0 && <p className="text-sm text-[var(--text-dim)]">Brak niestandardowych ról.</p>}
      </div>
    </div>
  );
}

// ── Channels ───────────────────────────────────────────────────────────
function ChannelsTab({ orgId }: { orgId: string }) {
  const [channels, setChannels] = useState<AdminChannelDto[]>([]);

  function reload() {
    void apiFetch<AdminChannelDto[]>(`/orgs/${orgId}/admin/channels`).then(setChannels);
  }
  useEffect(reload, [orgId]);

  async function toggleArchive(channelId: string) {
    await apiFetch(`/orgs/${orgId}/admin/channels/${channelId}/archive`, { method: "PATCH" });
    reload();
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-[var(--glass-border)] text-left text-xs uppercase tracking-wide text-[var(--text-dim)]">
          <th className="pb-2">Kanał</th>
          <th className="pb-2">Typ</th>
          <th className="pb-2">Członkowie</th>
          <th className="pb-2">Status</th>
          <th className="pb-2 text-right">Akcje</th>
        </tr>
      </thead>
      <tbody>
        {channels.map((c) => (
          <tr key={c.id} className="border-b border-[var(--glass-border)]/50">
            <td className="py-2 font-medium">{c.name ?? "—"}</td>
            <td className="text-xs">{c.type === "PRIVATE" ? "🔒 prywatny" : "# publiczny"}</td>
            <td className="text-xs">{c.memberCount}</td>
            <td className="text-xs">{c.archived ? "Zarchiwizowany" : "Aktywny"}</td>
            <td className="text-right">
              <button
                onClick={() => toggleArchive(c.id)}
                className="rounded-lg px-2 py-1 text-xs text-[var(--text-dim)] transition-colors hover:bg-[var(--border)]/50"
              >
                {c.archived ? "Przywróć" : "Archiwizuj"}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Audit log ──────────────────────────────────────────────────────────
function AuditTab({ orgId }: { orgId: string }) {
  const [entries, setEntries] = useState<AuditLogEntryDto[]>([]);
  const [verified, setVerified] = useState<boolean | null>(null);

  useEffect(() => {
    void apiFetch<{ entries: AuditLogEntryDto[] }>(`/orgs/${orgId}/admin/audit`).then((d) =>
      setEntries(d.entries)
    );
    void apiFetch<{ valid: boolean }>(`/orgs/${orgId}/admin/audit/verify`).then((d) =>
      setVerified(d.valid)
    );
  }, [orgId]);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-xs">
        <span className="text-[var(--text-dim)]">Integralność łańcucha:</span>
        {verified === null ? (
          <span className="text-[var(--text-dim)]">sprawdzanie...</span>
        ) : verified ? (
          <span className="font-medium text-[var(--accent-2)]">✓ nienaruszona</span>
        ) : (
          <span className="font-medium text-[var(--danger)]">✗ WYKRYTO NARUSZENIE</span>
        )}
      </div>
      <ul className="space-y-2">
        {entries.map((e) => (
          <li
            key={e.id}
            className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass)] p-2.5 text-xs"
          >
            <div className="flex justify-between">
              <span className="font-medium">{e.action}</span>
              <span className="text-[var(--text-dim)]">
                {new Date(e.createdAt).toLocaleString("pl-PL")}
              </span>
            </div>
            <div className="mt-0.5 text-[var(--text-dim)]">
              {e.actorName ?? "system"} {e.ip ? `· ${e.ip}` : ""}
            </div>
          </li>
        ))}
        {entries.length === 0 && (
          <p className="text-xs text-[var(--text-dim)]">Brak zdarzeń.</p>
        )}
      </ul>
    </div>
  );
}

// ── Settings ───────────────────────────────────────────────────────────
function SettingsTab({ orgId }: { orgId: string }) {
  const [require2fa, setRequire2fa] = useState(false);
  const [retention, setRetention] = useState<string>("");
  const [domains, setDomains] = useState<string>("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void apiFetch<{
      require2fa: boolean;
      messageRetentionDays: number | null;
      allowedEmailDomains: string | null;
    }>(`/orgs/${orgId}/admin/settings`).then((d) => {
      setRequire2fa(d.require2fa);
      setRetention(d.messageRetentionDays?.toString() ?? "");
      setDomains(d.allowedEmailDomains ?? "");
    });
  }, [orgId]);

  async function save() {
    await apiFetch(`/orgs/${orgId}/admin/settings`, {
      method: "PATCH",
      body: JSON.stringify({
        require2fa,
        messageRetentionDays: retention ? Number(retention) : null,
        allowedEmailDomains: domains || null
      })
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="max-w-md space-y-4">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={require2fa}
          onChange={(e) => setRequire2fa(e.target.checked)}
        />
        Wymuś 2FA dla wszystkich członków
      </label>
      <div>
        <label className="mb-1 block text-sm font-medium">Retencja wiadomości (dni)</label>
        <input
          value={retention}
          onChange={(e) => setRetention(e.target.value)}
          placeholder="puste = bez limitu"
          className={glassInput}
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Dozwolone domeny email zaproszeń</label>
        <input
          value={domains}
          onChange={(e) => setDomains(e.target.value)}
          placeholder="np. firma.pl, partner.com"
          className={glassInput}
        />
      </div>
      <button onClick={save} className={glassButtonPrimary}>
        {saved ? "Zapisano ✓" : "Zapisz ustawienia"}
      </button>
    </div>
  );
}

// ── Modules (F7-B) ─────────────────────────────────────────────────────
function ModulesTab({ orgId }: { orgId: string }) {
  const [modules, setModules] = useState<AdminModuleDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<ModuleKey | null>(null);
  const loadModulesStore = useModulesStore((s) => s.loadModules);

  function reload() {
    void apiFetch<AdminModuleDto[]>(`/orgs/${orgId}/admin/modules`)
      .then(setModules)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Błąd"));
  }

  useEffect(reload, [orgId]);

  async function toggle(key: ModuleKey, enabled: boolean) {
    setBusyKey(key);
    setError(null);
    // Optimistic flip.
    setModules((prev) => prev?.map((m) => (m.key === key ? { ...m, enabled } : m)) ?? prev);
    try {
      await apiFetch(`/orgs/${orgId}/admin/modules`, {
        method: "PATCH",
        body: JSON.stringify({ key, enabled })
      });
      // Keep the chat UI in sync immediately (hide/show affordances).
      void loadModulesStore(orgId);
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Nie udało się zmienić modułu");
      reload(); // revert to server truth
    } finally {
      setBusyKey(null);
    }
  }

  if (error && !modules) return <p className="text-sm text-[var(--danger)]">{error}</p>;
  if (!modules) return <p className="text-sm text-[var(--text-dim)]">Ładowanie...</p>;

  const optional = modules.filter((m) => !m.core);
  const core = modules.filter((m) => m.core);
  const activeCount = optional.filter((m) => m.enabled).length;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-sm font-semibold">Moduły organizacji</h2>
        <p className="text-xs text-[var(--text-dim)]">
          Włącz lub wyłącz funkcje dla całej organizacji. Aktywne opcjonalne: {activeCount}/{optional.length}.
        </p>
      </div>

      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}

      <ul className="space-y-2">
        {optional.map((m) => (
          <li
            key={m.key}
            className="flex items-center justify-between gap-3 rounded-xl border border-[var(--glass-border)] bg-[var(--glass)] px-4 py-3"
          >
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium">
                {m.label}
                {m.source === "hub" && (
                  <span className="rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)]">
                    z Huba
                  </span>
                )}
              </p>
              <p className="text-xs text-[var(--text-dim)]">
                {m.description}
                {m.source === "hub" && " · zarządzane centralnie — lokalna zmiana zostanie nadpisana przy synchronizacji."}
              </p>
            </div>
            <ModuleSwitch
              checked={m.enabled}
              disabled={busyKey === m.key}
              onChange={(v) => toggle(m.key, v)}
            />
          </li>
        ))}
      </ul>

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--text-dim)]">Moduły podstawowe</p>
        <ul className="space-y-2">
          {core.map((m) => (
            <li
              key={m.key}
              className="flex items-center justify-between gap-3 rounded-xl border border-[var(--glass-border)] bg-[var(--glass)]/50 px-4 py-3 opacity-70"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{m.label}</p>
                <p className="text-xs text-[var(--text-dim)]">{m.description}</p>
              </div>
              <span className="shrink-0 rounded-full border border-[var(--glass-border)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-dim)]">
                wymagany
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Accessible on/off toggle switch. */
function ModuleSwitch({
  checked,
  disabled,
  onChange
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
        checked ? "bg-[var(--accent)]" : "bg-[var(--border)]"
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-[22px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

// ── Integrations (F7-I) ───────────────────────────────────────────────
function IntegrationsTab({ orgId }: { orgId: string }) {
  const [hooks, setHooks] = useState<IntegrationWebhookDto[] | null>(null);
  const [channels, setChannels] = useState<AdminChannelDto[]>([]);
  const [name, setName] = useState("");
  const [channelId, setChannelId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newToken, setNewToken] = useState<{ id: string; token: string; url: string } | null>(null);
  const enabled = useModulesStore((s) => s.modules).integrations !== false;

  function reload() {
    void apiFetch<IntegrationWebhookDto[]>(`/orgs/${orgId}/integrations`)
      .then(setHooks)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Błąd"));
  }

  useEffect(() => {
    reload();
    void apiFetch<AdminChannelDto[]>(`/orgs/${orgId}/admin/channels`).then((cs) => {
      const active = cs.filter((c) => !c.archived && c.type !== "DM");
      setChannels(active);
      setChannelId((prev) => prev || active[0]?.id || "");
    });
  }, [orgId]);

  async function create() {
    if (!name.trim() || !channelId) return;
    setCreating(true);
    setError(null);
    try {
      const created = await apiFetch<IntegrationWebhookDto>(`/orgs/${orgId}/integrations`, {
        method: "POST",
        body: JSON.stringify({ channelId, name: name.trim() })
      });
      const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
      setNewToken({ id: created.id, token: created.token!, url: `${base}/api/v1/webhooks/incoming/${created.token}` });
      setName("");
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Nie udało się utworzyć integracji");
    } finally {
      setCreating(false);
    }
  }

  async function toggle(id: string, next: boolean) {
    await apiFetch(`/integrations/${id}`, { method: "PATCH", body: JSON.stringify({ enabled: next }) });
    reload();
  }

  async function remove(id: string) {
    await apiFetch(`/integrations/${id}`, { method: "DELETE" });
    if (newToken?.id === id) setNewToken(null);
    reload();
  }

  if (!enabled) {
    return (
      <p className="text-sm text-[var(--text-dim)]">
        Moduł integracji jest wyłączony dla tej organizacji. Włącz go w zakładce „Moduły”.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-sm font-semibold">Integracje przychodzące</h2>
        <p className="text-xs text-[var(--text-dim)]">
          Wygeneruj adres URL, na który zewnętrzne systemy (CI, monitoring, formularze) mogą wysłać zwykłe
          żądanie POST z JSON — treść trafi jako wiadomość na wybrany kanał.
        </p>
      </div>

      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}

      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-[var(--glass-border)] bg-[var(--glass)] p-4">
        <div className="flex-1 min-w-[160px]">
          <label className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Nazwa</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="np. CI Pipeline"
            className={glassInput}
          />
        </div>
        <div className="min-w-[160px]">
          <label className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Kanał</label>
          <select value={channelId} onChange={(e) => setChannelId(e.target.value)} className={glassInput}>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                #{c.name ?? c.id}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={create}
          disabled={creating || !name.trim() || !channelId}
          className={glassButtonPrimary}
        >
          {creating ? "Tworzenie..." : "+ Nowa integracja"}
        </button>
      </div>

      {newToken && (
        <div className="space-y-2 rounded-xl border border-[var(--accent)]/40 bg-[var(--accent)]/10 p-4">
          <p className="text-xs font-semibold text-[var(--accent)]">
            🔑 Zapisz ten adres — nie zostanie ponownie pokazany
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg bg-[var(--glass)] px-2 py-1.5 text-xs">
              {newToken.url}
            </code>
            <button
              onClick={() => void navigator.clipboard.writeText(newToken.url)}
              className={glassButtonGhost}
            >
              Kopiuj
            </button>
          </div>
          <p className="text-xs text-[var(--text-dim)]">
            Przykład: <code>curl -X POST {newToken.url} -H "Content-Type: application/json" -d
            {" "}
            {"'{\"text\":\"Build failed on main\"}'"}</code>
          </p>
        </div>
      )}

      <ul className="space-y-2">
        {hooks?.map((h) => (
          <li
            key={h.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-[var(--glass-border)] bg-[var(--glass)] px-4 py-3"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {h.name} <span className="text-xs font-normal text-[var(--text-dim)]">→ #{h.channelName ?? "?"}</span>
              </p>
              <p className="text-xs text-[var(--text-dim)]">
                {h.messageCount} wiadomości
                {h.lastUsedAt ? ` · ostatnio ${new Date(h.lastUsedAt).toLocaleString("pl-PL")}` : " · nigdy nie użyto"}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <ModuleSwitch checked={h.enabled} onChange={(v) => void toggle(h.id, v)} />
              <button
                onClick={() => void remove(h.id)}
                className="rounded-lg px-2 py-1 text-xs text-[var(--danger)] transition-colors hover:bg-[var(--danger)]/10"
              >
                Usuń
              </button>
            </div>
          </li>
        ))}
        {hooks && hooks.length === 0 && (
          <p className="text-xs text-[var(--text-dim)]">Brak skonfigurowanych integracji.</p>
        )}
      </ul>
    </div>
  );
}

// ── Dashboard ──────────────────────────────────────────────────────────
function DashboardTab({ orgId }: { orgId: string }) {
  const [data, setData] = useState<AdminDashboardDto | null>(null);
  const [analytics, setAnalytics] = useState<WorkspaceAnalytics | null>(null);

  useEffect(() => {
    void apiFetch<AdminDashboardDto>(`/orgs/${orgId}/admin/dashboard`).then(setData);
    void apiFetch<WorkspaceAnalytics>(`/orgs/${orgId}/admin/analytics`)
      .then(setAnalytics)
      .catch(() => setAnalytics(null));
  }, [orgId]);

  if (!data) return <p className="text-sm text-[var(--text-dim)]">Ładowanie...</p>;

  const max = Math.max(...data.messagesLast30d, 1);
  const topMax = Math.max(...(analytics?.topChannels.map((c) => c.messageCount) ?? [1]), 1);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4 md:grid-cols-5">
        <Kpi label="Członkowie" value={data.totalMembers} />
        <Kpi label="Aktywni (7 dni)" value={data.activeMembers7d} />
        <Kpi label="Pliki" value={data.totalFiles} />
        {analytics && <Kpi label="Wiadomości" value={analytics.totalMessages} />}
        {analytics && <Kpi label="Kanały" value={analytics.channelCount} />}
      </div>

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--text-dim)]">
          Wiadomości — ostatnie 30 dni
        </p>
        <div className="flex h-24 items-end gap-0.5">
          {data.messagesLast30d.map((v, i) => (
            <div
              key={i}
              title={`${v} wiadomości`}
              style={{ height: `${(v / max) * 100}%` }}
              className="flex-1 rounded-t bg-[var(--accent)]/60 transition-all hover:bg-[var(--accent)]"
            />
          ))}
        </div>
      </div>

      {analytics && analytics.topChannels.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--text-dim)]">
            Najbardziej aktywne kanały (30 dni)
          </p>
          <ul className="space-y-1.5">
            {analytics.topChannels.map((c) => (
              <li key={c.channelId} className="flex items-center gap-2 text-sm">
                <span className="w-32 shrink-0 truncate text-[var(--text-dim)]">#{c.name}</span>
                <span className="relative h-4 flex-1 overflow-hidden rounded bg-[var(--border)]/40">
                  <span
                    style={{ width: `${(c.messageCount / topMax) * 100}%` }}
                    className="absolute inset-y-0 left-0 rounded bg-[var(--accent)]/60"
                  />
                </span>
                <span className="w-12 shrink-0 text-right text-xs tabular-nums text-[var(--text-dim)]">
                  {c.messageCount}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--text-dim)]">
          Ostatnie zdarzenia bezpieczeństwa
        </p>
        {data.recentSecurityEvents.length === 0 ? (
          <p className="text-xs text-[var(--text-dim)]">Brak zdarzeń.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {data.recentSecurityEvents.map((e) => (
              <li key={e.id} className="text-[var(--danger)]">
                {e.action} — {new Date(e.createdAt).toLocaleString("pl-PL")}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="glass p-4">
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-xs text-[var(--text-dim)]">{label}</p>
    </div>
  );
}
