import type { ActiveGrant } from "./auth";
import { bytesToBase64Url } from "./bytes";
import { ADMIN_ORIGIN, GTM_ORIGIN, accessForRead, googleObject } from "./google";
import { json } from "./http";
import {
  GA4_MANAGE_SCOPES,
  GTM_MANAGE_SCOPES,
  refusalForGoogleScopes,
} from "./scopes";
import { isRecord } from "./validate";

const PREVIEW_TTL_SECONDS = 600;
const PREVIEW_PREFIX = "preview:";
const PREVIEW_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DIGITS = /^[0-9]{1,20}$/;
const PARAMETER_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const PUBLIC_ID_PATTERN = /^GTM-[A-Z0-9]{1,20}$/;
const VARIABLE_TYPE_PATTERN = /^[A-Za-z0-9_]{1,64}$/;
const DIMENSION_SCOPES = ["EVENT", "USER", "ITEM"] as const;

/**
 * Confirm-gated Free Google mutates. Preview stores the proposal.
 * Confirm posts only after `confirm_phrase` contains every resource id.
 * GA4 matches tip `ga4CreateCustomDimension`.
 */
const WRITE_KINDS = {
  ga4_custom_dimension_create: {
    family: "ga4",
    scopes: GA4_MANAGE_SCOPES,
  },
  gtm_variable_create: {
    family: "gtm",
    scopes: GTM_MANAGE_SCOPES,
  },
} as const;

type WriteKind = keyof typeof WRITE_KINDS;
type DimensionScope = (typeof DIMENSION_SCOPES)[number];

type Dimension = {
  readonly parameter_name: string;
  readonly display_name: string;
  readonly scope: DimensionScope;
  readonly description?: string;
};

type GtmParameter = {
  readonly type: string;
  readonly key?: string;
  readonly value?: string;
};

type GtmVariable = {
  readonly name: string;
  readonly type: string;
  readonly parameter?: readonly GtmParameter[];
};

const CONSTANT_PARAMETER: readonly GtmParameter[] = [
  { type: "template", key: "value", value: "muse" },
];

type Ga4Stored = {
  readonly kind: "ga4_custom_dimension_create";
  readonly grant_id: string;
  readonly property_id: string;
  readonly dimension: Dimension;
  readonly resource_ids: readonly [string];
  readonly summary: string;
  readonly expires_at: string;
};

type GtmStored = {
  readonly kind: "gtm_variable_create";
  readonly grant_id: string;
  readonly account_id: string;
  readonly container_id: string;
  readonly workspace_id: string;
  readonly public_id: string;
  readonly variable: GtmVariable;
  readonly resource_ids: readonly [string];
  readonly summary: string;
  readonly expires_at: string;
};

type StoredPreview = Ga4Stored | GtmStored;

type PreviewParse =
  | { readonly kind: "ok"; readonly stored: StoredPreview }
  | { readonly kind: "unknown_kind" }
  | { readonly kind: "invalid" }
  | { readonly kind: "response"; readonly response: Response };

export const WRITE_KIND_NAMES = Object.keys(WRITE_KINDS) as WriteKind[];

function isWriteKind(value: unknown): value is WriteKind {
  return typeof value === "string" && (WRITE_KIND_NAMES as readonly string[]).includes(value);
}

function isDimensionScope(value: unknown): value is DimensionScope {
  return typeof value === "string" && (DIMENSION_SCOPES as readonly string[]).includes(value);
}

function previewKey(previewId: string): string {
  return `${PREVIEW_PREFIX}${previewId}`;
}

function newPreviewId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

function digits(value: unknown): string | null {
  return typeof value === "string" && DIGITS.test(value) ? value : null;
}

function plainText(value: unknown, max: number): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    return null;
  }
  if (/[\u0000-\u001F]/.test(value)) {
    return null;
  }
  return value;
}

function ga4ResourceId(propertyId: string): string {
  return `properties/${propertyId}`;
}

function summaryForDimension(parameterName: string, propertyId: string): string {
  return `Would create custom dimension ${parameterName} on GA4 property ${propertyId}. Not executed.`;
}

function summaryForVariable(variable: GtmVariable, publicId: string, workspaceId: string): string {
  return `Would create GTM variable ${variable.name} (${variable.type}) in workspace ${workspaceId} on container ${publicId}. Not executed.`;
}

async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

