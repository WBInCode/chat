// Generates a VAPID keypair for Web Push (used to authenticate the server
// to push services like FCM/Mozilla push). Run once per environment:
// `node scripts/generate-vapid-keys.mjs`, then copy the printed values into
// .env as VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY.
import webPush from "web-push";

const { publicKey, privateKey } = webPush.generateVAPIDKeys();

console.log("VAPID_PUBLIC_KEY=" + publicKey);
console.log("VAPID_PRIVATE_KEY=" + privateKey);
