/**
 * Wave 20 conversion fabric — plugin status + apply-only sGTM ingest test.
 * Funded uploads live on stamp FundedUploadSink. Never keys. Never user_data plaintext.
 */
import type { AppContext } from "../context.js";
import { failEnvelope, okEnvelope, type Envelope } from "../envelope.js";
import { MSG } from "../errors.js";
import { CONVERSION_FABRIC } from "../gateway/hop-maps.generated.js";
import { gatewayUrlFromEnv, probeGatewayReachable } from "../gateway/client.js";
import { hasFeature } from "../license/verify.js";
import { newRequestId } from "../log.js";
import {
  dualGateMatrix,
  gatewayHostname,
  pluginFlagBooleans,
  safeLicenseFeatures,
  workerFlagBooleans,
  type PluginFlagBooleans,
  type WorkerFlagBooleans,
} from "../support/matrix.js";
import { TOKENISH } from "../support/packet.js";

type FabricSink = (typeof CONVERSION_FABRIC.sinks)[number];

function pluginEnabledForSink(id: FabricSink["id"], plugin: PluginFlagBooleans): boolean {
  switch (id) {
    case "ads_data_manager":
      return plugin.adsDataManagerEnabled;
    case "meta_capi":
      return plugin.metaCapiEnabled;
    case "tiktok_events":
      return plugin.tiktokEventsEnabled;
    default: {
      const _never: never = id;
      return _never;
    }
  }
}

function workerEnabledForSink(id: FabricSink["id"], worker: WorkerFlagBooleans): boolean | null {
  switch (id) {
    case "ads_data_manager":
      return worker.adsDataManagerEnabled;
    case "meta_capi":
      return worker.metaCapiEnabled;
    case "tiktok_events":
      return worker.tiktokEventsEnabled;
    default: {
      const _never: never = id;
      return _never;
    }
  }
}

export const CONVERSION_FABRIC_WAVE = 20;
export const SGTM_INGEST_PATH = "/v1/sgtm/ingest";
export const SGTM_APPLY_HEADER = "X-DGTL-Apply-Key";
export const SGTM_FUNDED_HEADER = "X-DGTL-Ingest-Key";
export const SGTM_CLOSED_EVENT = "apply" as const;
const SGTM_TIMEOUT_MS = 15_000;

const FORBIDDEN_ARG_KEY =
  /^(x-?dgtl-?(apply|ingest)-?key|dgtl[_-]?(sgtm[_-]?)?(apply|ingest|funded)[_-]?key|apply[_-]?key|ingest[_-]?key|funded[_-]?key|authorization|user_data)$/i;

const REQUIRED_INGEST_FIELDS = ["event_id", "application_id", "client_id"] as const;

export function applyKeyFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = (env.DGTL_SGTM_APPLY_KEY || env.DGTL_APPLY_KEY || "").trim();
  return raw || undefined;
}

export function applyKeyPresent(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(applyKeyFromEnv(env));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function scanForbiddenArgs(args: Record<string, unknown>): string | null {
  const stack: unknown[] = [args];
  while (stack.length) {
    const cur = stack.pop();
    if (!isRecord(cur) && !Array.isArray(cur)) {
      if (typeof cur === "string" && (TOKENISH.test(cur) || FORBIDDEN_ARG_KEY.test(cur.trim()))) {
        return "token";
      }
      continue;
    }
    if (Array.isArray(cur)) {
      for (const item of cur) stack.push(item);
      continue;
    }
    for (const [key, value] of Object.entries(cur)) {
      if (FORBIDDEN_ARG_KEY.test(key)) return key;
      stack.push(value);
    }
  }
  return null;
}

function requiredField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 256) return null;
  if (TOKENISH.test(trimmed)) return null;
  return trimmed;
}

function polarSgtm(features: readonly string[]): {
  feature: "sgtm";
  reserved: true;
  default: "off";
  mint: false;
  present: boolean;
} {
  return {
    feature: "sgtm",
    reserved: true,
    default: "off",
    mint: false,
    present: features.includes("sgtm"),
  };
}

/**
 * Health of sinks / flags / hop contracts. Always ok. Never keys, JWT, or user_data.
 */
