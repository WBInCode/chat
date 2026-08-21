import { apiFetch } from "./api.js";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

/**
 * Registers the service worker (idempotent), requests notification
 * permission, and subscribes to Web Push using the server's VAPID public
 * key. Silently no-ops if the browser lacks push support or permission is
 * denied — this is a progressive enhancement, not a hard requirement.
 */
export async function enablePushNotifications(): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  const registration = await navigator.serviceWorker.register("/sw.js");
  const { publicKey } = await apiFetch<{ publicKey: string | null }>("/push/vapid-public-key");
  if (!publicKey) return false; // server has no VAPID keys configured

  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource
    }));

  const json = subscription.toJSON();
  await apiFetch("/me/push-subscribe", {
    method: "POST",
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys })
  });
  return true;
}

export async function disablePushNotifications(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await apiFetch("/me/push-unsubscribe", {
    method: "POST",
    body: JSON.stringify({ endpoint: subscription.endpoint })
  });
  await subscription.unsubscribe();
}

/**
 * Uzgadnia subskrypcję push z serwerem przy starcie aplikacji.
 *
 * Przeglądarka co jakiś czas sama rotuje subskrypcję. Backend poprawnie
 * sprząta martwy endpoint przy 410/404, ale nikt nie zgłaszał nowego, więc
 * push działał tydzień i po cichu przestawał — a przełącznik w ustawieniach
 * dalej pokazywał "włączone", bo sprawdza tylko lokalny obiekt.
 *
 * Wywołanie jest ciche i bezpieczne: nic nie robi, gdy użytkownik nigdy nie
 * włączył powiadomień ani nie prosi o żadne uprawnienia.
 */
export async function zsynchronizujPush(): Promise<void> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;
    const json = subscription.toJSON();
    await apiFetch("/me/push-subscribe", {
      method: "POST",
      body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys })
    });
  } catch {
    // Push to udogodnienie, nie warunek działania czatu — cisza jest w porządku.
  }
}

export async function isPushEnabled(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return !!subscription;
}
