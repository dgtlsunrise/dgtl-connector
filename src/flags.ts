export type Flags = {
  gbpEnabled: boolean;
  /** Consent W write tools. Default off until write OAuth client + scopes exist. */
  writesEnabled: boolean;
  /** Append redacted tool audit lines to PLUGIN_DATA/audit.jsonl. Default off. */
  auditLocal: boolean;
  /**
   * DGTL Worker base URL (no trailing slash). Unset → paid Ads/Meta return GATEWAY_UNAVAILABLE.
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

export function loadFlags(env: NodeJS.ProcessEnv = process.env): Flags {
  const raw = (env.DGTL_GATEWAY_URL || "").trim();
  const feedbackRaw = (env.DGTL_FEEDBACK_URL || "").trim();
  return {
    gbpEnabled: truthy(env.DGTL_GBP_ENABLED || env.GBP_ENABLED),
    writesEnabled: truthy(env.DGTL_WRITES_ENABLED || env.WRITES_ENABLED),
    auditLocal: truthy(env.DGTL_AUDIT_LOCAL),
    gatewayUrl: raw ? raw.replace(/\/+$/, "") : undefined,
    feedbackUrl: feedbackRaw ? feedbackRaw.replace(/\/+$/, "") : undefined,
  };
}
