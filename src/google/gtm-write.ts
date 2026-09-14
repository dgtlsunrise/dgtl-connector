import type { AppContext } from "../context.js";
import { failEnvelope, okEnvelope, type Envelope } from "../envelope.js";
import { MSG, ToolError } from "../errors.js";
import { normalizeGtmAccount, normalizeGtmContainer, requireId } from "../ids.js";
import {
  gtmClientTypeError,
  gtmUsageContextError,
  isDeniedGtmIngestParamKey,
  isGtmClientType,
  isGtmUsageContext,
  type GtmUsageContext,
} from "./gtm-types.js";
import { APIS, SCOPE } from "./scopes.js";

const HINT_CONSENT =
  "Use Free Google (`auth login` / GOOGLE_ACCESS_TOKEN with GTM write scopes) or a legacy GOOGLE_WRITE_ACCESS_TOKEN / google-oauth-write.json. Do not add adwords, content, or business.manage to Free Google.";

const HOST = APIS.tagmanager;
type Rec = Record<string, unknown>;

/**
 * Harness / eval rule (not enforceable inside MCP dispatch alone):
 * live mutate without a **user** message this turn containing the resolved
 * publicId is a fail. List-tool output is not the user message.
 */
export function harnessUserMessageContainsPublicId(opts: {
  userMessageThisTurn: string | null | undefined;
  publicId: string;
}): boolean {
  const msg = opts.userMessageThisTurn;
  if (msg == null || msg === "") return false;
  return msg.includes(opts.publicId);
}

function dryRunDefault(args: Rec): boolean {
  // Default true in code — omitted / undefined / true → dry-run; only explicit false is live.
  return args.dry_run !== false;
}

async function gateWrites(tool: string, ctx: AppContext): Promise<Envelope | null> {
  const writeTok = await ctx.authWrite.getAccessToken();
  if (!writeTok?.accessToken) {
    return failEnvelope(tool, "CONSENT_W_REQUIRED", MSG.CONSENT_W_REQUIRED, {
      hint: HINT_CONSENT,
      api: HOST,
      missing_scope: SCOPE.tagmanagerEditContainers,
    });
  }
  return null;
}

function ids(args: Rec): { accountId: string; containerId: string; workspaceId: string } {
  return {
    accountId: normalizeGtmAccount(requireId(args.account_id, "account_id")),
    containerId: normalizeGtmContainer(requireId(args.container_id, "container_id")),
    workspaceId: requireId(args.workspace_id, "workspace_id"),
  };
}

function containerPath(accountId: string, containerId: string): string {
  return `/tagmanager/v2/accounts/${accountId}/containers/${containerId}`;
}

function workspacePath(accountId: string, containerId: string, workspaceId: string): string {
  return `${containerPath(accountId, containerId)}/workspaces/${workspaceId}`;
}

async function resolveContainerPublicId(
  ctx: AppContext,
  tool: string,
  accountId: string,
  containerId: string,
): Promise<{ publicId: string; container: Rec }> {
  const raw = (await ctx.httpWrite.get(containerPath(accountId, containerId), undefined, {
    tool,
    requiredScope: SCOPE.tagmanagerEditContainers,
  })) as Rec;
  const publicId = typeof raw.publicId === "string" && raw.publicId ? raw.publicId : "";
  if (!publicId) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      "Could not resolve container publicId (GTM-XXXX) for confirm. Re-list containers and pass a real container_id.",
      { api: HOST, resource_id: containerId },
    );
  }
  return { publicId, container: raw };
}

async function resolveWorkspaceName(
  ctx: AppContext,
  tool: string,
  accountId: string,
  containerId: string,
  workspaceId: string,
): Promise<string> {
  try {
    const raw = (await ctx.httpWrite.get(workspacePath(accountId, containerId, workspaceId), undefined, {
      tool,
      requiredScope: SCOPE.tagmanagerEditContainers,
    })) as Rec;
    return typeof raw.name === "string" && raw.name ? raw.name : workspaceId;
  } catch {
    return workspaceId;
  }
}

function assertConfirmContainsPublicId(confirmPhrase: unknown, publicId: string): void {
  assertConfirmContainsPublicIdOrPath(confirmPhrase, publicId);
}

