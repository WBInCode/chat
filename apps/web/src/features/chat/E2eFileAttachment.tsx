import { useEffect, useState } from "react";
import { FileText, ImageIcon, Download, ShieldCheck } from "lucide-react";
import { Icon } from "../../components/Icon.js";
import { downloadEncryptedFile } from "../../lib/upload.js";
import type { E2eFileRef } from "../../lib/e2e.js";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/**
 * An attachment inside an E2E conversation. The server only ever held
 * ciphertext, so everything shown here - the name, the type, the preview -
 * comes from the decrypted message body and is reconstructed locally.
 *
 * Images are fetched and decrypted eagerly so they can be previewed inline;
 * anything else is decrypted on demand when the user asks to download it,
 * to avoid pulling large blobs nobody opened.
 */
export function E2eFileAttachment({ file }: { file: E2eFileRef }) {
  const isImage = IMAGE_TYPES.has(file.m);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isImage) return;
    let revoked: string | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const bytes = await downloadEncryptedFile(file);
        if (cancelled) return;
        if (!bytes) {
          setError("Nie można odszyfrować");
          return;
        }
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: file.m }));
        revoked = url;
        setObjectUrl(url);
      } catch {
        if (!cancelled) setError("Nie udało się pobrać");
      }
    })();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [file, isImage]);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const bytes = await downloadEncryptedFile(file);
      if (!bytes) {
        setError("Nie można odszyfrować tego pliku");
        return;
      }
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: file.m }));
      const a = document.createElement("a");
      a.href = url;
      a.download = file.n;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Nie udało się pobrać pliku");
    } finally {
      setBusy(false);
    }
  }

  if (isImage) {
    return (
      <div className="mt-1 max-w-sm">
        {objectUrl ? (
          <img
            src={objectUrl}
            alt={file.n}
            className="max-h-72 rounded-lg border border-[var(--glass-border)] object-contain"
          />
        ) : (
          <div className="flex h-32 w-48 items-center justify-center gap-2 rounded-lg border border-[var(--glass-border)] text-xs text-[var(--text-dim)]">
            <Icon icon={ImageIcon} size={15} />
            {error ?? "Odszyfrowywanie…"}
          </div>
        )}
        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-[var(--text-dim)]">
          <Icon icon={ShieldCheck} size={11} className="text-[var(--accent-2)]" />
          {file.n} · {formatBytes(file.s)}
        </p>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={download}
        disabled={busy}
        className="mt-1 flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left text-xs hover:bg-[var(--border)]/30 disabled:opacity-60"
      >
        <span className="text-[var(--text-dim)]">
          <Icon icon={FileText} size={20} />
        </span>
        <span className="min-w-0">
          <span className="block truncate font-medium">{file.n}</span>
          <span className="flex items-center gap-1 text-[var(--text-dim)]">
            <Icon icon={ShieldCheck} size={11} className="text-[var(--accent-2)]" />
            {formatBytes(file.s)} · {busy ? "odszyfrowywanie…" : "zaszyfrowany"}
          </span>
        </span>
        <Icon icon={Download} size={15} className="ml-1 shrink-0 text-[var(--text-dim)]" />
      </button>
      {error && <p className="mt-1 text-xs text-[var(--danger)]">{error}</p>}
    </>
  );
}
