import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, User, Palette, Bell, MonitorDown, ShieldCheck, Database } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Icon } from "../../components/Icon.js";
import { TotpSettings } from "./TotpSettings.js";
import { DataPrivacySection } from "./DataPrivacySection.js";
import { ProfileSettings } from "./ProfileSettings.js";
import { NotificationSettings } from "./NotificationSettings.js";
import { AppearanceSettings } from "./AppearanceSettings.js";
import { InstallAppSettings } from "./InstallAppSettings.js";
import { SessionsSettings } from "./SessionsSettings.js";
import { E2eKeysSettings } from "./E2eKeysSettings.js";

type SectionKey = "profile" | "appearance" | "notifications" | "app" | "security" | "privacy";

const SECTIONS: { key: SectionKey; label: string; icon: LucideIcon }[] = [
  { key: "profile", label: "Profil", icon: User },
  { key: "appearance", label: "Wygląd", icon: Palette },
  { key: "notifications", label: "Powiadomienia", icon: Bell },
  { key: "app", label: "Aplikacja", icon: MonitorDown },
  { key: "security", label: "Bezpieczeństwo", icon: ShieldCheck },
  { key: "privacy", label: "Dane i prywatność", icon: Database }
];

export function SettingsPage() {
  const [active, setActive] = useState<SectionKey>("profile");

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Ustawienia</h1>
        <Link
          to="/"
          className="flex items-center gap-1.5 text-sm font-medium text-[var(--accent)] transition-colors hover:underline"
        >
          <Icon icon={ArrowLeft} size={15} /> Wróć do czatu
        </Link>
      </div>

      <div className="flex flex-col gap-4 md:flex-row md:gap-6">
        {/* Section navigation: horizontal chips on mobile, vertical list on desktop. */}
        <nav
          aria-label="Sekcje ustawień"
          className="flex shrink-0 gap-1 overflow-x-auto md:w-52 md:flex-col md:overflow-visible"
        >
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setActive(s.key)}
              aria-current={active === s.key ? "page" : undefined}
              className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                active === s.key
                  ? "bg-[var(--accent)]/10 text-[var(--accent)]"
                  : "text-[var(--text-dim)] hover:bg-[var(--border)]/50 hover:text-[var(--text)]"
              }`}
            >
              <Icon icon={s.icon} size={16} />
              {s.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1 space-y-6">
          {active === "profile" && <ProfileSettings />}
          {active === "appearance" && <AppearanceSettings />}
          {active === "notifications" && <NotificationSettings />}
          {active === "app" && <InstallAppSettings />}
          {active === "security" && (
            <>
              <TotpSettings />
              <E2eKeysSettings />
              <SessionsSettings />
            </>
          )}
          {active === "privacy" && <DataPrivacySection />}
        </div>
      </div>
    </div>
  );
}