function parseDimension(value: unknown): Dimension | null {
  if (!isRecord(value)) {
    return null;
  }
  const parameterName = value["parameter_name"];
  const displayName = plainText(value["display_name"], 82);
  const scope = value["scope"];
  if (typeof parameterName !== "string" || !PARAMETER_NAME_PATTERN.test(parameterName)) {
    return null;
  }
  if (displayName === null || !isDimensionScope(scope)) {
    return null;
  }
  const descriptionRaw = value["description"];
  if (descriptionRaw === undefined || descriptionRaw === "") {
    return { parameter_name: parameterName, display_name: displayName, scope };
  }
  const description = plainText(descriptionRaw, 150);
  if (description === null) {
    return null;
  }
  return {
    parameter_name: parameterName,
    display_name: displayName,
    scope,
    description,
  };
}

function parseParameter(value: unknown): GtmParameter | null {
  if (!isRecord(value)) {
    return null;
  }
  for (const key of Object.keys(value)) {
    if (key !== "type" && key !== "key" && key !== "value") {
      return null;
    }
  }
  const type = plainText(value["type"], 64);
  if (type === null) {
    return null;
  }
  const item: { type: string; key?: string; value?: string } = { type };
  if (value["key"] !== undefined) {
    const key = plainText(value["key"], 200);
    if (key === null) {
      return null;
    }
    item.key = key;
  }
  if (value["value"] !== undefined) {
    const paramValue = plainText(value["value"], 1024);
    if (paramValue === null) {
      return null;
    }
    item.value = paramValue;
  }
  return item;
}

function parseParameterList(value: unknown): readonly GtmParameter[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    return null;
  }
  const items: GtmParameter[] = [];
  for (const item of value) {
    const parsed = parseParameter(item);
    if (parsed === null) {
      return null;
    }
    items.push(parsed);
  }
  return items;
}

function parseVariable(value: unknown): GtmVariable | null {
  if (!isRecord(value)) {
    return null;
  }
  const name = plainText(value["name"], 200);
  const type = value["type"];
  if (name === null || typeof type !== "string" || !VARIABLE_TYPE_PATTERN.test(type)) {
    return null;
  }
  if (value["parameter"] === undefined) {
    return { name, type };
  }
  const parameter = parseParameterList(value["parameter"]);
  if (parameter === null) {
    return null;
  }
  return { name, type, parameter };
}

function expiresAt(): string {
  return new Date(Date.now() + PREVIEW_TTL_SECONDS * 1000).toISOString();
}

async function resolvePublicId(
  grant: ActiveGrant,
  env: Env,
  accountId: string,
  containerId: string,
): Promise<string | Response> {
  const access = await accessForRead(grant, env, GTM_MANAGE_SCOPES, "gtm");
  switch (access.kind) {
    case "response":
      return access.response;
    case "token":
      break;
    default: {
      const unexpected: never = access;
      return unexpected;
    }
  }
  const got = await googleObject(
    "gtm",
    access.token,
    `${GTM_ORIGIN}/tagmanager/v2/accounts/${accountId}/containers/${containerId}`,
    { method: "GET" },
  );
  switch (got.kind) {
    case "response":
      return got.response;
    case "record": {
      const publicId = got.record["publicId"];
      if (typeof publicId !== "string" || !PUBLIC_ID_PATTERN.test(publicId)) {
        return json({ error: "gtm_unavailable" }, 502);
      }
      return publicId;
    }
    default: {
      const unexpected: never = got;
      return unexpected;
    }
  }
}

async function parsePreviewBody(
  value: unknown,
  grant: ActiveGrant,
  env: Env,
): Promise<PreviewParse> {
  if (!isRecord(value)) {
    return { kind: "invalid" };
  }
  const kind = value["kind"];
  if (!isWriteKind(kind)) {
    if (typeof kind === "string" && kind.length > 0) {
      return { kind: "unknown_kind" };
    }
    return { kind: "invalid" };
  }
  const refused = refusalForGoogleScopes(grant.google, WRITE_KINDS[kind].scopes);
  if (refused !== null) {
    return { kind: "response", response: refused };
  }
  switch (kind) {
    case "ga4_custom_dimension_create": {
      const propertyId = digits(value["property_id"]);
      const dimension = parseDimension(value["dimension"]);
      if (propertyId === null || dimension === null) {
        return { kind: "invalid" };
      }
      const resourceId = ga4ResourceId(propertyId);
      return {
        kind: "ok",
        stored: {
          kind,
          grant_id: grant.grant_id,
          property_id: propertyId,
          dimension,
          resource_ids: [resourceId],
          summary: summaryForDimension(dimension.parameter_name, propertyId),
          expires_at: expiresAt(),
        },
      };
    }
    case "gtm_variable_create": {
      const accountId = digits(value["account_id"]);
      const containerId = digits(value["container_id"]);
      const workspaceId = digits(value["workspace_id"]);
      const variable = parseVariable(value["variable"]);
      if (accountId === null || containerId === null || workspaceId === null || variable === null) {
        return { kind: "invalid" };
      }
      const publicId = await resolvePublicId(grant, env, accountId, containerId);
      if (publicId instanceof Response) {
        return { kind: "response", response: publicId };
      }
      return {
        kind: "ok",
        stored: {
          kind,
          grant_id: grant.grant_id,
          account_id: accountId,
          container_id: containerId,
          workspace_id: workspaceId,
          public_id: publicId,
          variable,
          resource_ids: [publicId],
          summary: summaryForVariable(variable, publicId, workspaceId),
          expires_at: expiresAt(),
        },
      };
    }
    default: {
      const unexpected: never = kind;
      return unexpected;
    }
  }
}

