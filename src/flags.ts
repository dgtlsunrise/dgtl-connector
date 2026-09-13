export type Flags = {
  gbpEnabled: boolean;
  /** Consent W write tools. Default off until write OAuth client + scopes exist. */
  writesEnabled: boolean;
  /**
   * Google Ads mutate tools (status/budget/keyword/ad/Search create).
   * Default on when env unset; opt out with DGTL_ADS_MUTATE_ENABLED / ADS_MUTATE_ENABLED=false.
   * Mirror of Worker ADS_MUTATE_ENABLED — Worker flag still required for live mutate hop.
   */
  adsMutateEnabled: boolean;
  /**
   * Meta Ads mutate tools (update + create campaign/adset/ad — creative_id-only).
   * Default on when env unset; opt out with DGTL_META_MUTATE_ENABLED / META_MUTATE_ENABLED=false.
   * Mirror of Worker META_MUTATE_ENABLED — Worker flag still required for live mutate hop.
   */
  metaMutateEnabled: boolean;
  /**
   * TikTok Ads mutate tools (campaign status).
   * Default on when env unset; opt out with DGTL_TIKTOK_MUTATE_ENABLED / TIKTOK_MUTATE_ENABLED=false.
   * Mirror of Worker TIKTOK_MUTATE_ENABLED — Worker flag still required for live mutate hop.
   */
  tiktokMutateEnabled: boolean;
  /**
   * Meta CAPI event send (meta_send_capi_events). Separate from META_MUTATE_ENABLED.
   * Plugin defaults on (listed); opt out with DGTL_META_CAPI_ENABLED / META_CAPI_ENABLED=false.
   * Live hop dual-gates Worker META_CAPI_ENABLED (fail-closed). App secret stays on Worker.
   */
  metaCapiEnabled: boolean;
  /**
   * TikTok Events API (tiktok_track_events). Separate from TIKTOK_MUTATE_ENABLED.
   * Plugin defaults on (listed); opt out with DGTL_TIKTOK_EVENTS_ENABLED / TIKTOK_EVENTS_ENABLED=false.
   * Live hop dual-gates Worker TIKTOK_EVENTS_ENABLED (fail-closed). App secret stays on Worker.
   */
  tiktokEventsEnabled: boolean;
  /**
   * Ads Data Manager IngestEvents status/dual-gate only. No plugin send tool.
   * Plugin defaults on; opt out with DGTL_ADS_DATA_MANAGER_ENABLED / ADS_DATA_MANAGER_ENABLED=false.
   * Stamp FundedUploadSink dual-gates Worker ADS_DATA_MANAGER_ENABLED (fail-closed).
   */
  adsDataManagerEnabled: boolean;
  /**
   * Thin sGTM apply-path ingest test (sgtm_ingest_test). Default OFF.
   * Opt in with DGTL_SGTM_INGEST_TEST_ENABLED / SGTM_INGEST_TEST_ENABLED=true.
   * Live POST dual-gates Worker SGTM_INGEST_ENABLED (fail-closed). Apply key is plugin-host env only.
   * Funded ingest key is never in this plugin or web GTM.
   */
  sgtmIngestTestEnabled: boolean;
  /** Append redacted tool audit lines to PLUGIN_DATA/audit.jsonl. Default off. */
  auditLocal: boolean;
  /**
   * DGTL Worker base URL (no trailing slash). Unset → paid Ads/Meta/TikTok return GATEWAY_UNAVAILABLE.
   * Power-user DGTL_ADS_DEVELOPER_TOKEN bypass is unimplemented.
   */
  gatewayUrl: string | undefined;
  /**
   * Optional full feedback endpoint or base URL. When unset, feedback uses
   * `${gatewayUrl}/v1/feedback`.
   */
  feedbackUrl: string | undefined;
};

function truthy(raw: string | undefined): boolean {
  const v = (raw || "false").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** If primary or alt env is present, honor truthy(); otherwise return defaultValue. */
function envFlag(
  primary: string | undefined,
  alt: string | undefined,
  defaultValue: boolean,
): boolean {
  if (primary !== undefined) return truthy(primary);
  if (alt !== undefined) return truthy(alt);
  return defaultValue;
}

export function loadFlags(env: NodeJS.ProcessEnv = process.env): Flags {
  const raw = (env.DGTL_GATEWAY_URL || "").trim();
  const feedbackRaw = (env.DGTL_FEEDBACK_URL || "").trim();
  return {
    gbpEnabled: truthy(env.DGTL_GBP_ENABLED || env.GBP_ENABLED),
    writesEnabled: truthy(env.DGTL_WRITES_ENABLED || env.WRITES_ENABLED),
    adsMutateEnabled: envFlag(env.DGTL_ADS_MUTATE_ENABLED, env.ADS_MUTATE_ENABLED, true),
    metaMutateEnabled: envFlag(env.DGTL_META_MUTATE_ENABLED, env.META_MUTATE_ENABLED, true),
    tiktokMutateEnabled: envFlag(env.DGTL_TIKTOK_MUTATE_ENABLED, env.TIKTOK_MUTATE_ENABLED, true),
    metaCapiEnabled: envFlag(env.DGTL_META_CAPI_ENABLED, env.META_CAPI_ENABLED, true),
    tiktokEventsEnabled: envFlag(env.DGTL_TIKTOK_EVENTS_ENABLED, env.TIKTOK_EVENTS_ENABLED, true),
    adsDataManagerEnabled: envFlag(env.DGTL_ADS_DATA_MANAGER_ENABLED, env.ADS_DATA_MANAGER_ENABLED, true),
    sgtmIngestTestEnabled: envFlag(env.DGTL_SGTM_INGEST_TEST_ENABLED, env.SGTM_INGEST_TEST_ENABLED, false),
    auditLocal: truthy(env.DGTL_AUDIT_LOCAL),
    gatewayUrl: raw ? raw.replace(/\/+$/, "") : undefined,
    feedbackUrl: feedbackRaw ? feedbackRaw.replace(/\/+$/, "") : undefined,
  };
}
