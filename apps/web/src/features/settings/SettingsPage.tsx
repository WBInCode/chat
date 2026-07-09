import { Link } from "react-router-dom";
import { TotpSettings } from "./TotpSettings.js";
import { ThemeToggle } from "./ThemeToggle.js";
import { DataPrivacySection } from "./DataPrivacySection.js";
import { ProfileSettings } from "./ProfileSettings.js";
import { NotificationSettings } from "./NotificationSettings.js";
import { AppearanceSettings } from "./AppearanceSettings.js";
import { InstallAppSettings } from "./InstallAppSettings.js";
import { SessionsSettings } from "./SessionsSettings.js";

export function SettingsPage() {
  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Ustawienia</h1>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Link
            to="/"
            className="text-sm text-[var(--accent)] transition-colors hover:underline"
          >
            ← Wróć do czatu
          </Link>
        </div>
      </div>
      <div className="animate-float-in space-y-6">
        <ProfileSettings />
        <AppearanceSettings />
        <NotificationSettings />
        <InstallAppSettings />
        <TotpSettings />
        <SessionsSettings />
        <DataPrivacySection />
      </div>
    </div>
  );
}
