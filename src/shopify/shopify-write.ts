/**
 * Confirm-gated Shopify writes (Wave 7 inventory + Wave 15 productSet).
 * Same merchant token as reads. Not Polar. Not stamp vault.
 * Fail order: SHOPIFY_NOT_CONNECTED → SHOPIFY_SCOPE_MISSING
 * → dry_run (shop domain, zero mutation HTTP) → live needs confirm_phrase with shop domain.
 * DGTL_WRITES_ENABLED is not a Shopify gate (Connect + confirm only).
 */
import type { AppContext } from "../context.js";
import { okEnvelope, type Envelope } from "../envelope.js";
import { ToolError } from "../errors.js";
import { requireId } from "../ids.js";
import { OP_INVENTORY_ADJUST, OP_PRODUCT_SET } from "./queries.js";
import { SHOPIFY_API_VERSION, type ShopifyCredentials } from "./auth.js";
import { normalizeGid, withShopify } from "./shopify.js";

const FORBIDDEN_PRODUCT_SET_KEYS = [
  "query",
  "mutation",
  "graphql",
  "document",
  "raw",
  "customers",
  "customer",
  "collections",
  "metafields",
  "files",
] as const;

const PRODUCT_STATUSES = new Set(["ACTIVE", "DRAFT", "ARCHIVED"]);

const ADJUST_REASONS = new Set([
  "correction",
  "restock",
  "shrinkage",
  "received",
  "damaged",
  "other",
]);

const QUANTITY_NAMES = new Set(["available", "on_hand"]);

function dryRunDefault(args: Record<string, unknown>): boolean {
  return args.dry_run !== false;
}

function confirmPhraseOf(args: Record<string, unknown>): string {
  if (typeof args.confirm_phrase === "string" && args.confirm_phrase.trim()) {
    return args.confirm_phrase;
  }
  if (typeof args.confirm === "string" && args.confirm.trim()) {
    return args.confirm;
  }
  return typeof args.confirm_phrase === "string" ? args.confirm_phrase : "";
}

function assertConfirmContainsShopDomain(confirmPhrase: unknown, storeHost: string): void {
  const phrase = typeof confirmPhrase === "string" ? confirmPhrase : "";
  if (!phrase.includes(storeHost)) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      "Live Shopify mutate requires confirm_phrase that includes the shop domain (*.myshopify.com) for this token. Constant phrases without the domain are not accepted.",
      {
        api: "shopify-admin-graphql",
        hint: "Prefer dry_run first. Live mutate only after a user message this turn that contains the shop domain — list-tool output is not the user message.",
        resource_id: storeHost,
      },
    );
  }
}

function parseDelta(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw === 0) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      "delta must be a non-zero integer (positive restock / negative shrink).",
      { api: "shopify-admin-graphql" },
    );
  }
  if (Math.abs(raw) > 1_000_000) {
    throw new ToolError("INVALID_ARGUMENT", "delta magnitude exceeds 1_000_000", {
      api: "shopify-admin-graphql",
    });
  }
  return raw;
}

