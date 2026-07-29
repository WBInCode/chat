import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  History,
  Lock,
  MessageSquare,
  Minus,
  Pencil,
  Plus,
  Table as TableIcon,
  Trash2,
  Type,
  X
} from "lucide-react";
import {
  DOCUMENT_LOCK_TTL_SECONDS,
  emptyBlockData,
  type DocumentBlockData,
  type DocumentBlockDto,
  type DocumentBlockType,
  type DocumentDto,
  type DocumentLockDto
} from "@chatv2/shared";
import { Icon } from "../../../components/Icon.js";
import { ApiError, apiFetch, downloadFile } from "../../../lib/api.js";
import { getSocket } from "../../../lib/socket.js";
import { renderMarkdown } from "../markdown.js";
import { TableBlock } from "./TableBlock.js";
import { ChecklistBlock } from "./ChecklistBlock.js";
import { DocumentHistory } from "./DocumentHistory.js";
import { DocumentComments } from "./DocumentComments.js";

interface MemberLite {
  userId: string;
  displayName: string;
}

interface DocumentEditorProps {
  documentId: string;
  currentUserId: string;
  members: MemberLite[];
  onClose: () => void;
  onDeleted: () => void;
}

const BLOCK_MENU: Array<{ type: DocumentBlockType; label: string; icon: typeof Type }> = [
  { type: "text", label: "Akapit", icon: Type },
  { type: "heading", label: "Nagłówek", icon: Type },
  { type: "table", label: "Tabela", icon: TableIcon },
  { type: "checklist", label: "Lista zadań", icon: Check },
  { type: "divider", label: "Linia oddzielająca", icon: Minus }
];

