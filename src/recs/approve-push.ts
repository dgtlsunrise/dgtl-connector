/**
 * Wave 22 recs → approve → push judgment.
 * Sequences Ads recommendations, MC issues, GTM workspace diff, Klaviyo flow
 * status, and a missing GA4 Ads link. One named mutate tool per confirm.
 * Never auto-apply all Google recs. ENABLED is not a side effect of apply.
 */

import { ToolError } from "../errors.js";
import { requireId } from "../ids.js";

function normalizeCustomerId(raw: string): string {
  return raw.replace(/-/g, "");
}

export const WAVE22_SURFACES = [
  "ads_recommendations",
  "mc_issues",
  "gtm_workspace_diff",
  "klaviyo_flow_status",
  "ga4_ads_link",
] as const;

export type Wave22Surface = (typeof WAVE22_SURFACES)[number];

export const WAVE22_MUTATE_TOOLS = [
  "gads_apply_recommendation",
  "gads_apply_recommendations",
  "ga4_create_google_ads_link",
  "gtm_publish_container",
  "mc_upsert_product_input",
  "klaviyo_create_campaign_send_job",
] as const;

export type Wave22MutateTool = (typeof WAVE22_MUTATE_TOOLS)[number];

export const KLAVIYO_SEND_TOKEN = "SEND";

export const MAX_APPLY_RECOMMENDATIONS = 20;

const RN_RE = /^customers\/(\d{6,12})\/recommendations\/(\d{1,20})$/;

export type AdsRecommendation = {
  resource_name: string;
  recommendation_id: string;
  type: string;
  campaign_id?: string;
};

export type GtmWorkspaceEntity = {
  id: string;
  name?: string;
  type?: string;
};

export type GtmWorkspaceSnapshot = {
  tags: GtmWorkspaceEntity[];
  triggers: GtmWorkspaceEntity[];
  variables: GtmWorkspaceEntity[];
};

export type GtmWorkspaceDiff = {
  added: { kind: "tag" | "trigger" | "variable"; id: string; name?: string }[];
  removed: { kind: "tag" | "trigger" | "variable"; id: string; name?: string }[];
  unchanged: number;
};

export type RecsApprovePushBrief = {
  surfaces: Wave22Surface[];
  ads_recommendations: AdsRecommendation[];
  mc_issue_count: number;
  gtm_diff: GtmWorkspaceDiff;
  klaviyo_flows: Array<{ flow_id: string; status?: string; name?: string }>;
  ga4_ads_link_missing: boolean;
  next_mutate: { tool: Wave22MutateTool; dry_run: true; note: string } | null;
  apply_all: false;
  enabled_side_effect: false;
};

function isWave22MutateTool(name: string): name is Wave22MutateTool {
  return (WAVE22_MUTATE_TOOLS as readonly string[]).includes(name);
}

function surfaceNote(surface: Wave22Surface): string {
  switch (surface) {
    case "ads_recommendations":
      return "gads_search recipe=recommendations then gads_apply_recommendation or gads_apply_recommendations with an explicit RN list.";
    case "mc_issues":
      return "mc_list_account_issues / mc_list_product_statuses. Writes stay named MC tools.";
    case "gtm_workspace_diff":
      return "Compare gtm_list_tags/triggers/variables to gtm_get_live_container_version. Publish last on Consent W.";
    case "klaviyo_flow_status":
      return "klaviyo_list_flows / klaviyo_get_flow. Campaign send is klaviyo_create_campaign_send_job with SEND.";
    case "ga4_ads_link":
      return "ga4_list_google_ads_links (Consent A GET). Create is ga4_create_google_ads_link (Consent G).";
    default: {
      const _never: never = surface;
      throw new ToolError("INVALID_ARGUMENT", `Unknown Wave 22 surface ${String(_never)}`);
    }
  }
}

