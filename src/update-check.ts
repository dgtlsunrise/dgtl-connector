import { PLUGIN_VERSION } from "./version.js";

/** Default latest plugin.json. Override with DGTL_PLUGIN_LATEST_URL. */
export const DEFAULT_PLUGIN_LATEST_URL =
  "https://raw.githubusercontent.com/dgtlsunrise/dgtl-marketing/main/plugin.json";

const UPDATE_TIMEOUT_MS = 3_000;

export type PluginUpdateCheck = {
  plugin_version: string;
  latest_version: string | null;
  update_available: boolean;
  update_hint?: string;
};

function skipUpdateCheck(env: NodeJS.ProcessEnv): boolean {
  const v = (env.DGTL_SKIP_UPDATE_CHECK || "").trim().toLowerCase();
  return v === "1" || v === "true";
}

/** Compare dotted versions (optional leading v, ignore pre-release / build). */
export function isNewerVersion(current: string, latest: string): boolean {
  const a = parseVersion(current);
  const b = parseVersion(latest);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (right > left) return true;
    if (right < left) return false;
  }
  return false;
}

function parseVersion(raw: string): [number, number, number] | null {
  const core = raw.trim().replace(/^v/i, "").split("-")[0]?.split("+")[0] ?? "";
  if (!core) return null;
  const parts = core.split(".");
  if (parts.length < 1 || parts.length > 3) return null;
  const nums: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < parts.length; i++) {
    const n = Number(parts[i]);
    if (!Number.isInteger(n) || n < 0) return null;
    nums[i] = n;
  }
  return nums;
}

function emptyCheck(current: string): PluginUpdateCheck {
  return {
    plugin_version: current,
    latest_version: null,
    update_available: false,
  };
}

/**
 * Light latest-version probe for license_status.
 * Soft-fails: never throws. Skip when DGTL_SKIP_UPDATE_CHECK is 1 or true.
 */
export async function checkPluginUpdate(opts: {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  currentVersion?: string;
} = {}): Promise<PluginUpdateCheck> {
  const env = opts.env ?? process.env;
  const current = opts.currentVersion ?? PLUGIN_VERSION;
  if (skipUpdateCheck(env)) return emptyCheck(current);

  const url = (env.DGTL_PLUGIN_LATEST_URL || "").trim() || DEFAULT_PLUGIN_LATEST_URL;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), UPDATE_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: ac.signal,
    });
    if (!res.ok) return emptyCheck(current);
    let body: { version?: unknown } = {};
    try {
      body = (await res.json()) as { version?: unknown };
    } catch {
      return emptyCheck(current);
    }
    const latest = typeof body.version === "string" ? body.version.trim() : "";
    if (!latest) return emptyCheck(current);
    const newer = isNewerVersion(current, latest);
    return {
      plugin_version: current,
      latest_version: latest,
      update_available: newer,
      ...(newer
        ? {
            update_hint: `A newer plugin (${latest}) is available. Current is ${current}.`,
          }
        : {}),
    };
  } catch {
    return emptyCheck(current);
  } finally {
    clearTimeout(timer);
  }
}
