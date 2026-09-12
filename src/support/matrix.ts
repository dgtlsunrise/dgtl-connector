import { existsSync } from "node:fs";
import { join } from "node:path";
import { STORE_FILE } from "../auth/types.js";
import type { Flags } from "../flags.js";
import { SHOPIFY_STORE_FILE } from "../shopify/auth.js";

/** Plugin mutate defaults ON; writes/GBP default OFF. Worker is fail-closed. */
export type PluginFlagBooleans = {
  adsMutateEnabled: boolean;
  metaMutateEnabled: boolean;
  tiktokMutateEnabled: boolean;
  writesEnabled: boolean;
  gbpEnabled: boolean;
};

/** null = unknown (health unreachable or old Worker without flags). */
export type WorkerFlagBooleans = {
  adsMutateEnabled: boolean | null;
  metaMutateEnabled: boolean | null;
  tiktokMutateEnabled: boolean | null;
};

/** Dual-gate lane: live mutate requires plugin AND Worker both true. All booleans. */
export type DualGateLane = {
  plugin_mutate_enabled: boolean;
  worker_mutate_enabled: boolean;
  worker_flag_known: boolean;
  live_mutate_possible: boolean;
};

export type DualGateMatrix = {
  ads: DualGateLane;
  meta: DualGateLane;
  tiktok: DualGateLane;
};

export type ConsentStorePresence = {
  consent_a: boolean;
  consent_c: boolean;
  consent_w: boolean;
  consent_mc: boolean;
  consent_b: boolean;
  meta: boolean;
  tiktok: boolean;
  shopify: boolean;
};

export function pluginFlagBooleans(flags: Flags): PluginFlagBooleans {
  return {
    adsMutateEnabled: flags.adsMutateEnabled,
    metaMutateEnabled: flags.metaMutateEnabled,
    tiktokMutateEnabled: flags.tiktokMutateEnabled,
    writesEnabled: flags.writesEnabled,
    gbpEnabled: flags.gbpEnabled,
  };
}

function lane(pluginOn: boolean, worker: boolean | null): DualGateLane {
  const known = typeof worker === "boolean";
  const workerOn = worker === true;
  return {
    plugin_mutate_enabled: pluginOn,
    worker_mutate_enabled: workerOn,
    worker_flag_known: known,
    live_mutate_possible: pluginOn && workerOn,
  };
}

export function dualGateMatrix(plugin: PluginFlagBooleans, worker: WorkerFlagBooleans): DualGateMatrix {
  return {
    ads: lane(plugin.adsMutateEnabled, worker.adsMutateEnabled),
    meta: lane(plugin.metaMutateEnabled, worker.metaMutateEnabled),
    tiktok: lane(plugin.tiktokMutateEnabled, worker.tiktokMutateEnabled),
  };
}

/** Existence only — never read token file contents. */
export function consentStorePresence(pluginDataDir: string): ConsentStorePresence {
  return {
    consent_a: existsSync(join(pluginDataDir, STORE_FILE.a)),
    consent_c: existsSync(join(pluginDataDir, STORE_FILE.ads)),
    consent_w: existsSync(join(pluginDataDir, STORE_FILE.w)),
    consent_mc: existsSync(join(pluginDataDir, STORE_FILE.mc)),
    consent_b: existsSync(join(pluginDataDir, STORE_FILE.gbp)),
    meta: existsSync(join(pluginDataDir, STORE_FILE.meta)),
    tiktok: existsSync(join(pluginDataDir, STORE_FILE.tiktok)),
    shopify: existsSync(join(pluginDataDir, SHOPIFY_STORE_FILE)),
  };
}

/** Hostname only. Never userinfo, path, query, or the raw URL. */
export function gatewayHostname(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.trim();
    if (!host || host.length > 253) return null;
    return host;
  } catch {
    return null;
  }
}

/** Feature names only — drop anything token-shaped or not a short identifier. */
export function safeLicenseFeatures(features: readonly string[]): string[] {
  const out: string[] = [];
  for (const f of features) {
    if (typeof f !== "string") continue;
    const s = f.trim();
    if (!s || s.length > 32) continue;
    if (!/^[a-z][a-z0-9_-]{0,31}$/i.test(s)) continue;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}