function assertConfirmContainsPublicIdOrPath(
  confirmPhrase: unknown,
  publicId: string,
  containerPath?: string,
): void {
  const phrase = typeof confirmPhrase === "string" ? confirmPhrase : "";
  const pathOk = containerPath ? phrase.includes(containerPath) : false;
  if (!phrase.includes(publicId) && !pathOk) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      containerPath
        ? "Live mutate requires confirm_phrase that includes the container publicId or container path (accounts/{id}/containers/{id}) resolved for this container_id. Constant phrases without that target are not accepted."
        : "Live mutate requires confirm_phrase that includes the container publicId resolved for this container_id. Constant phrases without the publicId are not accepted.",
      {
        api: HOST,
        hint: "Prefer dry_run first. Live mutate only after a user message this turn that contains the container publicId or path — list-tool output is not the user message.",
      },
    );
  }
}

function assertConfirmContains(confirmPhrase: unknown, needle: string, label: string): void {
  const phrase = typeof confirmPhrase === "string" ? confirmPhrase : "";
  if (!phrase.includes(needle)) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      `Live mutate requires confirm_phrase that includes ${label} (${needle}). Constant phrases without that target are not accepted.`,
      {
        api: HOST,
        hint: "Prefer dry_run first. Live mutate only after a user message this turn that contains that path — list-tool output is not the user message.",
      },
    );
  }
}

function assertClientType(type: string): void {
  if (!isGtmClientType(type)) {
    throw new ToolError("INVALID_ARGUMENT", gtmClientTypeError(type), { api: HOST });
  }
}

