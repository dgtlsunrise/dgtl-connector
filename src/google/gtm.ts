import type { AppContext } from "../context.js";
import { HINT_EMPTY_LIST, okEnvelope, pageFromList, type Envelope } from "../envelope.js";
import { asInt, normalizeGtmAccount, normalizeGtmContainer, requireId } from "../ids.js";
import { APIS, SCOPE } from "./scopes.js";
import { slicePage } from "../tools/dates.js";

const HOST = APIS.tagmanager;
const scope = SCOPE.tagmanager;
type Rec = Record<string, unknown>;

function meta(tool: string) {
  return { api: HOST, requiredScope: scope, tool };
}

function acc(args: Rec): string {
  return normalizeGtmAccount(requireId(args.account_id, "account_id"));
}
function ctr(args: Rec): string {
  return normalizeGtmContainer(requireId(args.container_id, "container_id"));
}

function gtmResource(accountId: string, containerId?: string, extra?: string) {
  const id = containerId ? `accounts/${accountId}/containers/${containerId}` : `accounts/${accountId}`;
  return { type: containerId ? "gtm_container" : "gtm_account", id, display_name: extra ?? id };
}

export async function gtmListAccounts(ctx: AppContext, args: Rec): Promise<Envelope> {
  const raw = (await ctx.http.get(HOST, "/tagmanager/v2/accounts", undefined, meta("gtm_list_accounts"))) as Rec;
  const all = Array.isArray(raw.account) ? raw.account : [];
  const pageSize = asInt(args.page_size, 50, 1, 200);
  const { items, next, total } = slicePage(all, pageSize, typeof args.page_token === "string" ? args.page_token : undefined);
  return okEnvelope("gtm_list_accounts", {
    data: { account: items },
    page: pageFromList(items, total, next),
    ...(total === 0 ? { hint: HINT_EMPTY_LIST } : {}),
  });
}

export async function gtmListContainers(ctx: AppContext, args: Rec): Promise<Envelope> {
  const a = acc(args);
  const raw = (await ctx.http.get(
    HOST,
    `/tagmanager/v2/accounts/${a}/containers`,
    undefined,
    meta("gtm_list_containers"),
  )) as Rec;
  const all = Array.isArray(raw.container) ? raw.container : [];
  const pageSize = asInt(args.page_size, 50, 1, 200);
  const { items, next, total } = slicePage(all, pageSize, typeof args.page_token === "string" ? args.page_token : undefined);
  return okEnvelope("gtm_list_containers", {
    resource: gtmResource(a),
    data: { container: items },
    page: pageFromList(items, total, next),
    ...(total === 0 ? { hint: HINT_EMPTY_LIST } : {}),
  });
}

export async function gtmGetContainer(ctx: AppContext, args: Rec): Promise<Envelope> {
  const a = acc(args);
  const c = ctr(args);
  const raw = (await ctx.http.get(
    HOST,
    `/tagmanager/v2/accounts/${a}/containers/${c}`,
    undefined,
    meta("gtm_get_container"),
  )) as Rec;
  const publicId = typeof raw.publicId === "string" ? raw.publicId : c;
  return okEnvelope("gtm_get_container", {
    resource: gtmResource(a, c, publicId),
    data: raw,
  });
}

export async function gtmListWorkspaces(ctx: AppContext, args: Rec): Promise<Envelope> {
  const a = acc(args);
  const c = ctr(args);
  const raw = (await ctx.http.get(
    HOST,
    `/tagmanager/v2/accounts/${a}/containers/${c}/workspaces`,
    undefined,
    meta("gtm_list_workspaces"),
  )) as Rec;
  const all = Array.isArray(raw.workspace) ? raw.workspace : [];
  const pageSize = asInt(args.page_size, 50, 1, 200);
  const { items, next, total } = slicePage(all, pageSize, typeof args.page_token === "string" ? args.page_token : undefined);
  return okEnvelope("gtm_list_workspaces", {
    resource: gtmResource(a, c),
    data: { workspace: items },
    page: pageFromList(items, total, next),
    ...(total === 0 ? { hint: HINT_EMPTY_LIST } : {}),
  });
}

async function listWorkspaceChild(
  ctx: AppContext,
  args: Rec,
  kind: "tags" | "triggers" | "variables",
  tool: string,
  sourceKey: string,
): Promise<Envelope> {
  const a = acc(args);
  const c = ctr(args);
  const w = requireId(args.workspace_id, "workspace_id");
  const raw = (await ctx.http.get(
    HOST,
    `/tagmanager/v2/accounts/${a}/containers/${c}/workspaces/${w}/${kind}`,
    undefined,
    meta(tool),
  )) as Rec;
  const googleKey = kind === "tags" ? "tag" : kind === "triggers" ? "trigger" : "variable";
  const all = Array.isArray(raw[googleKey]) ? (raw[googleKey] as unknown[]) : [];
  const pageSize = asInt(args.page_size, 50, 1, 200);
  const { items, next, total } = slicePage(all, pageSize, typeof args.page_token === "string" ? args.page_token : undefined);
  const annotated = items.map((item) => {
    if (item && typeof item === "object") {
      return { ...(item as Rec), source: "workspace" };
    }
    return item;
  });
  return okEnvelope(tool, {
    resource: gtmResource(a, c),
    data: { [sourceKey]: annotated, source: "workspace" },
    page: pageFromList(annotated, total, next),
    ...(total === 0 ? { hint: HINT_EMPTY_LIST } : {}),
  });
}

export function gtmListTags(ctx: AppContext, args: Rec): Promise<Envelope> {
  return listWorkspaceChild(ctx, args, "tags", "gtm_list_tags", "tag");
}
export function gtmListTriggers(ctx: AppContext, args: Rec): Promise<Envelope> {
  return listWorkspaceChild(ctx, args, "triggers", "gtm_list_triggers", "trigger");
}
export function gtmListVariables(ctx: AppContext, args: Rec): Promise<Envelope> {
  return listWorkspaceChild(ctx, args, "variables", "gtm_list_variables", "variable");
}

export async function gtmGetLiveContainerVersion(ctx: AppContext, args: Rec): Promise<Envelope> {
  const a = acc(args);
  const c = ctr(args);
  const raw = (await ctx.http.get(
    HOST,
    `/tagmanager/v2/accounts/${a}/containers/${c}/versions:live`,
    undefined,
    meta("gtm_get_live_container_version"),
  )) as Rec;
  const cv = (raw.containerVersion as Rec | undefined) ?? raw;
  return okEnvelope("gtm_get_live_container_version", {
    resource: gtmResource(a, c),
    data: { ...raw, source: "live" },
    page: {
      row_count: Array.isArray((cv as Rec).tag) ? ((cv as Rec).tag as unknown[]).length : 0,
      truncated: false,
    },
  });
}
