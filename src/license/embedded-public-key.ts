/**
 * Ed25519 public key used to verify DGTL license JWTs locally.
 * The matching private key is NOT in this plugin. Noel mints JWTs off-box.
 * Tests sign with the test key in tests/helpers (PKCS8 DER, no PEM header).
 */
export const LICENSE_ISSUER = "dgtl-sunrise";

export const LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAgfKY0yO6pYdqhmB0OrFIn/yKkpU/ZB2ua/YhdhTcfaM=
-----END PUBLIC KEY-----
`;
