import type { AppContext } from "../context.js";
import { failEnvelope, okEnvelope, HINT_EMPTY_LIST, type Envelope } from "../envelope.js";
import { MSG, ToolError } from "../errors.js";
import { asInt, requireId } from "../ids.js";
import type { HttpCall } from "../http/calls.js";
import {
  KLAVIYO_API_REVISION,
  resolveKlaviyoCredentials,
  type KlaviyoCredentials,
} from "./auth.js";
import { KlaviyoHttp, pageCursorFromNext, type KlaviyoJson } from "./http.js";

/** Closed default fieldset — never dump phone, location, or the properties bag. */
export const PROFILE_SPARSE_DEFAULT = ["email", "created", "updated", "external_id"] as const;
export const PROFILE_SPARSE_EXTRA = ["first_name", "last_name"] as const;
const PROFILE_STRIP = new Set([
  "phone_number",
  "location",
  "properties",
  "image",
  "organization",
  "title",
  "subscriptions",
  "predictive_analytics",
  "locale",
]);

const ACCOUNT_FIELDS =
  "contact_information.organization_name,industry,timezone,preferred_currency,locale,test_account";

const CAMPAIGN_CHANNELS = new Set(["email", "sms", "mobile_push"]);

export type KlaviyoResource = {
  type?: string;
  id?: string;
  attributes?: Record<string, unknown>;
};

export async function withKlaviyo(
  ctx: AppContext,
  tool: string,
  run: (http: KlaviyoHttp, creds: KlaviyoCredentials) => Promise<Envelope>,
): Promise<Envelope> {
  const creds = resolveKlaviyoCredentials({
    env: ctx.env,
    pluginDataDir: ctx.pluginDataDir,
  });
  if (!creds) {
    return failEnvelope(tool, "KLAVIYO_NOT_CONNECTED", MSG.KLAVIYO_NOT_CONNECTED, {
      hint: "Set KLAVIYO_API_KEY (pk_…) or PLUGIN_DATA/klaviyo.json. Local-free — no Polar, no stamp, not Consent A. Support never collects Klaviyo keys.",
      api: "klaviyo",
    });
  }
  const http = new KlaviyoHttp({
    credentials: creds,
    fetchImpl: ctx.fetchImpl,
    calls: ctx.calls as HttpCall[],
  });
  try {
    return await run(http, creds);
  } catch (err) {
    if (err instanceof ToolError) {
      return failEnvelope(tool, err.error_code, err.message, err.extra);
    }
    throw err;
  }
}

function cited(): { api_revision: string; host: string } {
  return { api_revision: KLAVIYO_API_REVISION, host: "a.klaviyo.com" };
}

function asList(data: unknown): KlaviyoResource[] {
  if (Array.isArray(data)) return data as KlaviyoResource[];
  if (data && typeof data === "object") return [data as KlaviyoResource];
  return [];
}

function pageSizeOf(args: Record<string, unknown>): number {
  return asInt(args.page_size, 20, 1, 100);
}

function pageTokenOf(args: Record<string, unknown>): string | undefined {
  return typeof args.page_token === "string" && args.page_token.trim()
    ? args.page_token.trim()
    : undefined;
}

function listPage(json: KlaviyoJson, rows: unknown[]): {
  row_count: number;
  truncated: boolean;
  next_page_token?: string;
} {
  const next = pageCursorFromNext(json.links?.next ?? undefined);
  return { row_count: rows.length, truncated: Boolean(next), next_page_token: next };
}

export function sparseProfileFields(extra?: unknown): string {
  const fields = new Set<string>(PROFILE_SPARSE_DEFAULT);
  if (Array.isArray(extra)) {
    for (const raw of extra) {
      if (typeof raw !== "string") continue;
      const f = raw.trim();
      if ((PROFILE_SPARSE_EXTRA as readonly string[]).includes(f)) fields.add(f);
    }
  }
  return [...fields].join(",");
}

export function sparsifyProfile(resource: KlaviyoResource | undefined): KlaviyoResource | null {
  if (!resource || typeof resource !== "object") return null;
  const attrs = resource.attributes && typeof resource.attributes === "object" ? { ...resource.attributes } : {};
  for (const key of PROFILE_STRIP) delete attrs[key];
  return {
    type: resource.type ?? "profile",
    id: resource.id,
    attributes: attrs,
  };
}

