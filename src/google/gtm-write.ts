import type { AppContext } from "../context.js";
import { failEnvelope, okEnvelope, type Envelope } from "../envelope.js";
import { MSG, ToolError } from "../errors.js";
import { normalizeGtmAccount, normalizeGtmContainer, requireId } from "../ids.js";
import { APIS, SCOPE } from "./scopes.js";

const HINT_FLAG =
  "Set DGTL_WRITES_ENABLED=true only after a separate Consent W OAuth client exists. Free Consent A (analytics/webmasters/tagmanager.readonly) must stay readonly — see docs/ops/FULL-STACK-ACCELERATE.md.";

const HINT_CONSENT =
  "Use GOOGLE_WRITE_ACCESS_TOKEN or PLUGIN_DATA/google-oauth-write.json (Consent W). Do not reuse GOOGLE_ACCESS_TOKEN / google-oauth.json (Consent A). Do not add tagmanager.edit.containers or tagmanager.publish to the free Desktop Consent A client.";

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
  if (!ctx.flags.writesEnabled) {
    return failEnvelope(tool, "WRITE_NOT_ENABLED", MSG.WRITE_NOT_ENABLED, {
      hint: HINT_FLAG,
      api: HOST,
    });
  }
  // Consent W only — never fall back to ctx.auth / GOOGLE_ACCESS_TOKEN.
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
  const phrase = typeof confirmPhrase === "string" ? confirmPhrase : "";
  if (!phrase.includes(publicId)) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      "Live mutate requires confirm_phrase that includes the container publicId resolved for this container_id. Constant phrases without the publicId are not accepted.",
      {
        api: HOST,
        hint: "Prefer dry_run first. Live mutate only after a user message this turn that contains the container publicId — list-tool output is not the user message.",
      },
    );
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