export function assertNoApplyAll(args: Record<string, unknown>): void {
  const flags = [args.apply_all, args.applyAll, args.all];
  if (flags.some((v) => v === true || v === "true" || v === "ALL" || v === "*")) {
    throw new ToolError(
      "UNSUPPORTED_OPERATION",
      "Auto-apply all Google Ads recommendations is not allowed. Name an explicit recommendation resource-name list.",
      {
        api: "google_ads",
        hint: "Pass recommendation_resource_names[] (or one recommendation_resource_name). Do not set apply_all.",
      },
    );
  }
  const raw = args.recommendation_resource_names;
  if (typeof raw === "string" && (raw.trim() === "*" || raw.trim().toUpperCase() === "ALL")) {
    throw new ToolError(
      "UNSUPPORTED_OPERATION",
      "Auto-apply all Google Ads recommendations is not allowed. Name explicit resource names.",
      { api: "google_ads" },
    );
  }
  if (Array.isArray(raw) && raw.some((x) => x === "*" || String(x).toUpperCase() === "ALL")) {
    throw new ToolError(
      "UNSUPPORTED_OPERATION",
      "Auto-apply all Google Ads recommendations is not allowed. Name explicit resource names.",
      { api: "google_ads" },
    );
  }
}

export function assertApplyDoesNotSetEnabled(args: Record<string, unknown>): void {
  if (args.status === undefined || args.status === null || args.status === "") return;
  const status = String(args.status).trim().toUpperCase();
  throw new ToolError(
    "UNSUPPORTED_OPERATION",
    "Applying a recommendation must not set campaign/ad status. ENABLED is not a side effect of apply.",
    {
      api: "google_ads",
      hint: `Refusing status=${status}. Use gads_set_campaign_status / gads_set_ad_status with explicit status + confirm if you intend to enable.`,
    },
  );
}

export function parseRecommendationResourceName(raw: unknown, customerId: string): string {
  const customer_id = normalizeCustomerId(customerId);
  if (typeof raw !== "string" || !raw.trim()) {
    throw new ToolError("RESOURCE_REQUIRED", "recommendation_resource_name is required", {
      api: "google_ads",
      resource_id: "recommendation_resource_name",
    });
  }
  const rn = raw.trim();
  const m = rn.match(RN_RE);
  if (!m) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      "recommendation_resource_name must be customers/{customer_id}/recommendations/{id}",
      { api: "google_ads", resource_id: rn },
    );
  }
  if (m[1] !== customer_id) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      "recommendation_resource_name customer_id does not match the named customer_id",
      { api: "google_ads", resource_id: rn },
    );
  }
  return `customers/${customer_id}/recommendations/${m[2]}`;
}

export function recommendationIdFromResourceName(rn: string): string {
  const m = rn.match(RN_RE);
  if (!m) {
    throw new ToolError("INVALID_ARGUMENT", "Not a recommendation resource name", {
      api: "google_ads",
      resource_id: rn,
    });
  }
  return m[2]!;
}

export function parseRecommendationResourceNames(
  args: Record<string, unknown>,
  customerId: string,
): string[] {
  assertNoApplyAll(args);
  const customer_id = normalizeCustomerId(requireId(customerId, "customer_id"));
  const named = args.recommendation_resource_names;
  if (Array.isArray(named)) {
    if (named.length === 0) {
      throw new ToolError(
        "RESOURCE_REQUIRED",
        "recommendation_resource_names must list at least one resource name",
        { api: "google_ads", resource_id: "recommendation_resource_names" },
      );
    }
    if (named.length > MAX_APPLY_RECOMMENDATIONS) {
      throw new ToolError(
        "INVALID_ARGUMENT",
        `recommendation_resource_names is capped at ${MAX_APPLY_RECOMMENDATIONS}`,
        { api: "google_ads" },
      );
    }
    const out = named.map((rn) => parseRecommendationResourceName(rn, customer_id));
    return [...new Set(out)];
  }
  if (typeof args.recommendation_resource_name === "string" && args.recommendation_resource_name.trim()) {
    return [parseRecommendationResourceName(args.recommendation_resource_name, customer_id)];
  }
  if (typeof args.recommendation_id === "string" && args.recommendation_id.trim()) {
    const id = args.recommendation_id.trim();
    if (!/^\d{1,20}$/.test(id)) {
      throw new ToolError("INVALID_ARGUMENT", "recommendation_id must be digits", {
        api: "google_ads",
        resource_id: id,
      });
    }
    return [`customers/${customer_id}/recommendations/${id}`];
  }
  throw new ToolError(
    "RESOURCE_REQUIRED",
    "Name recommendation_resource_names[] (or one recommendation_resource_name / recommendation_id). Apply-all is not accepted.",
    { api: "google_ads", resource_id: "recommendation_resource_names" },
  );
}

