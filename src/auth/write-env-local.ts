/**
 * Load lane-specific Desktop client credentials from gitignored dotenv files.
 * Only fills keys that are unset. Never overrides process env. Never reads
 * Consent A secrets from W/G/S files. Values are never logged.
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

/** Keys allowed from `.env.ga4-admin.local` — Consent G lane only. */
export const GA4_ADMIN_ENV_LOCAL_KEYS = [
  "GOOGLE_OAUTH_GA4_ADMIN_CLIENT_ID",
  "GOOGLE_OAUTH_GA4_ADMIN_CLIENT_SECRET",
  "GOOGLE_GA4_ADMIN_ACCESS_TOKEN",
  "GOOGLE_GA4_ADMIN_GRANTED_SCOPES",
  "GOOGLE_GA4_ADMIN_ACCOUNT_EMAIL",
] as const;

/** Keys allowed from `.env.gsc-write.local` — Consent S lane only. */
export const GSC_WRITE_ENV_LOCAL_KEYS = [
  "GOOGLE_OAUTH_GSC_WRITE_CLIENT_ID",
  "GOOGLE_OAUTH_GSC_WRITE_CLIENT_SECRET",
  "GOOGLE_GSC_WRITE_ACCESS_TOKEN",
  "GOOGLE_GSC_WRITE_GRANTED_SCOPES",
  "GOOGLE_GSC_WRITE_ACCOUNT_EMAIL",
] as const;

const WRITE_KEY_SET = new Set<string>(WRITE_ENV_LOCAL_KEYS);
const GA4_ADMIN_KEY_SET = new Set<string>(GA4_ADMIN_ENV_LOCAL_KEYS);
const GSC_WRITE_KEY_SET = new Set<string>(GSC_WRITE_ENV_LOCAL_KEYS);

export function writeEnvLocalPath(pluginRoot: string): string {
  return join(pluginRoot, ".env.write.local");
}

export function ga4AdminEnvLocalPath(pluginRoot: string): string {
  return join(pluginRoot, ".env.ga4-admin.local");
}

export function gscWriteEnvLocalPath(pluginRoot: string): string {
  return join(pluginRoot, ".env.gsc-write.local");
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

function applyEnvLocalFile(
  path: string,
  allowed: Set<string>,
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  if (!existsSync(path)) return { ...env };
  let parsed: Record<string, string>;
  try {
    parsed = parseDotEnvLocal(readFileSync(path, "utf8"));
  } catch {
    return { ...env };
  }
  const next: NodeJS.ProcessEnv = { ...env };
  for (const [k, v] of Object.entries(parsed)) {
    if (!allowed.has(k)) continue;
    if (!v.trim()) continue;
    const cur = next[k];
    if (cur !== undefined && String(cur).trim() !== "") continue;
    next[k] = v.trim();
  }
  return next;
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
  return applyEnvLocalFile(writeEnvLocalPath(pluginRoot), WRITE_KEY_SET, env);
}

/** Consent G — `.env.ga4-admin.local`. Never fills Consent A keys. */
export function applyGa4AdminEnvLocal(
  pluginRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return applyEnvLocalFile(ga4AdminEnvLocalPath(pluginRoot), GA4_ADMIN_KEY_SET, env);
}

/** Consent S — `.env.gsc-write.local`. Never fills Consent A keys. */
export function applyGscWriteEnvLocal(
  pluginRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return applyEnvLocalFile(gscWriteEnvLocalPath(pluginRoot), GSC_WRITE_KEY_SET, env);
}

/** W then G then S local files. Each file only fills its own keys. Existing env wins. */
export function applyWriteLaneEnvLocals(
  pluginRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return applyGscWriteEnvLocal(
    pluginRoot,
    applyGa4AdminEnvLocal(pluginRoot, applyWriteEnvLocal(pluginRoot, env)),
  );
}
