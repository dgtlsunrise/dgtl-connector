import type { ActiveGrant } from "./auth";
import { bytesToBase64Url } from "./bytes";
import { json } from "./http";
import { GA4_MANAGE_SCOPES, refusalForGoogleScopes } from "./scopes";

const PREVIEW_TTL_SECONDS = 600;
const PREVIEW_PREFIX = "preview:";
const WRITE_KIND = "ga4_custom_dimension_create";
const PREVIEW_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const PROPERTY_ID_PATTERN = /^[0-9]{1,20}$/;
const PARAMETER_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const DIMENSION_SCOPES = ["EVENT", "USER", "ITEM"] as const;

type DimensionScope = (typeof DIMENSION_SCOPES)[number];

type Dimension = {
  readonly parameter_name: string;
  readonly display_name: string;
  readonly scope: DimensionScope;
};

type StoredPreview = {
  readonly grant_id: string;
  readonly kind: typeof WRITE_KIND;
  readonly property_id: string;
  readonly dimension: Dimension;
  readonly resource_ids: readonly [string];
  readonly summary: string;
  readonly expires_at: string;
};

type PreviewParse =
  | { readonly kind: "ok"; readonly dimension: Dimension; readonly propertyId: string }
  | { readonly kind: "unknown_kind" }
  | { readonly kind: "invalid" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDimensionScope(value: unknown): value is DimensionScope {
  return typeof value === "string" && (DIMENSION_SCOPES as readonly string[]).includes(value);
}

function previewKey(previewId: string): string {
  return `${PREVIEW_PREFIX}${previewId}`;
}

function summaryFor(parameterName: string, propertyId: string): string {
  return `Would create custom dimension ${parameterName} on GA4 property ${propertyId}. Not executed.`;
}

function newPreviewId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
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
  const displayName = value["display_name"];
  const scope = value["scope"];
  if (typeof parameterName !== "string" || !PARAMETER_NAME_PATTERN.test(parameterName)) {
    return null;
  }
  if (typeof displayName !== "string" || displayName.length === 0 || displayName.length > 82) {
    return null;
  }
  if (/[\u0000-\u001F]/.test(displayName)) {
    return null;
  }
  if (!isDimensionScope(scope)) {
    return null;
  }
  return {
    parameter_name: parameterName,
    display_name: displayName,
    scope,
  };
}

function parsePreviewBody(value: unknown): PreviewParse {
  if (!isRecord(value)) {
    return { kind: "invalid" };
  }
  const kind = value["kind"];
  if (kind !== WRITE_KIND) {
    if (typeof kind === "string" && kind.length > 0) {
      return { kind: "unknown_kind" };
    }
    return { kind: "invalid" };
  }
  const propertyId = value["property_id"];
  if (typeof propertyId !== "string" || !PROPERTY_ID_PATTERN.test(propertyId)) {
    return { kind: "invalid" };
  }
  const dimension = parseDimension(value["dimension"]);
  if (dimension === null) {
    return { kind: "invalid" };
  }
  return { kind: "ok", dimension, propertyId };
}

function parseStoredPreview(raw: string): StoredPreview | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) {
    return null;
  }
  const grantId = value["grant_id"];
  const propertyId = value["property_id"];
  const summary = value["summary"];
  const expiresAt = value["expires_at"];
  const resourceIds = value["resource_ids"];
  const dimension = parseDimension(value["dimension"]);
  if (
    value["kind"] !== WRITE_KIND ||
    typeof grantId !== "string" ||
    grantId.length === 0 ||
    typeof propertyId !== "string" ||
    !PROPERTY_ID_PATTERN.test(propertyId) ||
    dimension === null ||
    typeof summary !== "string" ||
    summary.length === 0 ||
    typeof expiresAt !== "string" ||
    !Number.isFinite(Date.parse(expiresAt)) ||
    !Array.isArray(resourceIds) ||
    resourceIds.length !== 1 ||
    resourceIds[0] !== propertyId
  ) {
    return null;
  }
  if (Date.parse(expiresAt) <= Date.now()) {
    return null;
  }
  return {
    grant_id: grantId,
    kind: WRITE_KIND,
    property_id: propertyId,
    dimension,
    resource_ids: [propertyId],
    summary,
    expires_at: expiresAt,
  };
}

function phraseCovers(phrase: string, resourceIds: readonly string[]): boolean {
  return resourceIds.every((resourceId) => phrase.includes(resourceId));
}

export async function previewWrite(
  request: Request,
  grant: ActiveGrant,
  env: Env,
): Promise<Response> {
  if (grant.google === null) {
    return json({ error: "google_not_linked" }, 403);
  }

  const parsed = parsePreviewBody(await readBody(request));
  switch (parsed.kind) {
    case "unknown_kind":
      return json({ error: "unknown_kind" }, 400);
    case "invalid":
      return json({ error: "invalid_request" }, 400);
    case "ok":
      break;
    default: {
      const unexpected: never = parsed;
      return unexpected;
    }
  }

  const refused = refusalForGoogleScopes(grant.google, GA4_MANAGE_SCOPES);
  if (refused !== null) {
    return refused;
  }

  const previewId = newPreviewId();
  const expiresAt = new Date(Date.now() + PREVIEW_TTL_SECONDS * 1000).toISOString();
  const summary = summaryFor(parsed.dimension.parameter_name, parsed.propertyId);
  const stored: StoredPreview = {
    grant_id: grant.grant_id,
    kind: WRITE_KIND,
    property_id: parsed.propertyId,
    dimension: parsed.dimension,
    resource_ids: [parsed.propertyId],
    summary,
    expires_at: expiresAt,
  };
  await env.MUSE_TOKENS.put(previewKey(previewId), JSON.stringify(stored), {
    expirationTtl: PREVIEW_TTL_SECONDS,
  });

  return json(
    {
      status: "preview",
      preview_id: previewId,
      confirm_required: true,
      kind: WRITE_KIND,
      resource_ids: stored.resource_ids,
      summary,
      expires_at: expiresAt,
    },
    200,
  );
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
  const refused = refusalForGoogleScopes(grant.google, GA4_MANAGE_SCOPES);
  if (refused !== null) {
    return refused;
  }
  if (typeof parsed.phrase !== "string" || !phraseCovers(parsed.phrase, stored.resource_ids)) {
    return json({ error: "confirm_refused", confirm_required: true }, 400);
  }

  await env.MUSE_TOKENS.delete(key);
  return json(
    {
      status: "confirmed",
      preview_id: parsed.previewId,
      executed: false,
      reason: "stub_no_mutate",
      message: "Confirm accepted. Live Google mutate is not enabled on this stub.",
    },
    200,
  );
}
