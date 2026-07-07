import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Mic, MicOff, PhoneOff } from "lucide-react";
import { Avatar } from "../../components/Avatar.js";
import { Icon } from "../../components/Icon.js";
import { getSocket } from "../../lib/socket.js";
import { VoiceRoomManager } from "../../lib/webrtc.js";

interface MemberLite {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
}

interface VoiceRoomProps {
  channelId: string;
  channelName: string;
  myUserId: string;
  members: MemberLite[];
  onClose: () => void;
}

interface ParticipantState {
  userId: string;
  muted: boolean;
  speaking: boolean;
}

/** Active voice call panel (F5-E) — P2P mesh, free STUN only, 2-4 participants. */
export function VoiceRoom({ channelId, channelName, myUserId, members, onClose }: VoiceRoomProps) {
  const [participants, setParticipants] = useState<ParticipantState[]>([]);
  const [myMuted, setMyMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const managerRef = useRef<VoiceRoomManager | null>(null);
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());

  useEffect(() => {
    const socket = getSocket();
    const manager = new VoiceRoomManager(socket, channelId, {
      onPeerStream: (userId, stream) => {
        let el = audioRefs.current.get(userId);
        if (!el) {
          el = new Audio();
          el.autoplay = true;
          audioRefs.current.set(userId, el);
        }
        el.srcObject = stream;
      },
      onPeerSpeaking: (userId, speaking) => {
        setParticipants((prev) => prev.map((p) => (p.userId === userId ? { ...p, speaking } : p)));
      },
      onPeerLeft: (userId) => {
        audioRefs.current.get(userId)?.remove();
        audioRefs.current.delete(userId);
      }
    });
    managerRef.current = manager;

    function onParticipants(payload: { channelId: string; participants: { userId: string; muted: boolean }[] }) {
      if (payload.channelId !== channelId) return;
      setParticipants((prev) =>
        payload.participants.map((p) => ({
          userId: p.userId,
          muted: p.muted,
          speaking: prev.find((existing) => existing.userId === p.userId)?.speaking ?? false
        }))
      );
      void manager.syncParticipants(
        payload.participants.map((p) => p.userId),
        myUserId
      );
    }
    function onMuteUpdate(payload: { channelId: string; userId: string; muted: boolean }) {
      if (payload.channelId !== channelId) return;
      setParticipants((prev) => prev.map((p) => (p.userId === payload.userId ? { ...p, muted: payload.muted } : p)));
    }
    function onVoiceError(payload: { code: string; message: string }) {
      if (payload.code === "VOICE_ROOM_FULL" || payload.code === "VOICE_JOIN_FAILED") {
        setError(payload.message);
      }
    }

    socket.on("voice:participants", onParticipants);
    socket.on("voice:mute-update", onMuteUpdate);
    socket.on("error", onVoiceError);

    manager.start().catch((err) => {
      setError(
        err instanceof DOMException
          ? "Brak dostępu do mikrofonu — sprawdź uprawnienia przeglądarki."
          : "Nie udało się uruchomić rozmowy głosowej."
      );
    });

    return () => {
      socket.off("voice:participants", onParticipants);
      socket.off("voice:mute-update", onMuteUpdate);
      socket.off("error", onVoiceError);
      manager.stop();
      for (const el of audioRefs.current.values()) el.remove();
      audioRefs.current.clear();
    };
  }, [channelId, myUserId]);

  function toggleMute() {
    const next = !myMuted;
    setMyMuted(next);
    managerRef.current?.setMuted(next);
  }

  function nameFor(userId: string) {
    if (userId === myUserId) return "Ty";
    return members.find((m) => m.userId === userId)?.displayName ?? "Uczestnik";
  }
  function avatarFor(userId: string) {
    return members.find((m) => m.userId === userId)?.avatarUrl ?? null;
  }

  return createPortal(
    <div className="glass-strong fixed bottom-4 right-4 z-40 w-72 max-w-[92vw] rounded-2xl p-4 shadow-2xl">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-xs text-[var(--text-dim)]">Rozmowa głosowa</p>
          <p className="text-sm font-semibold">#{channelName}</p>
        </div>
        <span className="text-xs text-[var(--text-dim)]">{participants.length}/4</span>
      </div>

      {error && <p className="mb-2 text-xs text-[var(--danger)]">{error}</p>}

      <div className="mb-3 flex flex-col gap-2">
        {participants.map((p) => (
          <div key={p.userId} className="flex items-center gap-2">
            <div className={`rounded-full ${p.speaking ? "ring-2 ring-[var(--accent)]" : ""}`}>
              <Avatar userId={p.userId} displayName={nameFor(p.userId)} url={avatarFor(p.userId)} size={28} />
            </div>
            <span className="flex-1 truncate text-sm">{nameFor(p.userId)}</span>
            {p.muted && <Icon icon={MicOff} size={14} className="text-[var(--text-dim)]" />}
          </div>
        ))}
        {participants.length === 0 && <p className="text-xs text-[var(--text-dim)]">Łączenie…</p>}
      </div>

      <div className="flex gap-2">
        <button
          onClick={toggleMute}
          title={myMuted ? "Włącz mikrofon" : "Wycisz mikrofon"}
          className={`flex-1 rounded-xl border border-[var(--glass-border)] bg-[var(--glass)] py-2 transition-all hover:bg-[var(--border)]/40 ${myMuted ? "text-[var(--danger)]" : ""}`}
        >
          <Icon icon={myMuted ? MicOff : Mic} className="mx-auto" />
        </button>
        <button
          onClick={onClose}
          title="Rozłącz"
          className="flex-1 rounded-xl bg-[var(--danger)]/90 py-2 text-white transition-all hover:opacity-90"
        >
          <Icon icon={PhoneOff} className="mx-auto" />
        </button>
      </div>
      <p className="mt-2 text-[10px] leading-tight text-[var(--text-dim)]">
        Połączenie bezpośrednie (P2P), darmowy STUN. Rozmowy do 4 osób.
      </p>
    </div>,
    document.body
  );
}