export function assertConfirmContainsRecommendationRns(
  confirmPhrase: unknown,
  resourceNames: readonly string[],
): void {
  const phrase = typeof confirmPhrase === "string" ? confirmPhrase : "";
  for (const rn of resourceNames) {
    const id = recommendationIdFromResourceName(rn);
    if (!phrase.includes(rn) && !phrase.includes(id)) {
      throw new ToolError(
        "INVALID_ARGUMENT",
        "Live apply requires confirm_phrase that includes each named recommendation resource name (or its id).",
        {
          api: "google_ads",
          resource_id: rn,
          hint: "List-tool output is not the user message. Name the exact RNs you are applying — not apply-all.",
        },
      );
    }
  }
}

export function assertOneMutatePerConfirm(toolsThisTurn: readonly string[]): void {
  const mutates = toolsThisTurn.filter((t) => isWave22MutateTool(t));
  if (mutates.length > 1) {
    throw new ToolError(
      "UNSUPPORTED_OPERATION",
      "One mutate tool per confirm. Sequence Ads apply, MC write, GTM publish, GA4 Ads link, or Klaviyo send — never two in one turn.",
      { hint: `This turn named ${mutates.join(" + ")}.` },
    );
  }
}

export function assertKlaviyoSendToken(confirmPhrase: unknown, accountId: string, campaignId: string): void {
  const phrase = typeof confirmPhrase === "string" ? confirmPhrase : "";
  if (!phrase.includes(accountId)) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      "Live campaign send requires confirm_phrase that includes the Klaviyo account id from klaviyo_get_account.",
      { api: "klaviyo", resource_id: accountId },
    );
  }
  if (!phrase.includes(campaignId)) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      "Live campaign send requires confirm_phrase that includes the campaign id.",
      { api: "klaviyo", resource_id: campaignId },
    );
  }
  if (!new RegExp(`\\b${KLAVIYO_SEND_TOKEN}\\b`).test(phrase)) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      `Live campaign send requires the ${KLAVIYO_SEND_TOKEN} token in confirm_phrase.`,
      {
        api: "klaviyo",
        hint: `Dry-run first. Live needs dry_run=false and confirm_phrase containing ${accountId}, the campaign id, and ${KLAVIYO_SEND_TOKEN}. Draft create cannot fire a send job.`,
      },
    );
  }
}

export function assertDraftCreateCannotSend(args: Record<string, unknown>): void {
  if (args.send_job || args.campaign_send_job || args.send === true || args.send === "true") {
    throw new ToolError(
      "UNSUPPORTED_OPERATION",
      "klaviyo_create_campaign is draft-only. Campaign send jobs cannot fire from draft create.",
      {
        api: "klaviyo",
        hint: `Use klaviyo_create_campaign_send_job after the draft exists. Live send needs confirm_phrase with the account id, campaign id, and ${KLAVIYO_SEND_TOKEN}.`,
      },
    );
  }
}

function entityMap(rows: GtmWorkspaceEntity[]): Map<string, GtmWorkspaceEntity> {
  const out = new Map<string, GtmWorkspaceEntity>();
  for (const row of rows) {
    const id = String(row.id ?? "").trim();
    if (id) out.set(id, row);
  }
  return out;
}

function diffKind(
  kind: "tag" | "trigger" | "variable",
  workspace: GtmWorkspaceEntity[],
  live: GtmWorkspaceEntity[],
  added: GtmWorkspaceDiff["added"],
  removed: GtmWorkspaceDiff["removed"],
): number {
  const w = entityMap(workspace);
  const l = entityMap(live);
  let unchanged = 0;
  for (const [id, row] of w) {
    if (l.has(id)) unchanged += 1;
    else added.push({ kind, id, name: row.name });
  }
  for (const [id, row] of l) {
    if (!w.has(id)) removed.push({ kind, id, name: row.name });
  }
  return unchanged;
}

export function diffGtmWorkspace(workspace: GtmWorkspaceSnapshot, live: GtmWorkspaceSnapshot): GtmWorkspaceDiff {
  const added: GtmWorkspaceDiff["added"] = [];
  const removed: GtmWorkspaceDiff["removed"] = [];
  const unchanged =
    diffKind("tag", workspace.tags, live.tags, added, removed) +
    diffKind("trigger", workspace.triggers, live.triggers, added, removed) +
    diffKind("variable", workspace.variables, live.variables, added, removed);
  return { added, removed, unchanged };
}