export async function conversionFabricStatus(ctx: AppContext): Promise<Envelope> {
  const plugin = pluginFlagBooleans(ctx.flags);
  const probe = await probeGatewayReachable(ctx);
  const worker = workerFlagBooleans(probe);
  const features = safeLicenseFeatures(ctx.license.features);
  const dual = dualGateMatrix(plugin, worker);
  const sinks = CONVERSION_FABRIC.sinks.map((sink) => {
    const workerEnabled = workerEnabledForSink(sink.id, worker);
    const pluginEnabled = pluginEnabledForSink(sink.id, plugin);
    return {
      id: sink.id,
      stamp_sink: sink.stamp_sink,
      stamp_hop: sink.stamp_hop,
      kind: sink.kind,
      method: sink.method,
      host: "host" in sink ? sink.host : null,
      path_template: sink.path_template,
      rpc: "rpc" in sink ? sink.rpc : null,
      not: "not" in sink ? sink.not : null,
      plugin_send_tool: sink.plugin_send_tool,
      worker_flag: sink.worker_flag,
      health_key: sink.health_key,
      plugin_enabled: pluginEnabled,
      worker_enabled: workerEnabled,
    };
  });

  return okEnvelope("conversion_fabric_status", {
    data: {
      wave: CONVERSION_FABRIC_WAVE,
      replaces_product_story: CONVERSION_FABRIC.replaces_product_story,
      stamp_interface: CONVERSION_FABRIC.stamp_interface,
      polar: { sgtm: polarSgtm(features) },
      gateway: {
        configured: Boolean(ctx.flags.gatewayUrl ?? gatewayUrlFromEnv(ctx.env)),
        reachable: probe.reachable,
        host: gatewayHostname(ctx.flags.gatewayUrl),
      },
      flags: { plugin, worker },
      dual_gate: {
        capi: dual.capi,
        tiktok_events: dual.tiktok_events,
        ads_data_manager: dual.ads_data_manager,
        sgtm_ingest: dual.sgtm_ingest,
      },
      sinks,
      ingest: {
        path: CONVERSION_FABRIC.ingest.path,
        apply_header: CONVERSION_FABRIC.ingest.apply_header,
        funded_header: CONVERSION_FABRIC.ingest.funded_header,
        funded_never_in_web_gtm: CONVERSION_FABRIC.ingest.funded_never_in_web_gtm,
        plugin_test_tool: CONVERSION_FABRIC.ingest.plugin_test_tool,
        closed_event_name: CONVERSION_FABRIC.ingest.closed_event_name,
        worker_flag: CONVERSION_FABRIC.ingest.worker_flag,
        health_key: CONVERSION_FABRIC.ingest.health_key,
        plugin_enabled: plugin.sgtmIngestTestEnabled,
        worker_enabled: worker.sgtmIngestEnabled,
        apply_key_present: applyKeyPresent(ctx.env),
      },
      send_tools: {
        meta_capi: "meta_send_capi_events",
        tiktok_events: "tiktok_track_events",
        ads_data_manager: null,
      },
      locks: {
        never_log_user_data_plaintext: true,
        never_axos: true,
        consent_a_untouched: true,
        consent_a_kernel: 26,
        no_polar_sgtm_mint: true,
        prefer_ingest_events: true,
        not_upload_click_conversions: true,
        funded_key_never_in_web_gtm: true,
        no_wave_21_budget_skill: true,
        named_closed_tools_only: true,
        has_feature_sgtm: false,
        has_feature_ads: hasFeature(ctx.license, "ads"),
        has_feature_meta: hasFeature(ctx.license, "meta"),
        has_feature_tiktok: hasFeature(ctx.license, "tiktok"),
      },
      license: {
        present: ctx.license.reason !== "missing",
        ok: ctx.license.ok,
        features,
        sgtm: features.includes("sgtm"),
      },
    },
  });
}

/**
 * HTTP ingest test: POST {gateway}/v1/sgtm/ingest with apply header only.
 * Closed event_name=apply. Never funded key, never Authorization, never user_data.
 */
