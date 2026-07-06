import { Socket } from "node:net";
import { env } from "../config/env.js";

export interface ScanResult {
  infected: boolean;
  signature: string | null;
}

const CHUNK_SIZE = 64 * 1024;
const SCAN_TIMEOUT_MS = 30_000;

/**
 * Minimal clamd INSTREAM protocol client (no external dependency).
 * Protocol: send "zINSTREAM\0", then repeated (4-byte big-endian length +
 * chunk) pairs, terminated by a zero-length chunk. clamd replies with a
 * single line: "stream: OK" or "stream: <Signature> FOUND".
 * See: https://docs.clamav.net/manual/Usage/Scanning.html#instream
 */
export function scanBuffer(buffer: Buffer): Promise<ScanResult> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    let response = "";
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => reject(new Error("Timeout skanowania antywirusowego")));
    }, SCAN_TIMEOUT_MS);

    socket.on("error", (err) => finish(() => reject(err)));

    socket.connect(env.CLAMAV_PORT, env.CLAMAV_HOST, () => {
      socket.write("zINSTREAM\0");

      let offset = 0;
      while (offset < buffer.length) {
        const chunk = buffer.subarray(offset, offset + CHUNK_SIZE);
        const sizeHeader = Buffer.alloc(4);
        sizeHeader.writeUInt32BE(chunk.length, 0);
        socket.write(sizeHeader);
        socket.write(chunk);
        offset += CHUNK_SIZE;
      }
      // Zero-length chunk signals end of stream.
      socket.write(Buffer.alloc(4));
    });

    socket.on("data", (data) => {
      response += data.toString("utf8");
    });

    socket.on("end", () => {
      finish(() => {
        const trimmed = response.replace(/\0/g, "").trim();
        const match = trimmed.match(/^stream:\s*(.+?)\s+FOUND$/);
        if (match) {
          resolve({ infected: true, signature: match[1] ?? "unknown" });
        } else if (/^stream:\s*OK$/.test(trimmed)) {
          resolve({ infected: false, signature: null });
        } else {
          reject(new Error(`Nieoczekiwana odpowiedź ClamAV: ${trimmed}`));
        }
      });
    });
  });
}

/** Lightweight reachability check, used to skip AV-dependent tests/paths. */
export async function isClamAvReachable(): Promise<boolean> {
  try {
    await scanBuffer(Buffer.from("test"));
    return true;
  } catch {
    return false;
  }
}
