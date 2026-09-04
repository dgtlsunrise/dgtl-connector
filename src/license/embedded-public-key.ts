/**
 * Ed25519 public key used to verify DGTL license JWTs locally.
 * The matching private key is NOT in this plugin. Noel mints JWTs off-box.
 * Tests sign with the test key in tests/helpers (PKCS8 DER, no PEM header).
 *
 * Rotation: embed current + previous kids briefly; Worker mints with JWT_KID.
 */
export const LICENSE_ISSUER = "dgtl-sunrise";

/** kid → SPKI PEM. Unknown kid → invalid. */
export const LICENSE_PUBLIC_KEYS: Record<string, string> = {
  "dev-1": `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAgfKY0yO6pYdqhmB0OrFIn/yKkpU/ZB2ua/YhdhTcfaM=
-----END PUBLIC KEY-----
`,
};

/** @deprecated Prefer LICENSE_PUBLIC_KEYS[kid]; kept for single-key callers. */
export const LICENSE_PUBLIC_KEY_PEM = LICENSE_PUBLIC_KEYS["dev-1"]!;
