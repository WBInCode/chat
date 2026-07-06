import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../lib/api.js";
import { Avatar } from "../../components/Avatar.js";
import { glassButtonGhost, glassButtonPrimary, glassInput } from "../../styles/glass.js";
import { useAuthStore } from "../../stores/auth.js";

interface ProfileDto {
  id: string;
  email: string;
  displayName: string;
  jobTitle: string | null;
  department: string | null;
  phone: string | null;
  statusText: string | null;
  statusEmoji: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

const STATUS_EMOJI_OPTIONS = ["🙂", "🌴", "🤒", "🏠", "🚀", "☕", "🎯", ""];

export function ProfileSettings() {
  const [profile, setProfile] = useState<ProfileDto | null>(null);
  const [form, setForm] = useState({ displayName: "", jobTitle: "", department: "", phone: "", statusText: "", statusEmoji: "" });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const setAuth = useAuthStore((s) => s.setAuth);
  const accessToken = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    void apiFetch<ProfileDto>("/me/profile").then((p) => {
      setProfile(p);
      setForm({
        displayName: p.displayName,
        jobTitle: p.jobTitle ?? "",
        department: p.department ?? "",
        phone: p.phone ?? "",
        statusText: p.statusText ?? "",
        statusEmoji: p.statusEmoji ?? ""
      });
    });
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await apiFetch<ProfileDto>("/me/profile", {
        method: "PATCH",
        body: JSON.stringify({
          displayName: form.displayName,
          jobTitle: form.jobTitle || null,
          department: form.department || null,
          phone: form.phone || null,
          statusText: form.statusText || null,
          statusEmoji: form.statusEmoji || null
        })
      });
      setProfile(updated);
      if (accessToken) {
        setAuth(accessToken, { id: updated.id, email: updated.email, displayName: updated.displayName });
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("Nie udało się zapisać profilu.");
    } finally {
      setSaving(false);
    }
  }

  async function onAvatarSelected(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("Wybierz plik obrazu (JPEG/PNG/WebP).");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const presign = await apiFetch<{ key: string; uploadUrl: string }>("/me/avatar/presign", {
        method: "POST",
        body: JSON.stringify({ mimeType: file.type, size: file.size })
      });
      const putRes = await fetch(presign.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!putRes.ok) throw new Error("upload failed");
      const updated = await apiFetch<ProfileDto>("/me/avatar/complete", {
        method: "POST",
        body: JSON.stringify({ key: presign.key })
      });
      setProfile(updated);
    } catch {
      setError("Nie udało się przesłać awatara.");
    } finally {
      setUploading(false);
    }
  }

  async function removeAvatar() {
    setUploading(true);
    try {
      const updated = await apiFetch<ProfileDto>("/me/avatar", { method: "DELETE" });
      setProfile(updated);
    } finally {
      setUploading(false);
    }
  }

  if (!profile) return null;

  return (
    <div className="glass-strong space-y-4 p-6">
      <h2 className="text-base font-semibold text-[var(--text)]">Profil</h2>

      <div className="flex items-center gap-4">
        <Avatar userId={profile.id} displayName={profile.displayName} url={profile.avatarUrl} size={64} />
        <div className="flex gap-2">
          <button type="button" className={glassButtonGhost} onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? "Przesyłanie…" : "Zmień zdjęcie"}
          </button>
          {profile.avatarUrl && (
            <button type="button" className={glassButtonGhost} onClick={removeAvatar} disabled={uploading}>
              Usuń
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onAvatarSelected(file);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-[var(--text-dim)]">Wyświetlana nazwa</span>
          <input
            className={glassInput}
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            maxLength={80}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-[var(--text-dim)]">Stanowisko</span>
          <input
            className={glassInput}
            value={form.jobTitle}
            onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
            maxLength={120}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-[var(--text-dim)]">Dział</span>
          <input
            className={glassInput}
            value={form.department}
            onChange={(e) => setForm({ ...form, department: e.target.value })}
            maxLength={120}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-[var(--text-dim)]">Telefon</span>
          <input
            className={glassInput}
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            maxLength={40}
          />
        </label>
      </div>

      <label className="block space-y-1 text-sm">
        <span className="text-[var(--text-dim)]">Status (np. "Na urlopie do 12.08")</span>
        <div className="flex gap-2">
          <select
            className={`${glassInput} !w-24`}
            value={form.statusEmoji}
            onChange={(e) => setForm({ ...form, statusEmoji: e.target.value })}
          >
            {STATUS_EMOJI_OPTIONS.map((emoji) => (
              <option key={emoji || "none"} value={emoji}>
                {emoji || "—"}
              </option>
            ))}
          </select>
          <input
            className={glassInput}
            value={form.statusText}
            onChange={(e) => setForm({ ...form, statusText: e.target.value })}
            maxLength={120}
            placeholder="Brak statusu"
          />
        </div>
      </label>

      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

      <div className="flex items-center gap-3">
        <button type="button" className={`${glassButtonPrimary} !w-auto`} onClick={save} disabled={saving}>
          {saving ? "Zapisywanie…" : "Zapisz profil"}
        </button>
        {saved && <span className="text-sm text-[var(--accent-2)]">✓ Zapisano</span>}
      </div>
    </div>
  );
}
