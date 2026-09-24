import type { ReadCtx } from "./reads";
import { json } from "./http";
import { GTM_ORIGIN, googleObject, readAccess } from "./google";
import { EMPTY_LIST_HINT, listBody, readPage, slicePage } from "./paging";
import { arrayField, requireDigits } from "./validate";

const DRAFT_HINT =
  "source=workspace (draft). This is not the live published container. Use GET .../versions/live for what is on the site.";

const LIVE_HINT =
  "source=live (published). This is what is on the site. Workspace tag, trigger, and variable lists may include unpublished drafts.";

type WorkspaceKind = "tags" | "triggers" | "variables" | "clients";

const GOOGLE_KEY: Record<WorkspaceKind, string> = {
  tags: "tag",
  triggers: "trigger",
  variables: "variable",
  clients: "client",
};

function withWorkspaceSource(items: readonly unknown[]): unknown[] {
  return items.map((item) => {
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      return { ...item, source: "workspace" };
    }
    return item;
  });
}

async function gtmRecord(
  ctx: ReadCtx,
  path: string,
): Promise<
  | { readonly kind: "record"; readonly record: Record<string, unknown> }
  | { readonly kind: "response"; readonly response: Response }
> {
  const token = await readAccess(ctx.grant, ctx.env, "gtm");
  if (token instanceof Response) {
    return { kind: "response", response: token };
  }
  return googleObject("gtm", token, `${GTM_ORIGIN}${path}`, { method: "GET" });
}

export async function listGtmAccounts(ctx: ReadCtx): Promise<Response> {
  const page = readPage(ctx.url);
  if (page instanceof Response) {
    return page;
  }
  const got = await gtmRecord(ctx, "/tagmanager/v2/accounts");
  switch (got.kind) {
    case "response":
      return got.response;
    case "record": {
      const sliced = slicePage(arrayField(got.record, "account"), page.pageSize, page.pageToken);
      if (sliced instanceof Response) {
        return sliced;
      }
      const hint = sliced.items.length === 0 && page.pageToken === undefined ? EMPTY_LIST_HINT : undefined;
      return json(listBody("account", sliced.items, sliced.next, hint), 200);
    }
    default: {
      const unexpected: never = got;
      return unexpected;
    }
  }
}

export async function listGtmContainers(ctx: ReadCtx): Promise<Response> {
  const accountId = requireDigits(ctx.params[0], "account_id");
  if (accountId instanceof Response) {
    return accountId;
  }
  const page = readPage(ctx.url);
  if (page instanceof Response) {
    return page;
  }
  const got = await gtmRecord(ctx, `/tagmanager/v2/accounts/${accountId}/containers`);
  switch (got.kind) {
    case "response":
      return got.response;
    case "record": {
      const sliced = slicePage(arrayField(got.record, "container"), page.pageSize, page.pageToken);
      if (sliced instanceof Response) {
        return sliced;
      }
      const hint = sliced.items.length === 0 && page.pageToken === undefined ? EMPTY_LIST_HINT : undefined;
      return json(listBody("container", sliced.items, sliced.next, hint, { account_id: accountId }), 200);
    }
    default: {
      const unexpected: never = got;
      return unexpected;
    }
  }
}

export async function getGtmContainer(ctx: ReadCtx): Promise<Response> {
  const accountId = requireDigits(ctx.params[0], "account_id");
  if (accountId instanceof Response) {
    return accountId;
  }
  const containerId = requireDigits(ctx.params[1], "container_id");
  if (containerId instanceof Response) {
    return containerId;
  }
  const got = await gtmRecord(ctx, `/tagmanager/v2/accounts/${accountId}/containers/${containerId}`);
  switch (got.kind) {
    case "response":
      return got.response;
    case "record":
      return json({ account_id: accountId, container_id: containerId, resource: got.record }, 200);
    default: {
      const unexpected: never = got;
      return unexpected;
    }
  }
}

export async function listGtmWorkspaces(ctx: ReadCtx): Promise<Response> {
  const accountId = requireDigits(ctx.params[0], "account_id");
  if (accountId instanceof Response) {
    return accountId;
  }
  const containerId = requireDigits(ctx.params[1], "container_id");
  if (containerId instanceof Response) {
    return containerId;
  }
  const page = readPage(ctx.url);
  if (page instanceof Response) {
    return page;
  }
  const got = await gtmRecord(
    ctx,
    `/tagmanager/v2/accounts/${accountId}/containers/${containerId}/workspaces`,
  );
  switch (got.kind) {
    case "response":
      return got.response;
    case "record": {
      const all = arrayField(got.record, "workspace");
      const sliced = slicePage(all, page.pageSize, page.pageToken);
      if (sliced instanceof Response) {
        return sliced;
      }
      const hint =
        all.length === 0
          ? EMPTY_LIST_HINT
          : all.length > 1
            ? "Multiple workspaces. Do not assume a default workspace. Pass workspace_id explicitly."
            : "Draft tags, triggers, and variables need this workspace_id. The published container is GET .../versions/live.";
      return json(
        listBody("workspace", sliced.items, sliced.next, hint, {
          account_id: accountId,
          container_id: containerId,
        }),
        200,
      );
    }
    default: {
      const unexpected: never = got;
      return unexpected;
    }
  }
}

