import { createMint, type MintedGrant } from "../scripts/mint-token.mjs";
import { parseToken, tokenKey, type Grant, type Token } from "../src/auth";
import { bytesToBase64 } from "../src/bytes";

type MemoryRecord = {
  value: string;
  expiresAtMs: number | null;
};

export class MemoryKv {
  readonly records = new Map<string, MemoryRecord>();
  readonly puts: { key: string; expirationTtl: number | undefined }[] = [];

  async get(key: string): Promise<string | null> {
    const record = this.records.get(key);
    if (record === undefined) {
      return null;
    }
    if (record.expiresAtMs !== null && record.expiresAtMs <= Date.now()) {
      this.records.delete(key);
      return null;
    }
    return record.value;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    const ttl = options?.expirationTtl;
    this.puts.push({ key, expirationTtl: ttl });
    this.records.set(key, {
      value,
      expiresAtMs: ttl === undefined ? null : Date.now() + ttl * 1000,
    });
  }

  async delete(key: string): Promise<void> {
    this.records.delete(key);
  }

  entries(): ReadonlyMap<string, string> {
    const out = new Map<string, string>();
    for (const [key, record] of this.records) {
      if (record.expiresAtMs !== null && record.expiresAtMs <= Date.now()) {
        continue;
      }
      out.set(key, record.value);
    }
    return out;
  }

  asNamespace(): KVNamespace {
    return this as unknown as KVNamespace;
  }
}

export function memoryTokens(records: ReadonlyMap<string, string>): KVNamespace {
  const kv = new MemoryKv();
  for (const [key, value] of records) {
    kv.records.set(key, { value, expiresAtMs: null });
  }
  return kv.asNamespace();
}

export const TEST_ENC_KEY = bytesToBase64(Uint8Array.from({ length: 32 }, (_, i) => i + 1));

function testSecrets(): Pick<
  Env,
  "GOOGLE_WEB_CLIENT_ID" | "GOOGLE_WEB_CLIENT_SECRET" | "MUSE_TOKEN_ENC_KEY"
> {
  return {
    GOOGLE_WEB_CLIENT_ID: "test-web-client-id",
    GOOGLE_WEB_CLIENT_SECRET: "test-web-client-secret",
    MUSE_TOKEN_ENC_KEY: TEST_ENC_KEY,
  };
}

export function emptyEnv(): Env {
  return { MUSE_TOKENS: memoryTokens(new Map()), ...testSecrets() };
}

export function envWithKv(kv: MemoryKv): Env {
  return { MUSE_TOKENS: kv.asNamespace(), ...testSecrets() };
}

export async function issuedToken(): Promise<{ token: Token; hash: string; grant: MintedGrant }> {
  const minted = createMint(new Date("2026-09-24T00:00:00.000Z"));
  const token = parseToken(minted.token);
  if (token === null) {
    throw new Error("minted token did not match dgtl_muse_ format");
  }
  const hash = await tokenKey(token);
  if (hash !== minted.hash) {
    throw new Error("mint script hash does not match the Worker key");
  }
  return { token, hash, grant: minted.grant };
}

export function envWithGrant(hash: string, grant: Grant): Env {
  return {
    MUSE_TOKENS: memoryTokens(new Map([[hash, JSON.stringify(grant)]])),
    ...testSecrets(),
  };
}
