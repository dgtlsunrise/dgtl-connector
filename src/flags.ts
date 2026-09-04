export type Flags = {
  gbpEnabled: boolean;
  /** Consent W write tools. Default off until write OAuth client + scopes exist. */
  writesEnabled: boolean;
  /** Append redacted tool audit lines to PLUGIN_DATA/audit.jsonl. Default off. */
  auditLocal: boolean;
};

function truthy(raw: string | undefined): boolean {
  const v = (raw || "false").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function loadFlags(env: NodeJS.ProcessEnv = process.env): Flags {
  return {
    gbpEnabled: truthy(env.DGTL_GBP_ENABLED || env.GBP_ENABLED),
    writesEnabled: truthy(env.DGTL_WRITES_ENABLED || env.WRITES_ENABLED),
    auditLocal: truthy(env.DGTL_AUDIT_LOCAL),
  };
}
