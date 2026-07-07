import { onLCP, onINP, onCLS, onFCP, onTTFB, type Metric } from "web-vitals";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * Free Core Web Vitals reporting (F5-F) — replaces paid RUM tooling.
 * Uses navigator.sendBeacon so metrics are reliably flushed even when the
 * tab is closing (the standard web-vitals recommendation), falling back to
 * fetch(keepalive) where sendBeacon is unavailable.
 */
function send(metric: Metric) {
  const payload = JSON.stringify({
    name: metric.name,
    value: metric.value,
    rating: metric.rating
  });
  const url = `${API_BASE}/api/v1/rum`;
  if (navigator.sendBeacon) {
    navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }));
  } else {
    void fetch(url, { method: "POST", body: payload, headers: { "Content-Type": "application/json" }, keepalive: true });
  }
}

export function reportWebVitals() {
  onLCP(send);
  onINP(send);
  onCLS(send);
  onFCP(send);
  onTTFB(send);
}