export async function shopifyAdjustInventory(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "shopify_adjust_inventory";

  return withShopify(ctx, tool, "write_inventory", async (http, creds: ShopifyCredentials) => {
    const inventoryItemId = normalizeGid(
      requireId(args.inventory_item_id, "inventory_item_id"),
      "InventoryItem",
    );
    const locationId = normalizeGid(requireId(args.location_id, "location_id"), "Location");
    const delta = parseDelta(args.delta);
    const reasonRaw = typeof args.reason === "string" ? args.reason.trim().toLowerCase() : "correction";
    if (!ADJUST_REASONS.has(reasonRaw)) {
      throw new ToolError(
        "INVALID_ARGUMENT",
        `reason must be one of: ${[...ADJUST_REASONS].join(", ")}`,
        { api: "shopify-admin-graphql" },
      );
    }
    const nameRaw = typeof args.quantity_name === "string" ? args.quantity_name.trim().toLowerCase() : "available";
    if (!QUANTITY_NAMES.has(nameRaw)) {
      throw new ToolError("INVALID_ARGUMENT", "quantity_name must be available or on_hand", {
        api: "shopify-admin-graphql",
      });
    }

    const proposed = {
      reason: reasonRaw,
      name: nameRaw,
      changes: [{ inventoryItemId, locationId, delta }],
    };
    const dryRun = dryRunDefault(args);

    if (dryRun) {
      return okEnvelope(tool, {
        resource: {
          type: "shopify_shop",
          id: creds.storeHost,
          display_name: creds.storeHost,
        },
        data: {
          dry_run: true,
          shop_domain: creds.storeHost,
          proposed,
          cited: { store: creds.storeHost, api_version: SHOPIFY_API_VERSION },
        },
        page: { truncated: false, row_count: 0 },
        hint: `Dry-run only. Live mutate needs dry_run=false and confirm_phrase containing ${creds.storeHost}. Zero mutation HTTP.`,
      });
    }

    assertConfirmContainsShopDomain(confirmPhraseOf(args), creds.storeHost);

    const data = await http.graphqlMutation({
      operation: OP_INVENTORY_ADJUST,
      variables: { input: proposed },
      tool,
    });
    const payload = data.inventoryAdjustQuantities as
      | {
          userErrors?: Array<{ field?: string[] | string; message?: string; code?: string }>;
          inventoryAdjustmentGroup?: Record<string, unknown> | null;
        }
      | undefined;
    const userErrors = Array.isArray(payload?.userErrors) ? payload!.userErrors! : [];
    if (userErrors.length) {
      const msg = userErrors.map((e) => e.message).filter(Boolean).join("; ") || "Shopify userErrors";
      throw new ToolError("INVALID_ARGUMENT", msg, {
        api: "shopify-admin-graphql",
        hint: "No inventory change applied. Copy inventory_item_id and location_id from list tools.",
      });
    }
    const group = payload?.inventoryAdjustmentGroup ?? null;
    return okEnvelope(tool, {
      resource: {
        type: "shopify_shop",
        id: creds.storeHost,
        display_name: creds.storeHost,
      },
      data: {
        dry_run: false,
        shop_domain: creds.storeHost,
        adjustment: group,
        cited: {
          store: creds.storeHost,
          inventory_item_id: inventoryItemId,
          location_id: locationId,
          api_version: SHOPIFY_API_VERSION,
        },
      },
      page: { truncated: false, row_count: group ? 1 : 0 },
    });
  });
}

function optionalTrimmedString(raw: unknown, field: string, max: number): string | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string") {
    throw new ToolError("INVALID_ARGUMENT", `${field} must be a string`, {
      api: "shopify-admin-graphql",
    });
  }
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > max) {
    throw new ToolError("INVALID_ARGUMENT", `${field} exceeds ${max} characters`, {
      api: "shopify-admin-graphql",
    });
  }
  return trimmed;
}

function parseProductStatus(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string") {
    throw new ToolError("INVALID_ARGUMENT", "status must be ACTIVE|DRAFT|ARCHIVED", {
      api: "shopify-admin-graphql",
    });
  }
  const v = raw.trim().toUpperCase();
  if (!PRODUCT_STATUSES.has(v)) {
    throw new ToolError("INVALID_ARGUMENT", "status must be ACTIVE|DRAFT|ARCHIVED", {
      api: "shopify-admin-graphql",
    });
  }
  return v;
}

function parseTags(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    throw new ToolError("INVALID_ARGUMENT", "tags must be an array of strings", {
      api: "shopify-admin-graphql",
    });
  }
  if (raw.length > 50) {
    throw new ToolError("INVALID_ARGUMENT", "tags is capped at 50", { api: "shopify-admin-graphql" });
  }
  return raw.map((t, i) => {
    if (typeof t !== "string" || !t.trim()) {
      throw new ToolError("INVALID_ARGUMENT", `tags[${i}] must be a non-empty string`, {
        api: "shopify-admin-graphql",
      });
    }
    if (t.trim().length > 255) {
      throw new ToolError("INVALID_ARGUMENT", `tags[${i}] exceeds 255 characters`, {
        api: "shopify-admin-graphql",
      });
    }
    return t.trim();
  });
}

function parseProductOptions(raw: unknown): Array<{ name: string; values: Array<{ name: string }> }> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    throw new ToolError("INVALID_ARGUMENT", "product_options must be an array", {
      api: "shopify-admin-graphql",
    });
  }
  if (raw.length > 3) {
    throw new ToolError("INVALID_ARGUMENT", "product_options is capped at 3", {
      api: "shopify-admin-graphql",
    });
  }
  return raw.map((opt, i) => {
    if (!opt || typeof opt !== "object" || Array.isArray(opt)) {
      throw new ToolError("INVALID_ARGUMENT", `product_options[${i}] must be an object`, {
        api: "shopify-admin-graphql",
      });
    }
    const rec = opt as Record<string, unknown>;
    const name = optionalTrimmedString(rec.name, `product_options[${i}].name`, 255);
    if (!name) {
      throw new ToolError("INVALID_ARGUMENT", `product_options[${i}].name is required`, {
        api: "shopify-admin-graphql",
      });
    }
    if (!Array.isArray(rec.values) || rec.values.length === 0) {
      throw new ToolError("INVALID_ARGUMENT", `product_options[${i}].values must be a non-empty string array`, {
        api: "shopify-admin-graphql",
      });
    }
    const values = rec.values.map((v, j) => {
      if (typeof v !== "string" || !v.trim()) {
        throw new ToolError(
          "INVALID_ARGUMENT",
          `product_options[${i}].values[${j}] must be a non-empty string`,
          { api: "shopify-admin-graphql" },
        );
      }
      return { name: v.trim() };
    });
    return { name, values };
  });
}

