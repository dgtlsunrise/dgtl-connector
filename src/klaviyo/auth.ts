/**
 * Merchant-held Klaviyo private key (local free lane).
 * Never Polar-gated. Never stamp-hop. Never Consent A.
 * Keys stay under PLUGIN_DATA. Never log the key.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";

export const KLAVIYO_STORE_FILE = "klaviyo.json";

/** Official GA revision pin — document in TOOLS.md / skill. */
export const KLAVIYO_API_REVISION = "2026-07-15";

export const KLAVIYO_API_HOST = "a.klaviyo.com";

export type KlaviyoCredentials = {
  /** Private key beginning with pk_. Never log. */
  apiKey: string;
  source: "host-injected" | "file";
};

export type KlaviyoStored = {
  api_key?: string;
  private_key?: string;
};

function firstEnv(env: NodeJS.ProcessEnv, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = env[k];
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

/** Accept only local private keys. Never log the value. */
export function isKlaviyoPrivateKey(raw: string): boolean {
  return /^pk_[A-Za-z0-9_]{8,}$/.test(raw.trim());
}

export function klaviyoStorePath(pluginDataDir: string): string {
  return join(pluginDataDir, KLAVIYO_STORE_FILE);
}

export function readKlaviyoStore(pluginDataDir: string): KlaviyoStored | null {
  const p = klaviyoStorePath(pluginDataDir);
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as KlaviyoStored;
    if (!raw.api_key && !raw.private_key) return null;
    return raw;
  } catch {
    return null;
  }
}

export function writeKlaviyoStore(pluginDataDir: string, tokens: KlaviyoStored): void {
  mkdirSync(pluginDataDir, { recursive: true });
  const p = klaviyoStorePath(pluginDataDir);
  writeFileSync(p, `${JSON.stringify(tokens, null, 2)}\n`, { encoding: "utf8" });
  try {
    chmodSync(p, 0o600);
    chmodSync(dirname(p), 0o700);
  } catch {
    // Windows / some hosts cannot chmod.
  }
}

/**
 * Resolve local pk_ credentials: env first, then PLUGIN_DATA/klaviyo.json.
 * Invalid shapes fail closed (null) — never throw the key.
 */
export function resolveKlaviyoCredentials(opts: {
  env?: NodeJS.ProcessEnv;
  pluginDataDir: string;
}): KlaviyoCredentials | null {
  const env = opts.env ?? process.env;
  const envKey = firstEnv(env, ["KLAVIYO_API_KEY", "DGTL_KLAVIYO_API_KEY", "KLAVIYO_PRIVATE_KEY"]);
  if (envKey && isKlaviyoPrivateKey(envKey)) {
    return { apiKey: envKey, source: "host-injected" };
  }

  const stored = readKlaviyoStore(opts.pluginDataDir);
  const fileKey = stored?.api_key?.trim() || stored?.private_key?.trim();
  if (fileKey && isKlaviyoPrivateKey(fileKey)) {
    return { apiKey: fileKey, source: "file" };
  }
  return null;
}
