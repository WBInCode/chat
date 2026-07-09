// Applied before paint to avoid a flash of the wrong theme (FOUC).
// Kept as an external file (not inline) so the CSP can use script-src 'self'
// without needing 'unsafe-inline' or a per-build hash.
(function () {
  try {
    var mode = localStorage.getItem("chatv2-theme") || "system";
    var isMidnight = mode === "midnight";
    var isDark =
      isMidnight ||
      mode === "dark" ||
      (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (isDark) document.documentElement.classList.add("dark");
    if (isMidnight) document.documentElement.classList.add("midnight");
    if (localStorage.getItem("chatv2-density") === "compact")
      document.documentElement.classList.add("compact");
  } catch (e) {}
})();