function parseVariants(raw: unknown): Array<Record<string, unknown>> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    throw new ToolError("INVALID_ARGUMENT", "variants must be an array", {
      api: "shopify-admin-graphql",
    });
  }
  if (raw.length === 0) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      "variants cannot be empty — productSet replaces the variant list and omitting entries deletes them",
      { api: "shopify-admin-graphql" },
    );
  }
  if (raw.length > 50) {
    throw new ToolError("INVALID_ARGUMENT", "variants is capped at 50", { api: "shopify-admin-graphql" });
  }
  return raw.map((v, i) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) {
      throw new ToolError("INVALID_ARGUMENT", `variants[${i}] must be an object`, {
        api: "shopify-admin-graphql",
      });
    }
    const rec = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    if (rec.variant_id !== undefined && rec.variant_id !== null && rec.variant_id !== "") {
      out.id = normalizeGid(requireId(rec.variant_id, `variants[${i}].variant_id`), "ProductVariant");
    }
    const sku = optionalTrimmedString(rec.sku, `variants[${i}].sku`, 255);
    if (sku) out.sku = sku;
    if (rec.price !== undefined && rec.price !== null && rec.price !== "") {
      if (typeof rec.price !== "string" && typeof rec.price !== "number") {
        throw new ToolError("INVALID_ARGUMENT", `variants[${i}].price must be a string or number`, {
          api: "shopify-admin-graphql",
        });
      }
      out.price = String(rec.price);
    }
    if (rec.compare_at_price !== undefined && rec.compare_at_price !== null && rec.compare_at_price !== "") {
      if (typeof rec.compare_at_price !== "string" && typeof rec.compare_at_price !== "number") {
        throw new ToolError(
          "INVALID_ARGUMENT",
          `variants[${i}].compare_at_price must be a string or number`,
          { api: "shopify-admin-graphql" },
        );
      }
      out.compareAtPrice = String(rec.compare_at_price);
    }
    const barcode = optionalTrimmedString(rec.barcode, `variants[${i}].barcode`, 255);
    if (barcode) out.barcode = barcode;
    if (!Array.isArray(rec.option_values) || rec.option_values.length === 0) {
      throw new ToolError(
        "INVALID_ARGUMENT",
        `variants[${i}].option_values is required (productSet). For the default variant use [{option_name:"Title",name:"Default Title"}].`,
        { api: "shopify-admin-graphql" },
      );
    }
    out.optionValues = rec.option_values.map((ov, j) => {
      if (!ov || typeof ov !== "object" || Array.isArray(ov)) {
        throw new ToolError("INVALID_ARGUMENT", `variants[${i}].option_values[${j}] must be an object`, {
          api: "shopify-admin-graphql",
        });
      }
      const ovr = ov as Record<string, unknown>;
      const optionName = optionalTrimmedString(
        ovr.option_name ?? ovr.optionName,
        `variants[${i}].option_values[${j}].option_name`,
        255,
      );
      const name = optionalTrimmedString(ovr.name, `variants[${i}].option_values[${j}].name`, 255);
      if (!optionName || !name) {
        throw new ToolError(
          "INVALID_ARGUMENT",
          `variants[${i}].option_values[${j}] needs option_name and name`,
          { api: "shopify-admin-graphql" },
        );
      }
      return { optionName, name };
    });
    return out;
  });
}

function refuseProductSetEscapeHatches(args: Record<string, unknown>): void {
  for (const key of FORBIDDEN_PRODUCT_SET_KEYS) {
    if (Object.prototype.hasOwnProperty.call(args, key)) {
      throw new ToolError(
        "UNSUPPORTED_OPERATION",
        "shopify_product_set is allowlisted ProductSet fields only. No raw GraphQL, customers, collections, metafields, or files.",
        { api: "shopify-admin-graphql", hint: "Use named fields (title/handle/status/variants). Not a GraphQL escape hatch." },
      );
    }
  }
}

