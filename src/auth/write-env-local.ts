/**
 * Load Consent W Desktop client credentials from gitignored `.env.write.local`.
 * Only fills GOOGLE_OAUTH_WRITE_* (and optional write token) keys that are unset.
 * Never overrides process env. Never reads Consent A / Ads secrets from this file.
 * Values are never logged.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Keys allowed from `.env.write.local` — Consent W lane only. */
export const WRITE_ENV_LOCAL_KEYS = [
  "GOOGLE_OAUTH_WRITE_CLIENT_ID",
  "GOOGLE_OAUTH_WRITE_CLIENT_SECRET",
  "GOOGLE_WRITE_ACCESS_TOKEN",
  "GOOGLE_WRITE_GRANTED_SCOPES",
  "GOOGLE_WRITE_ACCOUNT_EMAIL",
] as const;

const WRITE_KEY_SET = new Set<string>(WRITE_ENV_LOCAL_KEYS);

export function writeEnvLocalPath(pluginRoot: string): string {
  return join(pluginRoot, ".env.write.local");
}

/**
 * Parse a dotenv-style file into a map. Ignores comments/blank lines.
 * Does not expand variables. Strips optional surrounding quotes.
 */
export function parseDotEnvLocal(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key) continue;
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/**
 * Return a shallow copy of `env` with missing Consent W keys filled from
 * `pluginRoot/.env.write.local` when the file exists. Existing env wins.
 * Unknown keys in the file are ignored (no Consent A bleed).
 */
export function applyWriteEnvLocal(
  pluginRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const path = writeEnvLocalPath(pluginRoot);
  if (!existsSync(path)) return { ...env };
  let parsed: Record<string, string>;
  try {
    parsed = parseDotEnvLocal(readFileSync(path, "utf8"));
  } catch {
    return { ...env };
  }
  const next: NodeJS.ProcessEnv = { ...env };
  for (const [k, v] of Object.entries(parsed)) {
    if (!WRITE_KEY_SET.has(k)) continue;
    if (!v.trim()) continue;
    const cur = next[k];
    if (cur !== undefined && String(cur).trim() !== "") continue;
    next[k] = v.trim();
  }
  return next;
}
