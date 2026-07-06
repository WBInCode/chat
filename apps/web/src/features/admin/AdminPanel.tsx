import { useEffect, useState } from "react";
import { NavLink, Route, Routes, Navigate } from "react-router-dom";
import type {
  AdminMemberDto,
  AdminChannelDto,
  AuditLogEntryDto,
  AdminDashboardDto,
  OrgRole
} from "@chatv2/shared";
import { apiFetch, ApiError } from "../../lib/api.js";
import { glassButtonGhost, glassButtonPrimary, glassInput } from "../../styles/glass.js";

interface OrgItem {
  id: string;
  name: string;
  slug: string;
  role: OrgRole;
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
          { to: "channels", label: "Kanały" },
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
          <Route path="members" element={<MembersTab orgId={activeOrgId} />} />
          <Route path="channels" element={<ChannelsTab orgId={activeOrgId} />} />
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
function MembersTab({ orgId }: { orgId: string }) {
  const [members, setMembers] = useState<AdminMemberDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    void apiFetch<AdminMemberDto[]>(`/orgs/${orgId}/admin/members`)
      .then(setMembers)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Błąd"));
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

  if (error) return <p className="text-sm text-[var(--danger)]">{error}</p>;

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-[var(--glass-border)] text-left text-xs uppercase tracking-wide text-[var(--text-dim)]">
          <th className="pb-2">Użytkownik</th>
          <th className="pb-2">Rola</th>
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
            <td className="text-xs">{m.totpEnabled ? "✅" : "—"}</td>
            <td className="text-xs">
              {m.disabled ? (
                <span className="text-[var(--danger)]">Zdezaktywowany</span>
              ) : (
                <span className="text-[var(--accent-2)]">Aktywny</span>
              )}
            </td>
            <td className="text-right">
              {m.role !== "OWNER" && (
                <button
                  onClick={() => toggleDeactivate(m.userId, !m.disabled)}
                  className="rounded-lg px-2 py-1 text-xs text-[var(--text-dim)] transition-colors hover:bg-[var(--border)]/50"
                >
                  {m.disabled ? "Aktywuj" : "Deaktywuj"}
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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

// ── Dashboard ──────────────────────────────────────────────────────────
function DashboardTab({ orgId }: { orgId: string }) {
  const [data, setData] = useState<AdminDashboardDto | null>(null);

  useEffect(() => {
    void apiFetch<AdminDashboardDto>(`/orgs/${orgId}/admin/dashboard`).then(setData);
  }, [orgId]);

  if (!data) return <p className="text-sm text-[var(--text-dim)]">Ładowanie...</p>;

  const max = Math.max(...data.messagesLast30d, 1);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <Kpi label="Członkowie" value={data.totalMembers} />
        <Kpi label="Aktywni (7 dni)" value={data.activeMembers7d} />
        <Kpi label="Pliki" value={data.totalFiles} />
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