export async function sgtmIngestTest(ctx: AppContext, args: Record<string, unknown>): Promise<Envelope> {
  const tool = "sgtm_ingest_test";
  const forbidden = scanForbiddenArgs(args);
  if (forbidden) {
    return failEnvelope(tool, "INVALID_ARGUMENT", MSG.INVALID_ARGUMENT, {
      hint: "sgtm_ingest_test refuses ingest/funded/apply keys, Authorization, user_data, and token-shaped strings. Apply key stays in host env. Never log user_data.",
    });
  }

  const eventName = typeof args.event_name === "string" ? args.event_name.trim() : "";
  if (eventName && eventName !== SGTM_CLOSED_EVENT) {
    return failEnvelope(tool, "INVALID_ARGUMENT", MSG.INVALID_ARGUMENT, {
      hint: `Closed event_name is apply only. Refused ${JSON.stringify(eventName)}. Funded uploads stay on stamp FundedUploadSink.`,
    });
  }
  if (!eventName) {
    return failEnvelope(tool, "INVALID_ARGUMENT", MSG.INVALID_ARGUMENT, {
      hint: "event_name is required and must be apply. Funded is not a plugin event.",
    });
  }

  const missing = REQUIRED_INGEST_FIELDS.filter((k) => !requiredField(args[k]));
  if (missing.length) {
    return failEnvelope(tool, "RESOURCE_REQUIRED", MSG.RESOURCE_REQUIRED, {
      hint: `sgtm_ingest_test needs ${missing.join(", ")}. Do not guess.`,
    });
  }

  const event_id = requiredField(args.event_id)!;
  const application_id = requiredField(args.application_id)!;
  const client_id = requiredField(args.client_id)!;
  const dryRun = args.dry_run !== false;

  if (!ctx.flags.sgtmIngestTestEnabled) {
    return failEnvelope(tool, "SGTM_NOT_ENABLED", MSG.SGTM_NOT_ENABLED, {
      hint: "Plugin DGTL_SGTM_INGEST_TEST_ENABLED defaults off. No ingest HTTP was sent.",
    });
  }

  if (dryRun) {
    return okEnvelope(tool, {
      data: {
        dry_run: true,
        event_name: SGTM_CLOSED_EVENT,
        event_id,
        application_id,
        client_id,
        apply_key_present: applyKeyPresent(ctx.env),
        path: SGTM_INGEST_PATH,
        apply_header: SGTM_APPLY_HEADER,
        funded: false,
        hop: null,
      },
      hint: "Dry-run only. No ingest HTTP. Live needs confirm: true and Worker SGTM_INGEST_ENABLED.",
    });
  }

  if (args.confirm !== true) {
    return failEnvelope(tool, "INVALID_ARGUMENT", MSG.INVALID_ARGUMENT, {
      hint: "Live sgtm_ingest_test needs confirm: true after dry_run. No ingest HTTP was sent.",
    });
  }

  const base = ctx.flags.gatewayUrl ?? gatewayUrlFromEnv(ctx.env);
  if (!base) {
    return failEnvelope(tool, "GATEWAY_UNAVAILABLE", MSG.GATEWAY_UNAVAILABLE, {
      hint: "Set DGTL_GATEWAY_URL. sGTM ingest is POST /v1/sgtm/ingest (not a hop-catalog MCP hop).",
    });
  }

  const probe = await probeGatewayReachable(ctx);
  if (!probe.reachable) {
    return failEnvelope(tool, "GATEWAY_UNAVAILABLE", MSG.GATEWAY_UNAVAILABLE, {
      hint: probe.note ?? "Gateway health probe failed. No ingest HTTP was sent.",
    });
  }
  if (probe.sgtm_ingest_enabled !== true) {
    return failEnvelope(tool, "SGTM_NOT_ENABLED", MSG.SGTM_NOT_ENABLED, {
      hint: "Worker SGTM_INGEST_ENABLED is fail-closed (health sgtm_ingest_enabled≠true). No ingest HTTP was sent.",
    });
  }

  const applyKey = applyKeyFromEnv(ctx.env);
  if (!applyKey) {
    return failEnvelope(tool, "SGTM_APPLY_KEY_MISSING", MSG.SGTM_APPLY_KEY_MISSING, {
      hint: "Set DGTL_SGTM_APPLY_KEY on this host. Never X-DGTL-Ingest-Key. Never web GTM.",
    });
  }

  const requestId = newRequestId();
  const url = `${base}${SGTM_INGEST_PATH}`;
  const body = {
    event_name: SGTM_CLOSED_EVENT,
    event_id,
    application_id,
    client_id,
  };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), SGTM_TIMEOUT_MS);
  try {
    const res = await ctx.fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-DGTL-Request-Id": requestId,
        [SGTM_APPLY_HEADER]: applyKey,
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });

    let parsed: Record<string, unknown> = {};
    try {
      parsed = (await res.json()) as Record<string, unknown>;
    } catch {
      if (!res.ok) {
        return failEnvelope(tool, "GATEWAY_UNAVAILABLE", MSG.GATEWAY_UNAVAILABLE, {
          hint: `sGTM ingest returned HTTP ${res.status} with non-JSON body.`,
        });
      }
    }

    if (!res.ok) {
      const code =
        typeof parsed.error_code === "string" &&
        (parsed.error_code === "SGTM_NOT_ENABLED" ||
          parsed.error_code === "SGTM_APPLY_KEY_MISSING" ||
          parsed.error_code === "INVALID_ARGUMENT" ||
          parsed.error_code === "GATEWAY_UNAVAILABLE")
          ? parsed.error_code
          : "GATEWAY_UNAVAILABLE";
      return failEnvelope(
        tool,
        code,
        typeof parsed.message === "string" && parsed.message.trim() ? parsed.message : MSG[code],
        {
          hint:
            typeof parsed.message === "string"
              ? parsed.message
              : `sGTM ingest returned HTTP ${res.status}.`,
        },
      );
    }

    return okEnvelope(tool, {
      data: {
        dry_run: false,
        sent: true,
        event_name: SGTM_CLOSED_EVENT,
        event_id,
        application_id,
        client_id,
        path: SGTM_INGEST_PATH,
        funded: false,
        accepted: parsed.ok === true || parsed.accepted === true,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return failEnvelope(tool, "GATEWAY_UNAVAILABLE", MSG.GATEWAY_UNAVAILABLE, {
      hint: `sGTM ingest POST failed (${msg}). Check DGTL_GATEWAY_URL. Do not send funded keys.`,
    });
  } finally {
    clearTimeout(timer);
  }
}
