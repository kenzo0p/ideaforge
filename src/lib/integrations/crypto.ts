import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Encryption for stored OAuth tokens.
//
// A Notion or Google access token lets the holder act as the user in their
// workspace. Storing them as plaintext in MongoDB would mean a read-only
// database leak hands an attacker live write access to every connected
// account — strictly worse than leaking password hashes, which are useless on
// their own.
//
// AES-256-GCM, so tampering is detected rather than silently decrypted into
// something else. The key comes from the environment and never touches the
// database, so a dumped collection is not enough to decrypt anything.
// ---------------------------------------------------------------------------

const ALGO = "aes-256-gcm";

/**
 * 32-byte key derived from INTEGRATION_SECRET.
 *
 * SHA-256 of the secret rather than the raw bytes, so any length of secret
 * works. This is not a password KDF — the secret is high-entropy machine
 * config, not something a human types, so stretching buys nothing.
 */
function key(): Buffer {
  const secret = process.env.INTEGRATION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "INTEGRATION_SECRET is missing or too short (need 16+ chars). " +
        "Generate one with: openssl rand -base64 32",
    );
  }
  return createHash("sha256").update(secret).digest();
}

export function isEncryptionConfigured(): boolean {
  const s = process.env.INTEGRATION_SECRET;
  return !!s && s.length >= 16;
}

/** Encrypt to `iv.tag.ciphertext`, all base64url. */
export function encryptToken(plaintext: string): string {
  const iv = randomBytes(12); // 96-bit nonce, the GCM standard
  const cipher = createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString("base64url")).join(".");
}

/** Reverse of `encryptToken`. Throws if the value was tampered with. */
export function decryptToken(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed encrypted token.");
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