function readCommon(
  value: Record<string, unknown>,
  resourceId: string,
): { readonly grantId: string; readonly summary: string; readonly expiresAt: string } | null {
  const grantId = value["grant_id"];
  const summary = value["summary"];
  const expiresAt = value["expires_at"];
  const resourceIds = value["resource_ids"];
  if (
    typeof grantId !== "string" ||
    grantId.length === 0 ||
    typeof summary !== "string" ||
    summary.length === 0 ||
    typeof expiresAt !== "string" ||
    !Number.isFinite(Date.parse(expiresAt)) ||
    !Array.isArray(resourceIds) ||
    resourceIds.length !== 1 ||
    resourceIds[0] !== resourceId
  ) {
    return null;
  }
  if (Date.parse(expiresAt) <= Date.now()) {
    return null;
  }
  return { grantId, summary, expiresAt };
}

function parseStoredPreview(raw: string): StoredPreview | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value) || !isWriteKind(value["kind"])) {
    return null;
  }
  switch (value["kind"]) {
    case "ga4_custom_dimension_create": {
      const propertyId = digits(value["property_id"]);
      const dimension = parseDimension(value["dimension"]);
      if (propertyId === null || dimension === null) {
        return null;
      }
      const common = readCommon(value, ga4ResourceId(propertyId));
      if (common === null) {
        return null;
      }
      return {
        kind: "ga4_custom_dimension_create",
        grant_id: common.grantId,
        property_id: propertyId,
        dimension,
        resource_ids: [ga4ResourceId(propertyId)],
        summary: common.summary,
        expires_at: common.expiresAt,
      };
    }
    case "gtm_variable_create": {
      const accountId = digits(value["account_id"]);
      const containerId = digits(value["container_id"]);
      const workspaceId = digits(value["workspace_id"]);
      const publicId = value["public_id"];
      const variable = parseVariable(value["variable"]);
      if (
        accountId === null ||
        containerId === null ||
        workspaceId === null ||
        typeof publicId !== "string" ||
        !PUBLIC_ID_PATTERN.test(publicId) ||
        variable === null
      ) {
        return null;
      }
      const common = readCommon(value, publicId);
      if (common === null) {
        return null;
      }
      return {
        kind: "gtm_variable_create",
        grant_id: common.grantId,
        account_id: accountId,
        container_id: containerId,
        workspace_id: workspaceId,
        public_id: publicId,
        variable,
        resource_ids: [publicId],
        summary: common.summary,
        expires_at: common.expiresAt,
      };
    }
    default: {
      const unexpected: never = value["kind"];
      return unexpected;
    }
  }
}

function phraseCovers(phrase: string, resourceIds: readonly string[]): boolean {
  return resourceIds.every((resourceId) => phrase.includes(resourceId));
}

function gtmVariableBody(variable: GtmVariable): Record<string, unknown> {
  const parameter = variable.parameter ?? (variable.type === "c" ? CONSTANT_PARAMETER : undefined);
  return {
    name: variable.name,
    type: variable.type,
    ...(parameter === undefined ? {} : { parameter }),
  };
}

function mutateCall(stored: StoredPreview): { readonly url: string; readonly body: Record<string, unknown> } {
  switch (stored.kind) {
    case "ga4_custom_dimension_create":
      return {
        url: `${ADMIN_ORIGIN}/v1beta/properties/${stored.property_id}/customDimensions`,
        body: {
          parameterName: stored.dimension.parameter_name,
          displayName: stored.dimension.display_name,
          scope: stored.dimension.scope,
          ...(stored.dimension.description === undefined
            ? {}
            : { description: stored.dimension.description }),
        },
      };
    case "gtm_variable_create":
      return {
        url: `${GTM_ORIGIN}/tagmanager/v2/accounts/${stored.account_id}/containers/${stored.container_id}/workspaces/${stored.workspace_id}/variables`,
        body: gtmVariableBody(stored.variable),
      };
    default: {
      const unexpected: never = stored;
      return unexpected;
    }
  }
}