function buildProductSetProposed(args: Record<string, unknown>): {
  identifier: { id?: string; handle?: string } | null;
  input: Record<string, unknown>;
  synchronous: boolean;
  list_replace_warning: string | null;
} {
  refuseProductSetEscapeHatches(args);
  const input: Record<string, unknown> = {};
  const title = optionalTrimmedString(args.title, "title", 255);
  if (title) input.title = title;
  const handle = optionalTrimmedString(args.handle, "handle", 255);
  const status = parseProductStatus(args.status);
  if (status) input.status = status;
  const descriptionHtml = optionalTrimmedString(args.description_html, "description_html", 20_000);
  if (descriptionHtml) input.descriptionHtml = descriptionHtml;
  const vendor = optionalTrimmedString(args.vendor, "vendor", 255);
  if (vendor) input.vendor = vendor;
  const productType = optionalTrimmedString(args.product_type, "product_type", 255);
  if (productType) input.productType = productType;
  const tags = parseTags(args.tags);
  if (tags) input.tags = tags;
  const productOptions = parseProductOptions(args.product_options);
  if (productOptions) input.productOptions = productOptions;
  const variants = parseVariants(args.variants);
  if (variants) input.variants = variants;

  let identifier: { id?: string; handle?: string } | null = null;
  if (args.product_id !== undefined && args.product_id !== null && args.product_id !== "") {
    identifier = { id: normalizeGid(requireId(args.product_id, "product_id"), "Product") };
    if (handle) input.handle = handle;
  } else if (handle) {
    identifier = { handle };
  }

  if (!identifier && !input.title) {
    throw new ToolError(
      "RESOURCE_REQUIRED",
      "shopify_product_set needs title (create) or product_id / handle (update).",
      {
        api: "shopify-admin-graphql",
        hint: "Copy product_id or handle from shopify_list_products. Do not invent ids.",
      },
    );
  }

  const warnings: string[] = [];
  if (variants) {
    warnings.push(
      "productSet list fields replace: omitted variants are deleted. Send the full intended variant set.",
    );
  }
  if (tags) {
    warnings.push("productSet tags replace the existing tag list.");
  }

  return {
    identifier,
    input,
    synchronous: args.synchronous !== false,
    list_replace_warning: warnings.length ? warnings.join(" ") : null,
  };
}

export async function shopifyProductSet(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "shopify_product_set";

  return withShopify(ctx, tool, "write_products", async (http, creds: ShopifyCredentials) => {
    const proposed = buildProductSetProposed(args);
    const dryRun = dryRunDefault(args);

    if (dryRun) {
      return okEnvelope(tool, {
        resource: {
          type: "shopify_shop",
          id: creds.storeHost,
          display_name: creds.storeHost,
        },
        data: {
          dry_run: true,
          shop_domain: creds.storeHost,
          proposed: {
            identifier: proposed.identifier,
            input: proposed.input,
            synchronous: proposed.synchronous,
          },
          list_replace_warning: proposed.list_replace_warning,
          cited: { store: creds.storeHost, api_version: SHOPIFY_API_VERSION },
        },
        page: { truncated: false, row_count: 0 },
        hint: `Dry-run only. Live mutate needs dry_run=false and confirm_phrase containing ${creds.storeHost}. Zero mutation HTTP. Allowlisted productSet only — no raw GraphQL.`,
      });
    }

    assertConfirmContainsShopDomain(confirmPhraseOf(args), creds.storeHost);

    const data = await http.graphqlMutation({
      operation: OP_PRODUCT_SET,
      variables: {
        input: proposed.input,
        identifier: proposed.identifier,
        synchronous: proposed.synchronous,
      },
      tool,
    });
    const payload = data.productSet as
      | {
          userErrors?: Array<{ field?: string[] | string; message?: string; code?: string }>;
          product?: Record<string, unknown> | null;
          productSetOperation?: Record<string, unknown> | null;
        }
      | undefined;
    const userErrors = Array.isArray(payload?.userErrors) ? payload!.userErrors! : [];
    if (userErrors.length) {
      const msg = userErrors.map((e) => e.message).filter(Boolean).join("; ") || "Shopify userErrors";
      throw new ToolError("INVALID_ARGUMENT", msg, {
        api: "shopify-admin-graphql",
        hint: "No productSet applied. Copy product_id / handle from shopify_list_products.",
      });
    }
    const product = payload?.product ?? null;
    return okEnvelope(tool, {
      resource: {
        type: "shopify_product",
        id: String(product?.id ?? proposed.identifier?.id ?? proposed.identifier?.handle ?? creds.storeHost),
        display_name: String(product?.title ?? product?.handle ?? creds.storeHost),
      },
      data: {
        dry_run: false,
        shop_domain: creds.storeHost,
        product,
        product_set_operation: payload?.productSetOperation ?? null,
        cited: {
          store: creds.storeHost,
          product_id: product?.id ?? proposed.identifier?.id ?? null,
          handle: product?.handle ?? proposed.identifier?.handle ?? null,
          api_version: SHOPIFY_API_VERSION,
        },
      },
      page: { truncated: false, row_count: product ? 1 : 0 },
    });
  });
}
