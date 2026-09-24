import { parseShopDomain, type ActiveGrant } from "./auth";
import { bytesToBase64Url } from "./bytes";
import { ADMIN_ORIGIN, GTM_ORIGIN, accessForRead, googleObject } from "./google";
import { json } from "./http";
import { KLAVIYO_API_REVISION, KLAVIYO_ORIGIN } from "./klaviyo-reads";
import {
  GA4_MANAGE_SCOPES,
  GTM_MANAGE_SCOPES,
  refusalForGoogleScopes,
} from "./scopes";
import { openRefreshToken } from "./seal";
import { isRecord } from "./validate";

const PREVIEW_TTL_SECONDS = 600;
const PREVIEW_PREFIX = "preview:";
const PREVIEW_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DIGITS = /^[0-9]{1,20}$/;
const PARAMETER_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const PUBLIC_ID_PATTERN = /^GTM-[A-Z0-9]{1,20}$/;
const VARIABLE_TYPE_PATTERN = /^[A-Za-z0-9_]{1,64}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const KLAVIYO_EMAIL_MAX = 254;
const KLAVIYO_TEXT_MAX = 255;
const KLAVIYO_PREVIEW_KEYS = new Set([
  "kind",
  "email",
  "external_id",
  "profile_id",
  "first_name",
  "last_name",
]);
const DIMENSION_SCOPES = ["EVENT", "USER", "ITEM"] as const;

