import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@chatv2/shared";
import { useAuthStore } from "../stores/auth.js";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;

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

  return socket;
}

export function connectSocket() {
  const s = getSocket();
  if (!s.connected) s.connect();
  return s;
}

export function disconnectSocket() {
  socket?.disconnect();
}