function resourceNameOf(stored: StoredPreview, record: Record<string, unknown>): string | null {
  switch (stored.kind) {
    case "ga4_custom_dimension_create": {
      const name = record["name"];
      const prefix = `properties/${stored.property_id}/customDimensions/`;
      return typeof name === "string" && name.startsWith(prefix) ? name : null;
    }
    case "gtm_variable_create": {
      const path = record["path"];
      const prefix = `accounts/${stored.account_id}/containers/${stored.container_id}/workspaces/${stored.workspace_id}/variables/`;
      return typeof path === "string" && path.startsWith(prefix) && path.length > prefix.length
        ? path
        : null;
    }
    default: {
      const unexpected: never = stored;
      return unexpected;
    }
  }
}

function previewResponse(previewId: string, stored: StoredPreview): Response {
  return json(
    {
      status: "preview",
      preview_id: previewId,
      confirm_required: true,
      kind: stored.kind,
      resource_ids: stored.resource_ids,
      summary: stored.summary,
      expires_at: stored.expires_at,
    },
    200,
  );
}

export async function previewWrite(
  request: Request,
  grant: ActiveGrant,
  env: Env,
): Promise<Response> {
  if (grant.google === null) {
    return json({ error: "google_not_linked" }, 403);
  }

  const parsed = await parsePreviewBody(await readBody(request), grant, env);
  switch (parsed.kind) {
    case "unknown_kind":
      return json({ error: "unknown_kind" }, 400);
    case "invalid":
      return json({ error: "invalid_request" }, 400);
    case "response":
      return parsed.response;
    case "ok":
      break;
    default: {
      const unexpected: never = parsed;
      return unexpected;
    }
  }

  const previewId = newPreviewId();
  await env.MUSE_TOKENS.put(previewKey(previewId), JSON.stringify(parsed.stored), {
    expirationTtl: PREVIEW_TTL_SECONDS,
  });
  return previewResponse(previewId, parsed.stored);
}

type ConfirmBody =
  | { readonly kind: "invalid" }
  | { readonly kind: "missing_preview" }
  | { readonly kind: "ready"; readonly previewId: string; readonly phrase: unknown };

function parseConfirmBody(value: unknown): ConfirmBody {
  if (!isRecord(value)) {
    return { kind: "invalid" };
  }
  const previewId = value["preview_id"];
  if (typeof previewId !== "string" || !PREVIEW_ID_PATTERN.test(previewId)) {
    return { kind: "missing_preview" };
  }
  return { kind: "ready", previewId, phrase: value["confirm_phrase"] };
}

export async function confirmWrite(
  request: Request,
  grant: ActiveGrant,
  env: Env,
): Promise<Response> {
  const parsed = parseConfirmBody(await readBody(request));
  switch (parsed.kind) {
    case "invalid":
      return json({ error: "invalid_request" }, 400);
    case "missing_preview":
      return json({ error: "preview_invalid" }, 400);
    case "ready":
      break;
    default: {
      const unexpected: never = parsed;
      return unexpected;
    }
  }

  const key = previewKey(parsed.previewId);
  const raw = await env.MUSE_TOKENS.get(key, "text");
  if (raw === null) {
    return json({ error: "preview_invalid" }, 400);
  }
  const stored = parseStoredPreview(raw);
  if (stored === null) {
    return json({ error: "preview_invalid" }, 400);
  }
  if (stored.grant_id !== grant.grant_id) {
    return json({ error: "preview_forbidden" }, 403);
  }
  const meta = WRITE_KINDS[stored.kind];
  const refused = refusalForGoogleScopes(grant.google, meta.scopes);
  if (refused !== null) {
    return refused;
  }
  if (typeof parsed.phrase !== "string" || !phraseCovers(parsed.phrase, stored.resource_ids)) {
    return json({ error: "confirm_refused", confirm_required: true }, 400);
  }

  const access = await accessForRead(grant, env, meta.scopes, meta.family);
  switch (access.kind) {
    case "response":
      return access.response;
    case "token":
      break;
    default: {
      const unexpected: never = access;
      return unexpected;
    }
  }

  const call = mutateCall(stored);
  const got = await googleObject(meta.family, access.token, call.url, {
    method: "POST",
    body: call.body,
  });
  switch (got.kind) {
    case "response":
      return got.response;
    case "record": {
      const resourceName = resourceNameOf(stored, got.record);
      if (resourceName === null) {
        return json({ error: `${meta.family}_unavailable` }, 502);
      }
      await env.MUSE_TOKENS.delete(key);
      return json(
        {
          status: "confirmed",
          preview_id: parsed.previewId,
          kind: stored.kind,
          executed: true,
          resource_name: resourceName,
        },
        200,
      );
    }
    default: {
      const unexpected: never = got;
      return unexpected;
    }
  }
}