/**
 * Confirm-gated mutates. Preview stores the proposal.
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
  shopify_inventory_adjust: {
    family: "shopify",
  },
  klaviyo_upsert_profile: {
    family: "klaviyo",
  },
} as const;

const SHOPIFY_ADMIN_API_VERSION = "2026-04";
const ADJUST_REASONS = ["correction", "restock", "shrinkage", "received", "damaged", "other"] as const;
const QUANTITY_NAMES = ["available", "on_hand"] as const;
const INVENTORY_ADJUST_DOCUMENT = `mutation InventoryAdjust($input: InventoryAdjustQuantitiesInput!) {
  inventoryAdjustQuantities(input: $input) {
    userErrors { field message code }
    inventoryAdjustmentGroup {
      createdAt
      reason
      changes {
        name
        delta
        quantityAfterChange
        item { id sku }
        location { id name }
      }
    }
  }
}`;

type WriteKind = keyof typeof WRITE_KINDS;
type DimensionScope = (typeof DIMENSION_SCOPES)[number];
type AdjustReason = (typeof ADJUST_REASONS)[number];
type QuantityName = (typeof QUANTITY_NAMES)[number];

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

type GoogleStored = Ga4Stored | GtmStored;

type ShopifyInventoryStored = {
  readonly kind: "shopify_inventory_adjust";
  readonly grant_id: string;
  readonly shop: string;
  readonly inventory_item_id: string;
  readonly location_id: string;
  readonly delta: number;
  readonly reason: AdjustReason;
  readonly quantity_name: QuantityName;
  readonly resource_ids: readonly [string, string];
  readonly summary: string;
  readonly expires_at: string;
};

type KlaviyoProfileFields = {
  readonly email?: string;
  readonly external_id?: string;
  readonly profile_id?: string;
  readonly first_name?: string;
  readonly last_name?: string;
};

type KlaviyoProfileStored = KlaviyoProfileFields & {
  readonly kind: "klaviyo_upsert_profile";
  readonly grant_id: string;
  readonly resource_ids: readonly string[];
  readonly summary: string;
  readonly expires_at: string;
};

type StoredPreview = GoogleStored | ShopifyInventoryStored | KlaviyoProfileStored;

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
  switch (kind) {
    case "shopify_inventory_adjust":
      return parseShopifyPreview(value, grant);
    case "klaviyo_upsert_profile":
      return parseKlaviyoPreview(value, grant);
    case "ga4_custom_dimension_create": {
      const refused = refusalForGoogleScopes(grant.google, WRITE_KINDS[kind].scopes);
      if (refused !== null) {
        return { kind: "response", response: refused };
      }
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
      const refused = refusalForGoogleScopes(grant.google, WRITE_KINDS[kind].scopes);
      if (refused !== null) {
        return { kind: "response", response: refused };
      }
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
  resourceIds: readonly string[],
): { readonly grantId: string; readonly summary: string; readonly expiresAt: string } | null {
  const grantId = value["grant_id"];
  const summary = value["summary"];
  const expiresAtValue = value["expires_at"];
  const storedIds = value["resource_ids"];
  if (
    typeof grantId !== "string" ||
    grantId.length === 0 ||
    typeof summary !== "string" ||
    summary.length === 0 ||
    typeof expiresAtValue !== "string" ||
    !Number.isFinite(Date.parse(expiresAtValue)) ||
    !Array.isArray(storedIds) ||
    storedIds.length !== resourceIds.length ||
    resourceIds.some((resourceId, index) => storedIds[index] !== resourceId)
  ) {
    return null;
  }
  if (Date.parse(expiresAtValue) <= Date.now()) {
    return null;
  }
  return { grantId, summary, expiresAt: expiresAtValue };
}

function isAdjustReason(value: string): value is AdjustReason {
  return (ADJUST_REASONS as readonly string[]).includes(value);
}

function isQuantityName(value: string): value is QuantityName {
  return (QUANTITY_NAMES as readonly string[]).includes(value);
}

function shopifyGid(value: unknown, resource: "InventoryItem" | "Location"): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  const numeric = /^[0-9]{1,20}$/;
  if (numeric.test(trimmed)) {
    return `gid://shopify/${resource}/${trimmed}`;
  }
  const prefix = `gid://shopify/${resource}/`;
  if (!trimmed.startsWith(prefix) || !numeric.test(trimmed.slice(prefix.length))) {
    return null;
  }
  return trimmed;
}

function parseDelta(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value === 0 || Math.abs(value) > 1_000_000) {
    return null;
  }
  return value;
}

function parseAdjustReason(value: unknown): AdjustReason | null {
  if (value === undefined) {
    return "correction";
  }
  if (typeof value !== "string") {
    return null;
  }
  const reason = value.trim().toLowerCase();
  return isAdjustReason(reason) ? reason : null;
}

function parseQuantityName(value: unknown): QuantityName | null {
  if (value === undefined) {
    return "available";
  }
  if (typeof value !== "string") {
    return null;
  }
  const name = value.trim().toLowerCase();
  return isQuantityName(name) ? name : null;
}

function readAdjustReason(value: unknown): AdjustReason | null {
  return typeof value === "string" && isAdjustReason(value) ? value : null;
}

function readQuantityName(value: unknown): QuantityName | null {
  return typeof value === "string" && isQuantityName(value) ? value : null;
}

function requiresGoogleLink(kind: unknown): boolean {
  if (!isWriteKind(kind)) {
    return true;
  }
  const family = WRITE_KINDS[kind].family;
  switch (family) {
    case "ga4":
    case "gtm":
      return true;
    case "shopify":
    case "klaviyo":
      return false;
    default: {
      const unexpected: never = family;
      return unexpected;
    }
  }
}

function optionalClosedText(value: unknown, max: number): string | undefined | null {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (trimmed.length > max || /[\u0000-\u001F]/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function optionalEmail(value: unknown): string | undefined | null {
  const email = optionalClosedText(value, KLAVIYO_EMAIL_MAX);
  if (email === undefined || email === null) {
    return email;
  }
  return EMAIL_PATTERN.test(email) ? email : null;
}

function profileResourceIds(fields: KlaviyoProfileFields): readonly string[] {
  return [
    ...(fields.email === undefined ? [] : [fields.email]),
    ...(fields.external_id === undefined ? [] : [fields.external_id]),
    ...(fields.profile_id === undefined ? [] : [fields.profile_id]),
  ];
}

function klaviyoPreviewKeysOnly(value: Record<string, unknown>): boolean {
  return Object.keys(value).every((key) => KLAVIYO_PREVIEW_KEYS.has(key));
}

function parseKlaviyoFields(value: Record<string, unknown>): KlaviyoProfileFields | null {
  const email = optionalEmail(value["email"]);
  const externalId = optionalClosedText(value["external_id"], KLAVIYO_TEXT_MAX);
  const profileId = optionalClosedText(value["profile_id"], KLAVIYO_TEXT_MAX);
  const firstName = optionalClosedText(value["first_name"], KLAVIYO_TEXT_MAX);
  const lastName = optionalClosedText(value["last_name"], KLAVIYO_TEXT_MAX);
  if (
    email === null ||
    externalId === null ||
    profileId === null ||
    firstName === null ||
    lastName === null
  ) {
    return null;
  }
  const fields: {
    email?: string;
    external_id?: string;
    profile_id?: string;
    first_name?: string;
    last_name?: string;
  } = {};
  if (email !== undefined) {
    fields.email = email;
  }
  if (externalId !== undefined) {
    fields.external_id = externalId;
  }
  if (profileId !== undefined) {
    fields.profile_id = profileId;
  }
  if (firstName !== undefined) {
    fields.first_name = firstName;
  }
  if (lastName !== undefined) {
    fields.last_name = lastName;
  }
  if (profileResourceIds(fields).length === 0) {
    return null;
  }
  return fields;
}

function parseKlaviyoPreview(value: Record<string, unknown>, grant: ActiveGrant): PreviewParse {
  if (grant.klaviyo === null) {
    return { kind: "response", response: json({ error: "klaviyo_not_linked" }, 403) };
  }
  if (!klaviyoPreviewKeysOnly(value)) {
    return { kind: "invalid" };
  }
  const fields = parseKlaviyoFields(value);
  if (fields === null) {
    return { kind: "invalid" };
  }
  const resourceIds = profileResourceIds(fields);
  return {
    kind: "ok",
    stored: {
      kind: "klaviyo_upsert_profile",
      grant_id: grant.grant_id,
      ...fields,
      resource_ids: resourceIds,
      summary: `Would upsert Klaviyo profile ${resourceIds.join(", ")}. Not executed.`,
      expires_at: expiresAt(),
    },
  };
}

function readStoredClosedText(
  value: Record<string, unknown>,
  key: string,
  max: number,
): string | undefined | null {
  if (!Object.prototype.hasOwnProperty.call(value, key)) {
    return undefined;
  }
  const raw = value[key];
  if (typeof raw !== "string" || raw.length === 0 || raw.length > max || /[\u0000-\u001F]/.test(raw)) {
    return null;
  }
  return raw;
}

function readStoredProfile(value: Record<string, unknown>): KlaviyoProfileFields | null {
  const email = readStoredClosedText(value, "email", KLAVIYO_EMAIL_MAX);
  const externalId = readStoredClosedText(value, "external_id", KLAVIYO_TEXT_MAX);
  const profileId = readStoredClosedText(value, "profile_id", KLAVIYO_TEXT_MAX);
  const firstName = readStoredClosedText(value, "first_name", KLAVIYO_TEXT_MAX);
  const lastName = readStoredClosedText(value, "last_name", KLAVIYO_TEXT_MAX);
  if (
    email === null ||
    externalId === null ||
    profileId === null ||
    firstName === null ||
    lastName === null ||
    (email !== undefined && !EMAIL_PATTERN.test(email))
  ) {
    return null;
  }
  const fields: {
    email?: string;
    external_id?: string;
    profile_id?: string;
    first_name?: string;
    last_name?: string;
  } = {};
  if (email !== undefined) {
    fields.email = email;
  }
  if (externalId !== undefined) {
    fields.external_id = externalId;
  }
  if (profileId !== undefined) {
    fields.profile_id = profileId;
  }
  if (firstName !== undefined) {
    fields.first_name = firstName;
  }
  if (lastName !== undefined) {
    fields.last_name = lastName;
  }
  if (profileResourceIds(fields).length === 0) {
    return null;
  }
  return fields;
}

function parseShopifyPreview(value: Record<string, unknown>, grant: ActiveGrant): PreviewParse {
  if (grant.shopify === null) {
    return { kind: "response", response: json({ error: "shopify_not_linked" }, 403) };
  }
  const inventoryItemId = shopifyGid(value["inventory_item_id"], "InventoryItem");
  const locationId = shopifyGid(value["location_id"], "Location");
  const delta = parseDelta(value["delta"]);
  const reason = parseAdjustReason(value["reason"]);
  const quantityName = parseQuantityName(value["quantity_name"]);
  if (
    inventoryItemId === null ||
    locationId === null ||
    delta === null ||
    reason === null ||
    quantityName === null
  ) {
    return { kind: "invalid" };
  }
  const shop = grant.shopify.shop;
  return {
    kind: "ok",
    stored: {
      kind: "shopify_inventory_adjust",
      grant_id: grant.grant_id,
      shop,
      inventory_item_id: inventoryItemId,
      location_id: locationId,
      delta,
      reason,
      quantity_name: quantityName,
      resource_ids: [inventoryItemId, locationId],
      summary: `Would adjust inventory item ${inventoryItemId} at ${locationId} by ${delta} on ${shop}. Not executed.`,
      expires_at: expiresAt(),
    },
  };
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
      const common = readCommon(value, [ga4ResourceId(propertyId)]);
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
      const common = readCommon(value, [publicId]);
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
    case "shopify_inventory_adjust": {
      const shop = typeof value["shop"] === "string" ? parseShopDomain(value["shop"]) : null;
      const inventoryItemId = shopifyGid(value["inventory_item_id"], "InventoryItem");
      const locationId = shopifyGid(value["location_id"], "Location");
      const delta = parseDelta(value["delta"]);
      const reason = readAdjustReason(value["reason"]);
      const quantityName = readQuantityName(value["quantity_name"]);
      if (
        shop === null ||
        inventoryItemId === null ||
        locationId === null ||
        delta === null ||
        reason === null ||
        quantityName === null
      ) {
        return null;
      }
      const common = readCommon(value, [inventoryItemId, locationId]);
      if (common === null) {
        return null;
      }
      return {
        kind: "shopify_inventory_adjust",
        grant_id: common.grantId,
        shop,
        inventory_item_id: inventoryItemId,
        location_id: locationId,
        delta,
        reason,
        quantity_name: quantityName,
        resource_ids: [inventoryItemId, locationId],
        summary: common.summary,
        expires_at: common.expiresAt,
      };
    }
    case "klaviyo_upsert_profile": {
      const fields = readStoredProfile(value);
      if (fields === null) {
        return null;
      }
      const resourceIds = profileResourceIds(fields);
      const common = readCommon(value, resourceIds);
      if (common === null) {
        return null;
      }
      return {
        kind: "klaviyo_upsert_profile",
        grant_id: common.grantId,
        ...fields,
        resource_ids: resourceIds,
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

function mutateCall(stored: GoogleStored): { readonly url: string; readonly body: Record<string, unknown> } {
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

function resourceNameOf(stored: GoogleStored, record: Record<string, unknown>): string | null {
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
  const body = await readBody(request);
  if ((!isRecord(body) || requiresGoogleLink(body["kind"])) && grant.google === null) {
    return json({ error: "google_not_linked" }, 403);
  }

  const parsed = await parsePreviewBody(body, grant, env);
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

function graphqlErrorText(body: unknown): string {
  if (!isRecord(body) || !Array.isArray(body["errors"])) {
    return "";
  }
  return body["errors"]
    .filter(isRecord)
    .map((error) => {
      const extensions = error["extensions"];
      const code = isRecord(extensions) && typeof extensions["code"] === "string" ? extensions["code"] : "";
      const message = typeof error["message"] === "string" ? error["message"] : "";
      return `${code} ${message}`;
    })
    .join(" ");
}

function inventoryPayload(body: unknown): Record<string, unknown> | null {
  if (!isRecord(body)) {
    return null;
  }
  const data = body["data"];
  if (!isRecord(data)) {
    return null;
  }
  const payload = data["inventoryAdjustQuantities"];
  return isRecord(payload) ? payload : null;
}

function adjustmentIds(body: unknown): { readonly inventoryItemId: string; readonly locationId: string } | null {
  const payload = inventoryPayload(body);
  if (payload === null || !isRecord(payload["inventoryAdjustmentGroup"])) {
    return null;
  }
  const changes = payload["inventoryAdjustmentGroup"]["changes"];
  const change = Array.isArray(changes) ? changes[0] : undefined;
  if (!isRecord(change) || !isRecord(change["item"]) || !isRecord(change["location"])) {
    return null;
  }
  const inventoryItemId = change["item"]["id"];
  const locationId = change["location"]["id"];
  if (typeof inventoryItemId !== "string" || inventoryItemId.length === 0) {
    return null;
  }
  if (typeof locationId !== "string" || locationId.length === 0) {
    return null;
  }
  return { inventoryItemId, locationId };
}

type ShopifyAdjustResult =
  | { readonly kind: "ok"; readonly inventoryItemId: string; readonly locationId: string }
  | { readonly kind: "rejected" }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "rate_limited" }
  | { readonly kind: "unavailable" };

async function postInventoryAdjust(
  accessToken: string,
  stored: ShopifyInventoryStored,
): Promise<ShopifyAdjustResult> {
  const url = `https://${stored.shop}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({
        query: INVENTORY_ADJUST_DOCUMENT,
        operationName: "InventoryAdjust",
        variables: {
          input: {
            reason: stored.reason,
            name: stored.quantity_name,
            changes: [
              {
                inventoryItemId: stored.inventory_item_id,
                locationId: stored.location_id,
                delta: stored.delta,
              },
            ],
          },
        },
      }),
      cache: "no-store",
      redirect: "manual",
    });
  } catch {
    return { kind: "unavailable" };
  }
  if (response.status === 401) {
    return { kind: "unauthorized" };
  }
  if (response.status === 403) {
    return { kind: "forbidden" };
  }
  if (response.status === 429) {
    return { kind: "rate_limited" };
  }
  if (!response.ok) {
    return { kind: "unavailable" };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: "unavailable" };
  }
  if (/throttl|rate.?limit/i.test(graphqlErrorText(body))) {
    return { kind: "rate_limited" };
  }
  if (graphqlErrorText(body).length > 0) {
    return { kind: "unavailable" };
  }
  const payload = inventoryPayload(body);
  const userErrors = payload === null ? undefined : payload["userErrors"];
  if (Array.isArray(userErrors) && userErrors.length > 0) {
    return { kind: "rejected" };
  }
  const ids = adjustmentIds(body);
  if (ids === null) {
    return { kind: "unavailable" };
  }
  return { kind: "ok", inventoryItemId: ids.inventoryItemId, locationId: ids.locationId };
}

function shopifyAdjustError(result: Exclude<ShopifyAdjustResult, { readonly kind: "ok" }>): Response {
  switch (result.kind) {
    case "rejected":
      return json({ error: "shopify_rejected" }, 400);
    case "unauthorized":
      return json({ error: "shopify_unauthorized" }, 401);
    case "forbidden":
      return json({ error: "shopify_forbidden" }, 403);
    case "rate_limited":
      return json({ error: "shopify_rate_limited" }, 429);
    case "unavailable":
      return json({ error: "shopify_unavailable" }, 502);
    default: {
      const unexpected: never = result;
      return unexpected;
    }
  }
}

async function confirmShopifyInventory(
  previewId: string,
  phrase: unknown,
  stored: ShopifyInventoryStored,
  grant: ActiveGrant,
  env: Env,
  key: string,
): Promise<Response> {
  if (grant.shopify === null) {
    return json({ error: "shopify_not_linked" }, 403);
  }
  if (grant.shopify.shop !== stored.shop) {
    return json({ error: "preview_forbidden" }, 403);
  }
  if (typeof phrase !== "string" || !phraseCovers(phrase, stored.resource_ids)) {
    return json({ error: "confirm_refused", confirm_required: true }, 400);
  }
  const accessToken = await openRefreshToken(grant.shopify.access_token, env.MUSE_TOKEN_ENC_KEY);
  if (accessToken === null) {
    return json({ error: "grant_unreadable" }, 500);
  }
  const result = await postInventoryAdjust(accessToken, stored);
  if (result.kind !== "ok") {
    return shopifyAdjustError(result);
  }
  await env.MUSE_TOKENS.delete(key);
  return json(
    {
      status: "confirmed",
      preview_id: previewId,
      kind: stored.kind,
      executed: true,
      inventory_item_id: result.inventoryItemId,
      location_id: result.locationId,
    },
    200,
  );
}

function profileImportBody(stored: KlaviyoProfileStored): Record<string, unknown> {
  const attributes: Record<string, string> = {};
  if (stored.email !== undefined) {
    attributes.email = stored.email;
  }
  if (stored.external_id !== undefined) {
    attributes.external_id = stored.external_id;
  }
  if (stored.first_name !== undefined) {
    attributes.first_name = stored.first_name;
  }
  if (stored.last_name !== undefined) {
    attributes.last_name = stored.last_name;
  }
  const data: Record<string, unknown> = { type: "profile", attributes };
  if (stored.profile_id !== undefined) {
    data.id = stored.profile_id;
  }
  return { data };
}

function profileIdOf(body: unknown): string | null {
  if (!isRecord(body) || !isRecord(body["data"])) {
    return null;
  }
  const id = body["data"]["id"];
  if (typeof id !== "string" || id.length === 0 || id.length > KLAVIYO_TEXT_MAX || /[\u0000-\u001F]/.test(id)) {
    return null;
  }
  return id;
}

type KlaviyoUpsertResult =
  | { readonly kind: "ok"; readonly profileId: string }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "rate_limited" }
  | { readonly kind: "unavailable" };

async function postProfileImport(
  apiKey: string,
  stored: KlaviyoProfileStored,
): Promise<KlaviyoUpsertResult> {
  let response: Response;
  try {
    response = await fetch(`${KLAVIYO_ORIGIN}/api/profile-import`, {
      method: "POST",
      headers: {
        accept: "application/vnd.api+json",
        authorization: `Klaviyo-API-Key ${apiKey}`,
        "content-type": "application/vnd.api+json",
        revision: KLAVIYO_API_REVISION,
      },
      body: JSON.stringify(profileImportBody(stored)),
      cache: "no-store",
      redirect: "manual",
    });
  } catch {
    return { kind: "unavailable" };
  }
  if (response.status === 401) {
    return { kind: "unauthorized" };
  }
  if (response.status === 403) {
    return { kind: "forbidden" };
  }
  if (response.status === 429) {
    return { kind: "rate_limited" };
  }
  if (!response.ok) {
    return { kind: "unavailable" };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: "unavailable" };
  }
  const profileId = profileIdOf(body);
  if (profileId === null) {
    return { kind: "unavailable" };
  }
  return { kind: "ok", profileId };
}

function klaviyoUpsertError(result: Exclude<KlaviyoUpsertResult, { readonly kind: "ok" }>): Response {
  switch (result.kind) {
    case "unauthorized":
      return json({ error: "klaviyo_unauthorized" }, 401);
    case "forbidden":
      return json({ error: "klaviyo_forbidden" }, 403);
    case "rate_limited":
      return json({ error: "klaviyo_rate_limited" }, 429);
    case "unavailable":
      return json({ error: "klaviyo_unavailable" }, 502);
    default: {
      const unexpected: never = result;
      return unexpected;
    }
  }
}

async function confirmKlaviyoProfile(
  previewId: string,
  phrase: unknown,
  stored: KlaviyoProfileStored,
  grant: ActiveGrant,
  env: Env,
  key: string,
): Promise<Response> {
  if (grant.klaviyo === null) {
    return json({ error: "klaviyo_not_linked" }, 403);
  }
  if (typeof phrase !== "string" || !phraseCovers(phrase, stored.resource_ids)) {
    return json({ error: "confirm_refused", confirm_required: true }, 400);
  }
  const apiKey = await openRefreshToken(grant.klaviyo.api_key, env.MUSE_TOKEN_ENC_KEY);
  if (apiKey === null) {
    return json({ error: "grant_unreadable" }, 500);
  }
  const result = await postProfileImport(apiKey, stored);
  if (result.kind !== "ok") {
    return klaviyoUpsertError(result);
  }
  await env.MUSE_TOKENS.delete(key);
  return json(
    {
      status: "confirmed",
      preview_id: previewId,
      kind: stored.kind,
      executed: true,
      profile_id: result.profileId,
    },
    200,
  );
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
  if (stored.kind === "shopify_inventory_adjust") {
    return confirmShopifyInventory(parsed.previewId, parsed.phrase, stored, grant, env, key);
  }
  if (stored.kind === "klaviyo_upsert_profile") {
    return confirmKlaviyoProfile(parsed.previewId, parsed.phrase, stored, grant, env, key);
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