export function organizationName(account: KlaviyoResource | undefined): string | undefined {
  const contact = account?.attributes?.contact_information;
  if (contact && typeof contact === "object") {
    const name = (contact as { organization_name?: unknown }).organization_name;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  return undefined;
}

export async function loadAccount(
  http: KlaviyoHttp,
): Promise<{ id: string; display: string; account: KlaviyoResource }> {
  const json = await http.get("/api/accounts", { "fields[account]": ACCOUNT_FIELDS });
  const rows = asList(json.data);
  const account = rows[0];
  const id = account?.id?.trim();
  if (!account || !id) {
    throw new ToolError("NOT_FOUND", "Klaviyo returned no account for this private key.", {
      api: "klaviyo",
    });
  }
  return { id, display: organizationName(account) ?? id, account };
}

export async function klaviyoGetAccount(ctx: AppContext): Promise<Envelope> {
  return withKlaviyo(ctx, "klaviyo_get_account", async (http) => {
    const { id, display, account } = await loadAccount(http);
    return okEnvelope("klaviyo_get_account", {
      data: { account, cited: cited() },
      resource: { type: "klaviyo_account", id, display_name: display },
      page: { truncated: false, row_count: 1 },
      hint: "Local pk_ lane. Cite this account id in write confirm_phrase. Not Consent A. No Polar.",
    });
  });
}

export async function klaviyoListProfiles(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  return withKlaviyo(ctx, "klaviyo_list_profiles", async (http) => {
    const fields = sparseProfileFields(args.extra_fields);
    const query: Record<string, string | undefined> = {
      "fields[profile]": fields,
      "page[size]": String(pageSizeOf(args)),
      "page[cursor]": pageTokenOf(args),
    };
    if (typeof args.email === "string" && args.email.trim()) {
      const email = args.email.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new ToolError("INVALID_ARGUMENT", "email filter must be a single email address", {
          api: "klaviyo",
        });
      }
      query.filter = `equals(email,'${email.replace(/'/g, "")}')`;
    }
    const json = await http.get("/api/profiles", query);
    const profiles = asList(json.data).map((row) => sparsifyProfile(row)).filter(Boolean);
    return okEnvelope("klaviyo_list_profiles", {
      data: { profiles, cited: { ...cited(), fields } },
      page: listPage(json, profiles),
      hint: profiles.length === 0 ? HINT_EMPTY_LIST : "Sparse profile fields only — not a PII dump.",
    });
  });
}

export async function klaviyoGetProfile(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  return withKlaviyo(ctx, "klaviyo_get_profile", async (http) => {
    const id = requireId(args.profile_id, "profile_id");
    const fields = sparseProfileFields(args.extra_fields);
    const json = await http.get(`/api/profiles/${id}`, { "fields[profile]": fields });
    const profile = sparsifyProfile(json.data as KlaviyoResource | undefined);
    if (!profile?.id) {
      return failEnvelope("klaviyo_get_profile", "NOT_FOUND", MSG.NOT_FOUND, {
        resource_id: id,
        api: "klaviyo",
        hint: "Copy profile_id from klaviyo_list_profiles.",
      });
    }
    return okEnvelope("klaviyo_get_profile", {
      data: { profile, cited: { ...cited(), fields, profile_id: id } },
      resource: {
        type: "klaviyo_profile",
        id: profile.id,
        display_name: String(profile.attributes?.email ?? profile.id),
      },
      page: { truncated: false, row_count: 1 },
    });
  });
}

async function listCollection(
  ctx: AppContext,
  tool: string,
  path: string,
  key: string,
  args: Record<string, unknown>,
  extraQuery?: Record<string, string | undefined>,
): Promise<Envelope> {
  return withKlaviyo(ctx, tool, async (http) => {
    const json = await http.get(path, {
      "page[size]": String(pageSizeOf(args)),
      "page[cursor]": pageTokenOf(args),
      ...extraQuery,
    });
    const rows = asList(json.data);
    return okEnvelope(tool, {
      data: { [key]: rows, cited: cited() },
      page: listPage(json, rows),
      hint: rows.length === 0 ? HINT_EMPTY_LIST : undefined,
    });
  });
}

export async function klaviyoListLists(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  return listCollection(ctx, "klaviyo_list_lists", "/api/lists", "lists", args);
}

export async function klaviyoListSegments(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  return listCollection(ctx, "klaviyo_list_segments", "/api/segments", "segments", args);
}

export async function klaviyoListFlows(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  return listCollection(ctx, "klaviyo_list_flows", "/api/flows", "flows", args);
}

export async function klaviyoGetFlow(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  return withKlaviyo(ctx, "klaviyo_get_flow", async (http) => {
    const id = requireId(args.flow_id, "flow_id");
    const json = await http.get(`/api/flows/${id}`);
    const flow = json.data as KlaviyoResource | undefined;
    if (!flow?.id) {
      return failEnvelope("klaviyo_get_flow", "NOT_FOUND", MSG.NOT_FOUND, {
        resource_id: id,
        api: "klaviyo",
        hint: "Copy flow_id from klaviyo_list_flows.",
      });
    }
    const name = typeof flow.attributes?.name === "string" ? flow.attributes.name : flow.id;
    return okEnvelope("klaviyo_get_flow", {
      data: { flow, cited: { ...cited(), flow_id: id } },
      resource: { type: "klaviyo_flow", id: flow.id, display_name: name },
      page: { truncated: false, row_count: 1 },
    });
  });
}

export function campaignChannelFilter(raw: unknown): string {
  const channel = typeof raw === "string" && raw.trim() ? raw.trim() : "email";
  if (!CAMPAIGN_CHANNELS.has(channel)) {
    throw new ToolError("INVALID_ARGUMENT", "channel must be email, sms, or mobile_push", {
      api: "klaviyo",
    });
  }
  return `equals(messages.channel,'${channel}')`;
}

export async function klaviyoListCampaigns(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  return listCollection(ctx, "klaviyo_list_campaigns", "/api/campaigns", "campaigns", args, {
    filter: campaignChannelFilter(args.channel),
  });
}

export async function klaviyoListMetrics(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  return listCollection(ctx, "klaviyo_list_metrics", "/api/metrics", "metrics", args);
}