export function missingGa4AdsLink(
  links: ReadonlyArray<{ customerId?: string; customer_id?: string; name?: string }>,
  customerId?: string,
): boolean {
  if (!Array.isArray(links) || links.length === 0) return true;
  if (!customerId) return false;
  const want = normalizeCustomerId(customerId);
  return !links.some((row) => {
    const id = String(row.customerId ?? row.customer_id ?? "").replace(/-/g, "");
    return id === want;
  });
}

export function nextMutateAfterReads(input: {
  ads_recommendations: AdsRecommendation[];
  mc_issue_count: number;
  gtm_diff: GtmWorkspaceDiff;
  ga4_ads_link_missing: boolean;
  klaviyo_send_campaign_id?: string;
}): { tool: Wave22MutateTool; dry_run: true; note: string } | null {
  if (input.ads_recommendations.length > 0) {
    return {
      tool: input.ads_recommendations.length === 1 ? "gads_apply_recommendation" : "gads_apply_recommendations",
      dry_run: true,
      note: "Name the exact recommendation RN(s) in confirm. No apply-all. ENABLED is not a side effect.",
    };
  }
  if (input.mc_issue_count > 0) {
    return {
      tool: "mc_upsert_product_input",
      dry_run: true,
      note: "Fix named Merchant Center issues with ProductInput writes. Confirm merchant_id.",
    };
  }
  if (input.gtm_diff.added.length + input.gtm_diff.removed.length > 0) {
    return {
      tool: "gtm_publish_container",
      dry_run: true,
      note: "Workspace differs from live. Publish last on Consent W after the user names the publicId.",
    };
  }
  if (input.ga4_ads_link_missing) {
    return {
      tool: "ga4_create_google_ads_link",
      dry_run: true,
      note: "No GA4 Ads link for the named customer. Consent G create — never Consent A mutate.",
    };
  }
  if (input.klaviyo_send_campaign_id) {
    return {
      tool: "klaviyo_create_campaign_send_job",
      dry_run: true,
      note: `Send is a separate tool. Live needs ${KLAVIYO_SEND_TOKEN} plus account id and campaign id. Draft create cannot fire it.`,
    };
  }
  return null;
}

export function buildRecsApprovePushBrief(input: {
  ads_recommendations: AdsRecommendation[];
  mc_issue_count: number;
  workspace: GtmWorkspaceSnapshot;
  live: GtmWorkspaceSnapshot;
  klaviyo_flows: Array<{ flow_id: string; status?: string; name?: string }>;
  ga4_ads_links: ReadonlyArray<{ customerId?: string; customer_id?: string; name?: string }>;
  customer_id?: string;
  klaviyo_send_campaign_id?: string;
}): RecsApprovePushBrief {
  if (input.mc_issue_count < 0 || !Number.isFinite(input.mc_issue_count)) {
    throw new ToolError("INVALID_ARGUMENT", "mc_issue_count must be a non-negative count");
  }
  const gtm_diff = diffGtmWorkspace(input.workspace, input.live);
  const ga4_ads_link_missing = missingGa4AdsLink(input.ga4_ads_links, input.customer_id);
  return {
    surfaces: [...WAVE22_SURFACES],
    ads_recommendations: input.ads_recommendations,
    mc_issue_count: input.mc_issue_count,
    gtm_diff,
    klaviyo_flows: input.klaviyo_flows,
    ga4_ads_link_missing,
    next_mutate: nextMutateAfterReads({
      ads_recommendations: input.ads_recommendations,
      mc_issue_count: input.mc_issue_count,
      gtm_diff,
      ga4_ads_link_missing,
      klaviyo_send_campaign_id: input.klaviyo_send_campaign_id,
    }),
    apply_all: false,
    enabled_side_effect: false,
  };
}

export function wave22SurfaceNotes(): Record<Wave22Surface, string> {
  const out = {} as Record<Wave22Surface, string>;
  for (const surface of WAVE22_SURFACES) {
    out[surface] = surfaceNote(surface);
  }
  return out;
}