async function listWorkspace(ctx: ReadCtx, kind: WorkspaceKind): Promise<Response> {
  const accountId = requireDigits(ctx.params[0], "account_id");
  if (accountId instanceof Response) {
    return accountId;
  }
  const containerId = requireDigits(ctx.params[1], "container_id");
  if (containerId instanceof Response) {
    return containerId;
  }
  const workspaceId = requireDigits(ctx.params[2], "workspace_id");
  if (workspaceId instanceof Response) {
    return workspaceId;
  }
  const page = readPage(ctx.url);
  if (page instanceof Response) {
    return page;
  }
  const got = await gtmRecord(
    ctx,
    `/tagmanager/v2/accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}/${kind}`,
  );
  switch (got.kind) {
    case "response":
      return got.response;
    case "record": {
      const all = arrayField(got.record, GOOGLE_KEY[kind]);
      const sliced = slicePage(all, page.pageSize, page.pageToken);
      if (sliced instanceof Response) {
        return sliced;
      }
      const hint = all.length === 0 ? EMPTY_LIST_HINT : DRAFT_HINT;
      return json(
        listBody(GOOGLE_KEY[kind], withWorkspaceSource(sliced.items), sliced.next, hint, {
          source: "workspace",
          workspace_id: workspaceId,
        }),
        200,
      );
    }
    default: {
      const unexpected: never = got;
      return unexpected;
    }
  }
}

export function listGtmTags(ctx: ReadCtx): Promise<Response> {
  return listWorkspace(ctx, "tags");
}

export function listGtmTriggers(ctx: ReadCtx): Promise<Response> {
  return listWorkspace(ctx, "triggers");
}

export function listGtmVariables(ctx: ReadCtx): Promise<Response> {
  return listWorkspace(ctx, "variables");
}

export function listGtmClients(ctx: ReadCtx): Promise<Response> {
  return listWorkspace(ctx, "clients");
}

export async function getGtmLiveVersion(ctx: ReadCtx): Promise<Response> {
  const accountId = requireDigits(ctx.params[0], "account_id");
  if (accountId instanceof Response) {
    return accountId;
  }
  const containerId = requireDigits(ctx.params[1], "container_id");
  if (containerId instanceof Response) {
    return containerId;
  }
  const got = await gtmRecord(
    ctx,
    `/tagmanager/v2/accounts/${accountId}/containers/${containerId}/versions:live`,
  );
  switch (got.kind) {
    case "response":
      return got.response;
    case "record":
      return json(
        {
          ...got.record,
          source: "live",
          cited: {
            account_id: accountId,
            container_id: containerId,
            path: `accounts/${accountId}/containers/${containerId}`,
          },
          hint: LIVE_HINT,
        },
        200,
      );
    default: {
      const unexpected: never = got;
      return unexpected;
    }
  }
}

export async function listGtmEnvironments(ctx: ReadCtx): Promise<Response> {
  const accountId = requireDigits(ctx.params[0], "account_id");
  if (accountId instanceof Response) {
    return accountId;
  }
  const containerId = requireDigits(ctx.params[1], "container_id");
  if (containerId instanceof Response) {
    return containerId;
  }
  const page = readPage(ctx.url);
  if (page instanceof Response) {
    return page;
  }
  const got = await gtmRecord(
    ctx,
    `/tagmanager/v2/accounts/${accountId}/containers/${containerId}/environments`,
  );
  switch (got.kind) {
    case "response":
      return got.response;
    case "record": {
      const all = arrayField(got.record, "environment");
      const sliced = slicePage(all, page.pageSize, page.pageToken);
      if (sliced instanceof Response) {
        return sliced;
      }
      const hint =
        all.length === 0
          ? EMPTY_LIST_HINT
          : "Environments are container-level, not workspace-level. live, latest, and workspace are system-managed.";
      return json(
        listBody("environment", sliced.items, sliced.next, hint, {
          account_id: accountId,
          container_id: containerId,
        }),
        200,
      );
    }
    default: {
      const unexpected: never = got;
      return unexpected;
    }
  }
}
