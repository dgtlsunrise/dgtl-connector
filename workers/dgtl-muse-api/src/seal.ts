import type { SealedRefreshToken } from "./auth";
import { arrayBuffer, base64ToBytes, bytesToBase64 } from "./bytes";

const IV_BYTES = 12;

function decodeKey(secret: string): Uint8Array | null {
  const cleaned = secret.replaceAll(/\s/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) {
    return null;
  }
  try {
    const bytes = base64ToBytes(cleaned);
    if (bytes.byteLength !== 32) {
      return null;
    }
    return bytes;
  } catch {
    return null;
  }
}

async function importKey(secret: string, usage: "encrypt" | "decrypt"): Promise<CryptoKey | null> {
  const raw = decodeKey(secret);
  if (raw === null) {
    return null;
  }
  try {
    return await crypto.subtle.importKey("raw", arrayBuffer(raw), "AES-GCM", false, [usage]);
  } catch {
    return null;
  }
}

export async function sealRefreshToken(
  plaintext: string,
  keySecret: string,
): Promise<SealedRefreshToken | null> {
  const key = await importKey(keySecret, "encrypt");
  if (key === null) {
    return null;
  }
  const iv = new Uint8Array(IV_BYTES);
  crypto.getRandomValues(iv);
  try {
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: arrayBuffer(iv) },
      key,
      arrayBuffer(new TextEncoder().encode(plaintext)),
    );
    return {
      alg: "A256GCM",
      iv: bytesToBase64(iv),
      ct: bytesToBase64(new Uint8Array(encrypted)),
    };
  } catch {
    return null;
  }
}

export async function openRefreshToken(
  sealed: SealedRefreshToken,
  keySecret: string,
): Promise<string | null> {
  if (sealed.alg !== "A256GCM") {
    return null;
  }
  const key = await importKey(keySecret, "decrypt");
  if (key === null) {
    return null;
  }
  let iv: Uint8Array;
  let ct: Uint8Array;
  try {
    iv = base64ToBytes(sealed.iv);
    ct = base64ToBytes(sealed.ct);
  } catch {
    return null;
  }
  if (iv.byteLength !== IV_BYTES || ct.byteLength === 0) {
    return null;
  }
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: arrayBuffer(iv) },
      key,
      arrayBuffer(ct),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