export function DocumentEditor({
  documentId,
  currentUserId,
  members,
  onClose,
  onDeleted
}: DocumentEditorProps) {
  const [doc, setDoc] = useState<DocumentDto | null>(null);
  const [locks, setLocks] = useState<DocumentLockDto[]>([]);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DocumentBlockData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addMenuAfter, setAddMenuAfter] = useState<string | null | "none">("none");
  const [showHistory, setShowHistory] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);

  const memberName = useCallback(
    (id: string) => members.find((m) => m.userId === id)?.displayName ?? "Ktoś",
    [members]
  );

  const reload = useCallback(() => {
    void apiFetch<DocumentDto>(`/documents/${documentId}`)
      .then(setDoc)
      .catch(() => setError("Nie udało się wczytać dokumentu"));
  }, [documentId]);

  useEffect(reload, [reload]);

  useEffect(() => {
    void apiFetch<DocumentLockDto[]>(`/documents/${documentId}/locks`).then(setLocks).catch(() => {});
  }, [documentId]);

  // Live updates. A block the viewer is currently editing is deliberately not
  // patched from the socket: overwriting the text under someone's cursor is
  // worse than briefly showing a stale value, and the version check catches
  // the conflict on save anyway.
  useEffect(() => {
    const socket = getSocket();
    const onUpdate = (payload: {
      documentId: string;
      kind: string;
      actorId: string;
      block?: DocumentBlockDto;
    }) => {
      if (payload.documentId !== documentId) return;
      if (payload.actorId === currentUserId) return;
      if (payload.kind === "deleted") {
        onDeleted();
        return;
      }
      if (payload.kind === "block" && payload.block) {
        const incoming = payload.block;
        if (incoming.id === editingBlockId) return;
        setDoc((prev) =>
          prev
            ? { ...prev, blocks: prev.blocks.map((b) => (b.id === incoming.id ? incoming : b)) }
            : prev
        );
        return;
      }
      reload();
    };
    const onLocks = (payload: { documentId: string; locks: DocumentLockDto[] }) => {
      if (payload.documentId === documentId) setLocks(payload.locks);
    };

    socket.on("document:update", onUpdate);
    socket.on("document:locks", onLocks);
    return () => {
      socket.off("document:update", onUpdate);
      socket.off("document:locks", onLocks);
    };
  }, [documentId, currentUserId, editingBlockId, reload, onDeleted]);

  // Hold the lock for as long as the block stays open.
  useEffect(() => {
    if (!editingBlockId) return;
    const renew = setInterval(() => {
      void apiFetch(`/documents/${documentId}/blocks/${editingBlockId}/lock`, {
        method: "POST"
      }).catch(() => {});
    }, (DOCUMENT_LOCK_TTL_SECONDS / 2) * 1000);
    return () => clearInterval(renew);
  }, [documentId, editingBlockId]);

  // A closed tab must not leave a block locked until the TTL runs out.
  const editingRef = useRef<string | null>(null);
  editingRef.current = editingBlockId;
  useEffect(() => {
    return () => {
      const blockId = editingRef.current;
      if (blockId) {
        void apiFetch(`/documents/${documentId}/blocks/${blockId}/lock`, { method: "DELETE" }).catch(
          () => {}
        );
      }
    };
  }, [documentId]);

  const lockedBy = (blockId: string) =>
    locks.find((l) => l.blockId === blockId && l.userId !== currentUserId)?.userId ?? null;

  async function startEdit(block: DocumentBlockDto) {
    setError(null);
    try {
      await apiFetch(`/documents/${documentId}/blocks/${block.id}/lock`, { method: "POST" });
      setEditingBlockId(block.id);
      setDraft(block.data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Nie udało się otworzyć elementu do edycji");
    }
  }

  async function cancelEdit() {
    const blockId = editingBlockId;
    setEditingBlockId(null);
    setDraft(null);
    if (blockId) {
      await apiFetch(`/documents/${documentId}/blocks/${blockId}/lock`, { method: "DELETE" }).catch(
        () => {}
      );
    }
  }

  async function saveEdit() {
    if (!editingBlockId || !draft || !doc) return;
    const block = doc.blocks.find((b) => b.id === editingBlockId);
    if (!block) return;
    setError(null);
    try {
      const updated = await apiFetch<DocumentBlockDto>(
        `/documents/${documentId}/blocks/${editingBlockId}`,
        { method: "PATCH", body: JSON.stringify({ version: block.version, data: draft }) }
      );
      setDoc((prev) =>
        prev ? { ...prev, blocks: prev.blocks.map((b) => (b.id === updated.id ? updated : b)) } : prev
      );
      await cancelEdit();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Nie udało się zapisać zmian");
      if (e instanceof ApiError && e.code === "BLOCK_VERSION_CONFLICT") reload();
    }
  }

  async function addBlock(type: DocumentBlockType, afterBlockId: string | null) {
    setAddMenuAfter("none");
    setError(null);
    try {
      const created = await apiFetch<DocumentBlockDto>(`/documents/${documentId}/blocks`, {
        method: "POST",
        body: JSON.stringify({ afterBlockId, data: emptyBlockData(type) })
      });
      reload();
      if (type !== "divider") void startEdit(created);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Nie udało się dodać elementu");
    }
  }

  async function removeBlock(blockId: string) {
    setError(null);
    try {
      await apiFetch(`/documents/${documentId}/blocks/${blockId}`, { method: "DELETE" });
      setDoc((prev) => (prev ? { ...prev, blocks: prev.blocks.filter((b) => b.id !== blockId) } : prev));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Nie udało się usunąć elementu");
    }
  }

  async function move(blockId: string, direction: -1 | 1) {
    if (!doc) return;
    const index = doc.blocks.findIndex((b) => b.id === blockId);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= doc.blocks.length) return;
    try {
      setDoc(await apiFetch<DocumentDto>(`/documents/${documentId}/blocks/${blockId}/move`, {
        method: "POST",
        body: JSON.stringify({ position: target })
      }));
    } catch {
      reload();
    }
  }

  async function toggleChecklistItem(blockId: string, itemId: string, checked: boolean) {
    try {
      const updated = await apiFetch<DocumentBlockDto>(
        `/documents/${documentId}/blocks/${blockId}/check`,
        { method: "POST", body: JSON.stringify({ itemId, checked }) }
      );
      setDoc((prev) =>
        prev ? { ...prev, blocks: prev.blocks.map((b) => (b.id === updated.id ? updated : b)) } : prev
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Nie udało się zmienić pozycji");
    }
  }

  async function saveTitle() {
    if (titleDraft === null || !doc) return;
    const title = titleDraft.trim();
    setTitleDraft(null);
    if (!title || title === doc.title) return;
    try {
      setDoc(await apiFetch<DocumentDto>(`/documents/${documentId}`, {
        method: "PATCH",
        body: JSON.stringify({ title })
      }));
    } catch {
      reload();
    }
  }

  if (!doc) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-[var(--text-dim)]">
        {error ?? "Wczytywanie dokumentu…"}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--glass-border)] p-3">
        <button
          onClick={onClose}
          aria-label="Wróć do listy dokumentów"
          className="shrink-0 text-[var(--text-dim)] hover:text-[var(--text)]"
        >
          <Icon icon={ArrowLeft} size={16} />
        </button>

        {titleDraft === null ? (
          <button
            onClick={() => setTitleDraft(doc.title)}
            title="Zmień tytuł"
            className="min-w-0 flex-1 truncate text-left text-sm font-semibold hover:text-[var(--accent)]"
          >
            {doc.icon ? `${doc.icon} ` : ""}
            {doc.title}
          </button>
        ) : (
          <input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => void saveTitle()}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveTitle();
              if (e.key === "Escape") setTitleDraft(null);
            }}
            maxLength={200}
            aria-label="Tytuł dokumentu"
            className="min-w-0 flex-1 rounded border border-[var(--glass-border)] bg-[var(--glass)] px-2 py-1 text-sm font-semibold outline-none"
          />
        )}

        <button
          onClick={() => {
            setShowComments((v) => !v);
            setShowHistory(false);
          }}
          title="Komentarze"
          className={`shrink-0 ${showComments ? "text-[var(--accent)]" : "text-[var(--text-dim)] hover:text-[var(--text)]"}`}
        >
          <Icon icon={MessageSquare} size={15} />
        </button>
        <button
          onClick={() => {
            setShowHistory((v) => !v);
            setShowComments(false);
          }}
          title="Historia wersji"
          className={`shrink-0 ${showHistory ? "text-[var(--accent)]" : "text-[var(--text-dim)] hover:text-[var(--text)]"}`}
        >
          <Icon icon={History} size={15} />
        </button>
      </div>

      {error && (
        <p className="flex items-center justify-between gap-2 border-b border-[var(--glass-border)] bg-[var(--danger)]/10 px-3 py-2 text-xs text-[var(--danger)]">
          {error}
          <button onClick={() => setError(null)} aria-label="Zamknij komunikat">
            <Icon icon={X} size={13} />
          </button>
        </p>
      )}

      {showHistory && (
        <DocumentHistory
          documentId={documentId}
          memberName={memberName}
          onRestored={(restored) => {
            setDoc(restored);
            setShowHistory(false);
          }}
          onClose={() => setShowHistory(false)}
        />
      )}

      {showComments && (
        <DocumentComments
          documentId={documentId}
          currentUserId={currentUserId}
          memberName={memberName}
          onClose={() => setShowComments(false)}
        />
      )}

      {!showHistory && !showComments && (
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
          <AddBlockRow
            open={addMenuAfter === null}
            prominent={doc.blocks.length === 0}
            onOpen={() => setAddMenuAfter(addMenuAfter === null ? "none" : null)}
            onPick={(type) => void addBlock(type, null)}
          />

          {doc.blocks.map((block, index) => {
            const isEditing = editingBlockId === block.id;
            const holder = lockedBy(block.id);
            const data = isEditing && draft ? draft : block.data;

            return (
              <div key={block.id}>
                <div
                  className={`group relative rounded-lg border p-2 transition-colors ${
                    isEditing
                      ? "border-[var(--accent)]/60 bg-[var(--glass)]"
                      : "border-transparent hover:border-[var(--glass-border)]"
                  }`}
                >
                  {holder && (
                    <span className="mb-1 flex items-center gap-1 text-xs text-[var(--warning)]">
                      <Icon icon={Lock} size={11} /> {memberName(holder)} edytuje
                    </span>
                  )}

                  {/* Floated out of the flow so an invisible toolbar does not
                      add vertical space between every pair of blocks. */}
                  {!isEditing && (
                    <div className="absolute right-1 top-1 z-10 flex items-center gap-0.5 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-strong)] px-1 py-0.5 opacity-0 shadow-sm transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                      <button
                        onClick={() => void move(block.id, -1)}
                        disabled={index === 0}
                        aria-label="Przenieś wyżej"
                        className="rounded p-1 text-[var(--text-dim)] hover:bg-[var(--border)]/50 hover:text-[var(--text)] disabled:opacity-30"
                      >
                        <Icon icon={ChevronUp} size={14} />
                      </button>
                      <button
                        onClick={() => void move(block.id, 1)}
                        disabled={index === doc.blocks.length - 1}
                        aria-label="Przenieś niżej"
                        className="rounded p-1 text-[var(--text-dim)] hover:bg-[var(--border)]/50 hover:text-[var(--text)] disabled:opacity-30"
                      >
                        <Icon icon={ChevronDown} size={14} />
                      </button>
                      {block.data.type === "table" && (
                        <button
                          onClick={() =>
                            void downloadFile(
                              `/documents/${documentId}/blocks/${block.id}/csv`,
                              `${doc.title}.csv`
                            )
                          }
                          title="Pobierz tabelę jako CSV"
                          aria-label="Pobierz tabelę jako CSV"
                          className="rounded p-1 text-[var(--text-dim)] hover:bg-[var(--border)]/50 hover:text-[var(--accent)]"
                        >
                          <Icon icon={Download} size={13} />
                        </button>
                      )}
                      {block.data.type !== "divider" && (
                        <button
                          onClick={() => void startEdit(block)}
                          disabled={!!holder}
                          aria-label="Edytuj element"
                          className="rounded p-1 text-[var(--text-dim)] hover:bg-[var(--border)]/50 hover:text-[var(--accent)] disabled:opacity-30"
                        >
                          <Icon icon={Pencil} size={13} />
                        </button>
                      )}
                      <button
                        onClick={() => void removeBlock(block.id)}
                        disabled={!!holder}
                        aria-label="Usuń element"
                        className="rounded p-1 text-[var(--text-dim)] hover:bg-[var(--border)]/50 hover:text-[var(--danger)] disabled:opacity-30"
                      >
                        <Icon icon={Trash2} size={13} />
                      </button>
                    </div>
                  )}

                  <BlockBody
                    data={data}
                    editing={isEditing}
                    members={members}
                    currentUserId={currentUserId}
                    memberName={memberName}
                    onChange={setDraft}
                    onToggleChecklistItem={(itemId, checked) =>
                      void toggleChecklistItem(block.id, itemId, checked)
                    }
                  />

                  {isEditing && (
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        onClick={() => void cancelEdit()}
                        className="rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-dim)] hover:bg-[var(--border)]/40"
                      >
                        Anuluj
                      </button>
                      <button
                        onClick={() => void saveEdit()}
                        className="rounded-lg bg-[var(--accent)] px-2.5 py-1.5 text-xs font-medium text-white hover:opacity-90"
                      >
                        Zapisz
                      </button>
                    </div>
                  )}
                </div>

                <AddBlockRow
                  open={addMenuAfter === block.id}
                  prominent={index === doc.blocks.length - 1}
                  onOpen={() => setAddMenuAfter(addMenuAfter === block.id ? "none" : block.id)}
                  onPick={(type) => void addBlock(type, block.id)}
                />
              </div>
            );
          })}

          {doc.blocks.length === 0 && (
            <p className="py-8 text-center text-sm text-[var(--text-dim)]">
              Dokument jest pusty. Dodaj pierwszy element powyżej.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Inline "insert here" affordance. Between blocks it stays a thin line that
 * only appears on hover, so it does not clutter a document being read. The
 * one after the last block is always visible, because an editor whose only
 * way in is a hidden hover target is an editor nobody finds.
 */
function AddBlockRow({
  open,
  prominent = false,
  onOpen,
  onPick
}: {
  open: boolean;
  prominent?: boolean;
  onOpen: () => void;
  onPick: (type: DocumentBlockType) => void;
}) {
  return (
    <div className={`group/add relative ${prominent ? "pt-2" : ""}`}>
      <button
        onClick={onOpen}
        aria-label="Wstaw element"
        aria-expanded={open}
        className={
          prominent
            ? "flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-[var(--glass-border)] py-2 text-xs text-[var(--text-dim)] transition-colors hover:border-[var(--accent)]/60 hover:text-[var(--accent)]"
            : `flex w-full items-center justify-center gap-1 rounded-lg py-0.5 text-xs text-[var(--accent)] transition-opacity group-hover/add:opacity-100 focus:opacity-100 ${open ? "opacity-100" : "opacity-0"}`
        }
      >
        <Icon icon={Plus} size={12} /> {prominent ? "Dodaj element" : "Wstaw"}
      </button>
      {open && (
        <div className="absolute left-1/2 top-full z-20 mt-1 w-48 -translate-x-1/2 overflow-hidden rounded-xl border border-[var(--glass-border)] bg-[var(--glass-strong)] py-1 shadow-xl">
          {BLOCK_MENU.map((item) => (
            <button
              key={item.type}
              onClick={() => onPick(item.type)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--border)]/40"
            >
              <Icon icon={item.icon} size={14} className="text-[var(--text-dim)]" />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BlockBody({
  data,
  editing,
  members,
  currentUserId,
  memberName,
  onChange,
  onToggleChecklistItem
}: {
  data: DocumentBlockData;
  editing: boolean;
  members: MemberLite[];
  currentUserId: string;
  memberName: (id: string) => string;
  onChange: (data: DocumentBlockData) => void;
  onToggleChecklistItem: (itemId: string, checked: boolean) => void;
}) {
  switch (data.type) {
    case "heading":
      return editing ? (
        <div className="flex items-center gap-2">
          <select
            value={data.level}
            onChange={(e) =>
              onChange({ ...data, level: Number(e.target.value) as 1 | 2 | 3 })
            }
            aria-label="Poziom nagłówka"
            className="rounded border border-[var(--glass-border)] bg-[var(--glass)] px-2 py-1 text-xs outline-none"
          >
            <option value={1}>H1</option>
            <option value={2}>H2</option>
            <option value={3}>H3</option>
          </select>
          <input
            autoFocus
            value={data.text}
            onChange={(e) => onChange({ ...data, text: e.target.value })}
            placeholder="Tytuł sekcji"
            maxLength={200}
            className="flex-1 rounded border border-[var(--glass-border)] bg-[var(--glass)] px-2 py-1 font-semibold outline-none"
          />
        </div>
      ) : (
        <p
          className={
            data.level === 1
              ? "text-lg font-bold"
              : data.level === 2
                ? "text-base font-semibold"
                : "text-sm font-semibold"
          }
        >
          {data.text || <span className="text-[var(--text-dim)]">Pusty nagłówek</span>}
        </p>
      );

    case "text":
      return editing ? (
        <textarea
          autoFocus
          value={data.text}
          onChange={(e) => onChange({ ...data, text: e.target.value })}
          placeholder="Treść akapitu. Działa **pogrubienie**, *kursywa* i `kod`."
          rows={Math.min(16, Math.max(3, data.text.split("\n").length + 1))}
          maxLength={10000}
          className="w-full resize-y rounded border border-[var(--glass-border)] bg-[var(--glass)] px-2 py-1.5 text-sm outline-none"
        />
      ) : (
        <div className="text-sm leading-relaxed">
          {data.text ? (
            renderMarkdown(data.text, members, currentUserId)
          ) : (
            <span className="text-[var(--text-dim)]">Pusty akapit</span>
          )}
        </div>
      );

    case "table":
      return <TableBlock data={data} editing={editing} onChange={onChange} />;

    case "checklist":
      return (
        <ChecklistBlock
          data={data}
          editing={editing}
          memberName={memberName}
          onChange={onChange}
          onToggle={onToggleChecklistItem}
        />
      );

    case "divider":
      return <hr className="my-2 border-[var(--glass-border)]" />;
  }
}
