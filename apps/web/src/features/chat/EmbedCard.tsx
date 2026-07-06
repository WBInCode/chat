import { useEffect, useState } from "react";
import type { LinkEmbedDto } from "@chatv2/shared";
import { apiFetch } from "../../lib/api.js";

/** Rich preview card for an unfurled link (Open Graph / Twitter Card data). */
export function EmbedCard({ embed }: { embed: LinkEmbedDto }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  let hostname = "";
  try {
    hostname = new URL(embed.url).hostname;
  } catch {
    hostname = embed.url;
  }

  useEffect(() => {
    if (!embed.hasImage) return;
    let cancelled = false;
    void apiFetch<{ url: string }>(`/embeds/${embed.id}/image`).then((r) => {
      if (!cancelled) setImageUrl(r.url);
    });
    return () => {
      cancelled = true;
    };
  }, [embed.id, embed.hasImage]);

  return (
    <a
      href={embed.url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="mt-1 flex max-w-md overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] transition-colors hover:bg-[var(--border)]/20"
    >
      <div className="w-1 shrink-0 bg-[var(--accent)]" />
      <div className="flex min-w-0 flex-1 gap-3 p-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] uppercase tracking-wide text-[var(--text-dim)]">
            {embed.siteName || hostname}
          </p>
          {embed.title && (
            <p className="mt-0.5 truncate text-sm font-medium text-[var(--accent)]">{embed.title}</p>
          )}
          {embed.description && (
            <p className="mt-0.5 line-clamp-2 text-xs text-[var(--text-dim)]">{embed.description}</p>
          )}
        </div>
        {imageUrl && (
          <img
            src={imageUrl}
            alt=""
            className="h-16 w-16 shrink-0 rounded-md object-cover"
          />
        )}
      </div>
    </a>
  );
}
