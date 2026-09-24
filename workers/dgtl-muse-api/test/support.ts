import { createMint, type MintedGrant } from "../scripts/mint-token.mjs";
import { parseToken, tokenKey, type Grant, type Token } from "../src/auth";

export function memoryTokens(records: ReadonlyMap<string, string>): KVNamespace {
  // Auth only calls get. The assertion supplies that method to the generated KV binding.
  return {
    async get(key: string): Promise<string | null> {
      return records.get(key) ?? null;
    },
  } as KVNamespace;
}

export function emptyEnv(): Env {
  return { MUSE_TOKENS: memoryTokens(new Map()) };
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
  };
}