function normalizeUsageContexts(raw: unknown): GtmUsageContext[] {
  const values = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
  if (values.length === 0) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      "usage_context is required (closed enum: web, android, ios, amp, server). Use server for sGTM.",
      { api: HOST },
    );
  }
  const out: GtmUsageContext[] = [];
  for (const v of values) {
    if (!isGtmUsageContext(v)) {
      throw new ToolError("INVALID_ARGUMENT", gtmUsageContextError(v), { api: HOST });
    }
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

function assertNoIngestParamKeys(parameter: Rec[] | undefined): void {
  if (!parameter) return;
  for (const p of parameter) {
    const key = typeof p.key === "string" ? p.key : "";
    if (key && isDeniedGtmIngestParamKey(key)) {
      throw new ToolError(
        "INVALID_ARGUMENT",
        `Client parameter key ${JSON.stringify(key)} looks like a stamp ingest secret. Do not put stamp ingest keys in GTM clients or web GTM variables (Wave 20).`,
        { api: HOST },
      );
    }
  }
}

function gtmResource(accountId: string, containerId: string, displayName: string) {
  return {
    type: "gtm_container",
    id: `accounts/${accountId}/containers/${containerId}`,
    display_name: displayName,
  };
}

export async function gtmCreateTag(ctx: AppContext, args: Rec): Promise<Envelope> {
  const tool = "gtm_create_tag";
  const gated = await gateWrites(tool, ctx);
  if (gated) return gated;

  const { accountId, containerId, workspaceId } = ids(args);
  const name = requireId(args.name, "name");
  const type = requireId(args.type, "type");
  const dryRun = dryRunDefault(args);

  const { publicId } = await resolveContainerPublicId(ctx, tool, accountId, containerId);
  const workspaceName = await resolveWorkspaceName(ctx, tool, accountId, containerId, workspaceId);
  const proposed = { name, type };

  if (dryRun) {
    return okEnvelope(tool, {
      resource: gtmResource(accountId, containerId, publicId),
      data: {
        dry_run: true,
        publicId,
        workspace_id: workspaceId,
        workspace_name: workspaceName,
        proposed,
        note: "No Google mutate. Pass dry_run=false with confirm_phrase containing this publicId only after a user message this turn that includes it.",
      },
    });
  }

  assertConfirmContainsPublicId(args.confirm_phrase, publicId);

  const created = await ctx.httpWrite.post(`${workspacePath(accountId, containerId, workspaceId)}/tags`, proposed, {
    tool,
    requiredScope: SCOPE.tagmanagerEditContainers,
  });

  return okEnvelope(tool, {
    resource: gtmResource(accountId, containerId, publicId),
    data: { dry_run: false, publicId, tag: created },
  });
}

export async function gtmUpdateTag(ctx: AppContext, args: Rec): Promise<Envelope> {
  const tool = "gtm_update_tag";
  const gated = await gateWrites(tool, ctx);
  if (gated) return gated;

  const { accountId, containerId, workspaceId } = ids(args);
  const tagId = requireId(args.tag_id, "tag_id");
  const name = requireId(args.name, "name");
  const type = requireId(args.type, "type");
  const dryRun = dryRunDefault(args);

  const { publicId } = await resolveContainerPublicId(ctx, tool, accountId, containerId);
  const workspaceName = await resolveWorkspaceName(ctx, tool, accountId, containerId, workspaceId);
  const proposed = { name, type, tagId };

  if (dryRun) {
    return okEnvelope(tool, {
      resource: gtmResource(accountId, containerId, publicId),
      data: {
        dry_run: true,
        publicId,
        workspace_id: workspaceId,
        workspace_name: workspaceName,
        proposed,
        note: "No Google mutate. Pass dry_run=false with confirm_phrase containing this publicId only after a user message this turn that includes it.",
      },
    });
  }

  assertConfirmContainsPublicId(args.confirm_phrase, publicId);

  const updated = await ctx.httpWrite.put(
    `${workspacePath(accountId, containerId, workspaceId)}/tags/${tagId}`,
    { name, type },
    {
      tool,
      requiredScope: SCOPE.tagmanagerEditContainers,
    },
  );

  return okEnvelope(tool, {
    resource: gtmResource(accountId, containerId, publicId),
    data: { dry_run: false, publicId, tag: updated },
  });
}

function gtmParameters(raw: unknown): Rec[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: Rec[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Rec;
    if (typeof rec.type !== "string" || !rec.type) continue;
    const param: Rec = { type: rec.type };
    if (typeof rec.key === "string" && rec.key) param.key = rec.key;
    if (typeof rec.value === "string") param.value = rec.value;
    out.push(param);
  }
  return out.length ? out : undefined;
}

async function mutateWorkspaceChild(
  ctx: AppContext,
  opts: {
    tool: string;
    args: Rec;
    collection: "triggers" | "variables";
    resultKey: "trigger" | "variable";
    method: "POST" | "PUT";
    childId?: string;
    proposed: Rec;
  },
): Promise<Envelope> {
  const gated = await gateWrites(opts.tool, ctx);
  if (gated) return gated;

  const { accountId, containerId, workspaceId } = ids(opts.args);
  const dryRun = dryRunDefault(opts.args);
  const { publicId } = await resolveContainerPublicId(ctx, opts.tool, accountId, containerId);
  const workspaceName = await resolveWorkspaceName(ctx, opts.tool, accountId, containerId, workspaceId);

  if (dryRun) {
    return okEnvelope(opts.tool, {
      resource: gtmResource(accountId, containerId, publicId),
      data: {
        dry_run: true,
        publicId,
        workspace_id: workspaceId,
        workspace_name: workspaceName,
        proposed: opts.proposed,
        note: "No Google mutate. Pass dry_run=false with confirm_phrase containing this publicId only after a user message this turn that includes it.",
      },
    });
  }

  assertConfirmContainsPublicId(opts.args.confirm_phrase, publicId);

  const base = workspacePath(accountId, containerId, workspaceId);
  const path = opts.childId ? `${base}/${opts.collection}/${opts.childId}` : `${base}/${opts.collection}`;
  const body = { ...opts.proposed };
  delete body.triggerId;
  delete body.variableId;

  const result =
    opts.method === "POST"
      ? await ctx.httpWrite.post(path, body, {
          tool: opts.tool,
          requiredScope: SCOPE.tagmanagerEditContainers,
        })
      : await ctx.httpWrite.put(path, body, {
          tool: opts.tool,
          requiredScope: SCOPE.tagmanagerEditContainers,
        });

  return okEnvelope(opts.tool, {
    resource: gtmResource(accountId, containerId, publicId),
    data: { dry_run: false, publicId, [opts.resultKey]: result },
  });
}

export async function gtmCreateTrigger(ctx: AppContext, args: Rec): Promise<Envelope> {
  const name = requireId(args.name, "name");
  const type = requireId(args.type, "type");
  const proposed: Rec = { name, type };
  const parameter = gtmParameters(args.parameter);
  if (parameter) proposed.parameter = parameter;
  return mutateWorkspaceChild(ctx, {
    tool: "gtm_create_trigger",
    args,
    collection: "triggers",
    resultKey: "trigger",
    method: "POST",
    proposed,
  });
}

export async function gtmUpdateTrigger(ctx: AppContext, args: Rec): Promise<Envelope> {
  const triggerId = requireId(args.trigger_id, "trigger_id");
  const name = requireId(args.name, "name");
  const type = requireId(args.type, "type");
  const proposed: Rec = { name, type, triggerId };
  const parameter = gtmParameters(args.parameter);
  if (parameter) proposed.parameter = parameter;
  return mutateWorkspaceChild(ctx, {
    tool: "gtm_update_trigger",
    args,
    collection: "triggers",
    resultKey: "trigger",
    method: "PUT",
    childId: triggerId,
    proposed,
  });
}

export async function gtmCreateVariable(ctx: AppContext, args: Rec): Promise<Envelope> {
  const name = requireId(args.name, "name");
  const type = requireId(args.type, "type");
  const proposed: Rec = { name, type };
  const parameter = gtmParameters(args.parameter);
  if (parameter) proposed.parameter = parameter;
  return mutateWorkspaceChild(ctx, {
    tool: "gtm_create_variable",
    args,
    collection: "variables",
    resultKey: "variable",
    method: "POST",
    proposed,
  });
}

export async function gtmUpdateVariable(ctx: AppContext, args: Rec): Promise<Envelope> {
  const variableId = requireId(args.variable_id, "variable_id");
  const name = requireId(args.name, "name");
  const type = requireId(args.type, "type");
  const proposed: Rec = { name, type, variableId };
  const parameter = gtmParameters(args.parameter);
  if (parameter) proposed.parameter = parameter;
  return mutateWorkspaceChild(ctx, {
    tool: "gtm_update_variable",
    args,
    collection: "variables",
    resultKey: "variable",
    method: "PUT",
    childId: variableId,
    proposed,
  });
}

async function mutateWorkspaceClient(
  ctx: AppContext,
  opts: {
    tool: string;
    args: Rec;
    method: "POST" | "PUT";
    clientId?: string;
    proposed: Rec;
  },
): Promise<Envelope> {
  const gated = await gateWrites(opts.tool, ctx);
  if (gated) return gated;

  assertClientType(requireId(opts.proposed.type, "type"));
  assertNoIngestParamKeys(Array.isArray(opts.proposed.parameter) ? (opts.proposed.parameter as Rec[]) : undefined);

  const { accountId, containerId, workspaceId } = ids(opts.args);
  const dryRun = dryRunDefault(opts.args);
  const { publicId } = await resolveContainerPublicId(ctx, opts.tool, accountId, containerId);
  const workspaceName = await resolveWorkspaceName(ctx, opts.tool, accountId, containerId, workspaceId);
  const containerPathStr = `accounts/${accountId}/containers/${containerId}`;

  if (dryRun) {
    return okEnvelope(opts.tool, {
      resource: gtmResource(accountId, containerId, publicId),
      data: {
        dry_run: true,
        publicId,
        container_path: containerPathStr,
        workspace_id: workspaceId,
        workspace_name: workspaceName,
        proposed: opts.proposed,
        note: "No Google mutate. Pass dry_run=false with confirm_phrase containing this publicId or container_path only after a user message this turn that includes it.",
      },
    });
  }

  assertConfirmContainsPublicIdOrPath(opts.args.confirm_phrase, publicId, containerPathStr);

  const base = `${workspacePath(accountId, containerId, workspaceId)}/clients`;
  const path = opts.clientId ? `${base}/${opts.clientId}` : base;
  const body = { ...opts.proposed };
  delete body.clientId;

  const result =
    opts.method === "POST"
      ? await ctx.httpWrite.post(path, body, {
          tool: opts.tool,
          requiredScope: SCOPE.tagmanagerEditContainers,
        })
      : await ctx.httpWrite.put(path, body, {
          tool: opts.tool,
          requiredScope: SCOPE.tagmanagerEditContainers,
        });

  return okEnvelope(opts.tool, {
    resource: gtmResource(accountId, containerId, publicId),
    data: { dry_run: false, publicId, container_path: containerPathStr, client: result },
  });
}

export async function gtmCreateClient(ctx: AppContext, args: Rec): Promise<Envelope> {
  const name = requireId(args.name, "name");
  const type = requireId(args.type, "type");
  const proposed: Rec = { name, type };
  const parameter = gtmParameters(args.parameter);
  if (parameter) proposed.parameter = parameter;
  if (typeof args.priority === "number" && Number.isFinite(args.priority)) {
    proposed.priority = Math.trunc(args.priority);
  }
  if (typeof args.notes === "string" && args.notes) proposed.notes = args.notes;
  return mutateWorkspaceClient(ctx, {
    tool: "gtm_create_client",
    args,
    method: "POST",
    proposed,
  });
}

export async function gtmUpdateClient(ctx: AppContext, args: Rec): Promise<Envelope> {
  const clientId = requireId(args.client_id, "client_id");
  const name = requireId(args.name, "name");
  const type = requireId(args.type, "type");
  const proposed: Rec = { name, type, clientId };
  const parameter = gtmParameters(args.parameter);
  if (parameter) proposed.parameter = parameter;
  if (typeof args.priority === "number" && Number.isFinite(args.priority)) {
    proposed.priority = Math.trunc(args.priority);
  }
  if (typeof args.notes === "string" && args.notes) proposed.notes = args.notes;
  return mutateWorkspaceClient(ctx, {
    tool: "gtm_update_client",
    args,
    method: "PUT",
    clientId,
    proposed,
  });
}

export async function gtmCreateContainer(ctx: AppContext, args: Rec): Promise<Envelope> {
  const tool = "gtm_create_container";
  const gated = await gateWrites(tool, ctx);
  if (gated) return gated;

  const accountId = normalizeGtmAccount(requireId(args.account_id, "account_id"));
  const name = requireId(args.name, "name");
  const usageContext = normalizeUsageContexts(args.usage_context);
  const dryRun = dryRunDefault(args);
  const accountPath = `accounts/${accountId}`;
  const proposed: Rec = { name, usageContext };
  if (typeof args.notes === "string" && args.notes) proposed.notes = args.notes;

  if (dryRun) {
    return okEnvelope(tool, {
      resource: { type: "gtm_account", id: accountPath, display_name: accountPath },
      data: {
        dry_run: true,
        account_path: accountPath,
        proposed,
        note: "No Google mutate. Pass dry_run=false with confirm_phrase containing this account_path only after a user message this turn that includes it. Prefer usageContext=server for sGTM.",
      },
    });
  }

  assertConfirmContains(args.confirm_phrase, accountPath, "account path");

  const created = await ctx.httpWrite.post(`/tagmanager/v2/accounts/${accountId}/containers`, proposed, {
    tool,
    requiredScope: SCOPE.tagmanagerEditContainers,
  });

  return okEnvelope(tool, {
    resource: { type: "gtm_account", id: accountPath, display_name: accountPath },
    data: { dry_run: false, account_path: accountPath, container: created },
  });
}

export async function gtmCreateEnvironment(ctx: AppContext, args: Rec): Promise<Envelope> {
  const tool = "gtm_create_environment";
  const gated = await gateWrites(tool, ctx);
  if (gated) return gated;

  const accountId = normalizeGtmAccount(requireId(args.account_id, "account_id"));
  const containerId = normalizeGtmContainer(requireId(args.container_id, "container_id"));
  const name = requireId(args.name, "name");
  const dryRun = dryRunDefault(args);
  const { publicId } = await resolveContainerPublicId(ctx, tool, accountId, containerId);
  const containerPathStr = `accounts/${accountId}/containers/${containerId}`;
  const proposed: Rec = { name };
  if (typeof args.description === "string" && args.description) proposed.description = args.description;
  if (typeof args.url === "string" && args.url) proposed.url = args.url;
  if (typeof args.enable_debug === "boolean") proposed.enableDebug = args.enable_debug;

  if (dryRun) {
    return okEnvelope(tool, {
      resource: gtmResource(accountId, containerId, publicId),
      data: {
        dry_run: true,
        publicId,
        container_path: containerPathStr,
        proposed,
        note: "No Google mutate. Creates a USER environment. Pass dry_run=false with confirm_phrase containing this publicId or container_path only after a user message this turn that includes it.",
      },
    });
  }

  assertConfirmContainsPublicIdOrPath(args.confirm_phrase, publicId, containerPathStr);

  const created = await ctx.httpWrite.post(
    `${containerPath(accountId, containerId)}/environments`,
    proposed,
    {
      tool,
      requiredScope: SCOPE.tagmanagerEditContainers,
    },
  );

  return okEnvelope(tool, {
    resource: gtmResource(accountId, containerId, publicId),
    data: { dry_run: false, publicId, container_path: containerPathStr, environment: created },
  });
}

export async function gtmPublishContainer(ctx: AppContext, args: Rec): Promise<Envelope> {
  const tool = "gtm_publish_container";
  const gated = await gateWrites(tool, ctx);
  if (gated) return gated;

  const { accountId, containerId, workspaceId } = ids(args);
  const dryRun = dryRunDefault(args);
  const versionName = typeof args.version_name === "string" ? args.version_name : undefined;
  const versionNotes = typeof args.version_notes === "string" ? args.version_notes : undefined;

  const { publicId } = await resolveContainerPublicId(ctx, tool, accountId, containerId);
  const workspaceName = await resolveWorkspaceName(ctx, tool, accountId, containerId, workspaceId);
  const proposed = {
    action: "create_version_then_publish",
    workspace_id: workspaceId,
    workspace_name: workspaceName,
    version_name: versionName ?? null,
    version_notes: versionNotes ?? null,
  };

  if (dryRun) {
    return okEnvelope(tool, {
      resource: gtmResource(accountId, containerId, publicId),
      data: {
        dry_run: true,
        publicId,
        proposed,
        note: "No Google publish. Pass dry_run=false with confirm_phrase containing this publicId only after a user message this turn that includes it. Publish is irreversible.",
      },
    });
  }

  assertConfirmContainsPublicId(args.confirm_phrase, publicId);

  const versionBody: Rec = {};
  if (versionName) versionBody.name = versionName;
  if (versionNotes) versionBody.notes = versionNotes;

  const created = (await ctx.httpWrite.post(
    `${workspacePath(accountId, containerId, workspaceId)}:create_version`,
    versionBody,
    {
      tool,
      // create_version is part of the publish path; W token must cover edit/publish.
      requiredScope: SCOPE.tagmanagerEditContainers,
    },
  )) as Rec;

  const containerVersion = (created.containerVersion ?? created) as Rec;
  const versionPath =
    typeof containerVersion.path === "string"
      ? containerVersion.path
      : typeof containerVersion.containerVersionId === "string"
        ? `accounts/${accountId}/containers/${containerId}/versions/${containerVersion.containerVersionId}`
        : null;

  if (!versionPath) {
    throw new ToolError(
      "GOOGLE_UNAVAILABLE",
      "create_version did not return a container version path to publish.",
      { api: HOST },
    );
  }

  const publishPath = versionPath.startsWith("/tagmanager/v2/")
    ? versionPath
    : `/tagmanager/v2/${versionPath.replace(/^\//, "")}`;

  const published = await ctx.httpWrite.post(`${publishPath}:publish`, {}, {
    tool,
    requiredScope: SCOPE.tagmanagerPublish,
  });

  return okEnvelope(tool, {
    resource: gtmResource(accountId, containerId, publicId),
    data: {
      dry_run: false,
      publicId,
      create_version: created,
      publish: published,
    },
  });
}

/** @deprecated Gate-only stub kept for tests that import the name; prefer tool handlers. */
export async function gtmWriteNotReady(tool: string, ctx: AppContext): Promise<Envelope> {
  const gated = await gateWrites(tool, ctx);
  if (gated) return gated;
  return failEnvelope(tool, "CONSENT_W_REQUIRED", MSG.CONSENT_W_REQUIRED, {
    hint: HINT_CONSENT,
    api: HOST,
  });
}
