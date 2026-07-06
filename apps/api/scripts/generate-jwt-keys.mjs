// Generates an Ed25519 keypair for signing access tokens (EdDSA JWTs).
// Run once per environment: `node scripts/generate-jwt-keys.mjs`
// Never commit the generated keys/ directory.
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const keysDir = resolve(__dirname, "..", "keys");

if (!existsSync(keysDir)) {
  mkdirSync(keysDir, { recursive: true });
}

const privatePath = resolve(keysDir, "jwt_private.pem");
const publicPath = resolve(keysDir, "jwt_public.pem");

if (existsSync(privatePath) || existsSync(publicPath)) {
  console.error("Keys already exist in", keysDir, "- refusing to overwrite. Delete them first if you intend to rotate.");
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync("ed25519");

writeFileSync(privatePath, privateKey.export({ type: "pkcs8", format: "pem" }));
writeFileSync(publicPath, publicKey.export({ type: "spki", format: "pem" }));

console.log("Generated Ed25519 keypair in", keysDir);
