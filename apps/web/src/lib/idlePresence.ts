import { useEffect, useRef } from "react";
import { WS_CLIENT_EVENTS } from "@chatv2/shared";
import type { AppSocket } from "./socket.js";
import { usePresenceModeStore } from "../stores/presenceMode.js";

const IDLE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
const ACTIVITY_EVENTS = ["mousemove", "keydown", "mousedown", "touchstart", "scroll"] as const;

/**
 * Auto away-detection: after 10 minutes with no user activity, presence
 * switches to "away" (unless the user manually forced a status). Any
 * activity resumes "online", again only while in automatic mode — a
 * manual "away"/"dnd" choice sticks until the user changes it back.
 */
export function useIdlePresence(socket: AppSocket | null) {
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentlyAway = useRef(false);

  useEffect(() => {
    if (!socket) return;

    function emit(status: "online" | "away" | "dnd") {
      socket!.emit(WS_CLIENT_EVENTS.PresenceSet, { status });
    }

    function resetTimer() {
      if (usePresenceModeStore.getState().manual) return; // manual override active — don't touch
      if (currentlyAway.current) {
        currentlyAway.current = false;
        emit("online");
      }
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => {
        if (usePresenceModeStore.getState().manual) return;
        currentlyAway.current = true;
        emit("away");
      }, IDLE_THRESHOLD_MS);
    }

    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, resetTimer, { passive: true }));
    resetTimer();

    // React to manual override changes (set by the presence toggle).
    const unsubscribe = usePresenceModeStore.subscribe((state) => {
      if (state.manual) {
        if (idleTimer.current) clearTimeout(idleTimer.current);
        emit(state.manual);
      } else {
        resetTimer();
      }
    });

    return () => {
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, resetTimer));
      if (idleTimer.current) clearTimeout(idleTimer.current);
      unsubscribe();
    };
  }, [socket]);
}
