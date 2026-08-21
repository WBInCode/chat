import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@chatv2/shared";
import { useAuthStore } from "../stores/auth.js";
import { odtworzSesje } from "./api.js";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;

/** Ile razy próbujemy odzyskać połączenie po odrzuconym uwierzytelnieniu. */
const MAX_PROB_AUTORYZACJI = 5;
let probyAutoryzacji = 0;

export function getSocket(): AppSocket {
  if (socket) return socket;

  socket = io(API_BASE, {
    path: "/ws",
    withCredentials: true,
    autoConnect: false,
    // Token delivered via auth payload at handshake (never query string).
    auth: (cb) => {
      cb({ token: useAuthStore.getState().accessToken });
    }
  });

  socket.on("connect", () => {
    probyAutoryzacji = 0;
  });

  /**
   * Serwer odrzuca handshake przez middleware, a socket.io traktuje błąd
   * z middleware jako nieodwracalny: ustawia `active = false` i NIE ponawia
   * już nigdy. Nikt tego nie obsługiwał, więc po wygaśnięciu tokenu czat
   * milkł na stałe — aplikacja wyglądała na sprawną, baner "Łączenie
   * ponownie…" kłamał, a wysyłane wiadomości lądowały w buforze i znikały.
   * Jedynym ratunkiem było ręczne przeładowanie strony.
   */
  socket.on("connect_error", () => {
    // `active === true` to zwykły błąd transportu — biblioteka ponowi sama.
    if (socket?.active) return;
    if (probyAutoryzacji >= MAX_PROB_AUTORYZACJI) return;

    const proba = probyAutoryzacji++;
    void odtworzSesje().then((token) => {
      // Brak tokenu znaczy, że sesja jest naprawdę martwa. Nie ponawiamy —
      // pierwsze zapytanie REST wyczyści stan i przeniesie na ekran logowania.
      if (!token) return;
      setTimeout(() => socket?.connect(), Math.min(1000 * 2 ** proba, 15_000));
    });
  });

  return socket;
}

/**
 * Telefon usypia kartę, a po powrocie nic nie sprawdzało, czy sesja i gniazdo
 * jeszcze żyją. To był podstawowy scenariusz mobilny, nie brzegowy.
 */
function ozywPolaczenie() {
  if (!useAuthStore.getState().accessToken) return;
  if (!socket || socket.connected) return;
  probyAutoryzacji = 0;
  void odtworzSesje().then((token) => {
    if (token) socket?.connect();
  });
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") ozywPolaczenie();
  });
  window.addEventListener("online", ozywPolaczenie);
  window.addEventListener("pageshow", ozywPolaczenie);
}

export function connectSocket() {
  const s = getSocket();
  if (!s.connected) s.connect();
  return s;
}

export function disconnectSocket() {
  socket?.disconnect();
}
