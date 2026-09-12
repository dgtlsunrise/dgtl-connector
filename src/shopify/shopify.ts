import type { AppContext } from "../context.js";
import { failEnvelope, okEnvelope, HINT_EMPTY_LIST, type Envelope } from "../envelope.js";
import { MSG, ToolError } from "../errors.js";
import { asInt, requireId } from "../ids.js";
import type { HttpCall } from "../http/calls.js";
import {
  missingShopifyScope,
  resolveShopifyCredentials,
  SHOPIFY_API_VERSION,
  type ShopifyCredentials,
} from "./auth.js";
import { ShopifyHttp } from "./http.js";
import {
  OP_INVENTORY_LEVELS,
  OP_LOCATIONS,
  OP_ORDER,
  OP_ORDERS,
  OP_PRODUCT,
  OP_PRODUCTS,
  OP_SHOP,
} from "./queries.js";

export type ShopifyNeededScope =
  | "read_products"
  | "read_orders"
  | "read_inventory"
  | "read_locations"
  | "write_inventory"
  | null;

const FINANCIAL = new Set([
  "any",
  "authorized",
  "pending",
  "paid",
  "partially_paid",
  "refunded",
  "voided",
  "partially_refunded",
  "unpaid",
]);

const FULFILLMENT = new Set([
  "any",
  "shipped",
  "partial",
  "unshipped",
  "unfulfilled",
  "fulfilled",
]);

export function normalizeGid(
  raw: string,
  resource: "Product" | "Order" | "Location" | "InventoryItem",
): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("gid://shopify/")) return trimmed;
  if (/^\d+$/.test(trimmed)) return `gid://shopify/${resource}/${trimmed}`;
  throw new ToolError(
    "INVALID_ARGUMENT",
    `${resource} id must be numeric or gid://shopify/${resource}/{id}`,
    { resource_id: trimmed, api: "shopify-admin-graphql" },
  );
}

export async function withShopify(
  ctx: AppContext,
  tool: string,
  neededScope: ShopifyNeededScope,
  run: (http: ShopifyHttp, creds: ShopifyCredentials) => Promise<Envelope>,
): Promise<Envelope> {
  const creds = await resolveShopifyCredentials({
    env: ctx.env,
    pluginDataDir: ctx.pluginDataDir,
    fetchImpl: ctx.fetchImpl,
  });
  if (!creds) {
    return failEnvelope(tool, "SHOPIFY_NOT_CONNECTED", MSG.SHOPIFY_NOT_CONNECTED, {
      hint: "Set SHOPIFY_STORE + SHOPIFY_ACCESS_TOKEN (merchant custom app) or PLUGIN_DATA/shopify-oauth.json. Reads: read_products + read_orders + read_inventory + read_locations. Writes: write_inventory + DGTL_WRITES_ENABLED (local only). Free local — no Polar / stamp. Support never collects Shopify tokens.",
      api: "shopify-admin-graphql",
    });
  }
  if (neededScope && missingShopifyScope(creds.scopes, neededScope)) {
    return failEnvelope(tool, "SHOPIFY_SCOPE_MISSING", MSG.SHOPIFY_SCOPE_MISSING, {
      missing_scope: neededScope,
      hint: `Detectable scopes omit ${neededScope}. Reinstall the merchant custom app. Default install is read_* only; write_inventory is an explicit scope expansion (not a stamp vault, not Polar).`,
      api: "shopify-admin-graphql",
    });
  }
  const http = new ShopifyHttp({
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

export async function shopifyGetShop(ctx: AppContext): Promise<Envelope> {
  return withShopify(ctx, "shopify_get_shop", null, async (http, creds) => {
    const data = await http.graphql({ operation: OP_SHOP, tool: "shopify_get_shop" });
    const shop = data.shop as Record<string, unknown> | undefined;
    return okEnvelope("shopify_get_shop", {
      data: {
        shop,
        cited: { store: creds.storeHost, api_version: SHOPIFY_API_VERSION },
      },
      resource: shop
        ? {
            type: "shopify_shop",
            id: String(shop.myshopifyDomain ?? creds.storeHost),
            display_name: String(shop.name ?? creds.storeHost),
          }
        : undefined,
      page: { truncated: false, row_count: shop ? 1 : 0 },
      hint: "Local merchant credentials. Confirm store domain before listing products/orders.",
    });
  });
}

export async function shopifyListProducts(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  return withShopify(ctx, "shopify_list_products", "read_products", async (http, creds) => {
    const first = asInt(args.page_size, 25, 1, 50);
    const after =
      typeof args.page_token === "string" && args.page_token.trim()
        ? args.page_token.trim()
        : undefined;
    const data = await http.graphql({
      operation: OP_PRODUCTS,
      variables: { first, after: after ?? null },
      tool: "shopify_list_products",
    });
    const conn = data.products as
      | {
          pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
          nodes?: unknown[];
        }
      | undefined;
    const nodes = Array.isArray(conn?.nodes) ? conn!.nodes! : [];
    const next =
      conn?.pageInfo?.hasNextPage && conn.pageInfo.endCursor
        ? String(conn.pageInfo.endCursor)
        : undefined;
    return okEnvelope("shopify_list_products", {
      data: {
        products: nodes,
        cited: { store: creds.storeHost, api_version: SHOPIFY_API_VERSION },
      },
      page: {
        row_count: nodes.length,
        truncated: Boolean(next),
        next_page_token: next,
      },
      hint: nodes.length === 0 ? HINT_EMPTY_LIST : undefined,
    });
  });
}

export async function shopifyGetProduct(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  return withShopify(ctx, "shopify_get_product", "read_products", async (http, creds) => {
    const id = normalizeGid(requireId(args.product_id, "product_id"), "Product");
    const data = await http.graphql({
      operation: OP_PRODUCT,
      variables: { id },
      tool: "shopify_get_product",
    });
    const product = data.product as Record<string, unknown> | null | undefined;
    if (!product) {
      return failEnvelope("shopify_get_product", "NOT_FOUND", MSG.NOT_FOUND, {
        resource_id: id,
        api: "shopify-admin-graphql",
        hint: "Copy product id from shopify_list_products (gid or numeric).",
      });
    }
    return okEnvelope("shopify_get_product", {
      data: {
        product,
        cited: { store: creds.storeHost, product_id: id, api_version: SHOPIFY_API_VERSION },
      },
      resource: {
        type: "shopify_product",
        id: String(product.id ?? id),
        display_name: String(product.title ?? id),
      },
      page: { truncated: false, row_count: 1 },
    });
  });
}

function buildOrderQuery(args: Record<string, unknown>): string | undefined {
  const parts: string[] = [];
  if (typeof args.status === "string" && args.status.trim() && args.status !== "any") {
    // Shopify search: status:open|closed|cancelled
    parts.push(`status:${args.status.trim()}`);
  }
  if (typeof args.financial_status === "string" && args.financial_status.trim()) {
    const fs = args.financial_status.trim().toLowerCase();
    if (!FINANCIAL.has(fs)) {
      throw new ToolError(
        "INVALID_ARGUMENT",
        MSG.INVALID_ARGUMENT,
        {
          hint: `financial_status must be one of: ${[...FINANCIAL].join(", ")}`,
          api: "shopify-admin-graphql",
        },
      );
    }
    if (fs !== "any") parts.push(`financial_status:${fs}`);
  }
  if (typeof args.fulfillment_status === "string" && args.fulfillment_status.trim()) {
    const ff = args.fulfillment_status.trim().toLowerCase();
    if (!FULFILLMENT.has(ff)) {
      throw new ToolError(
        "INVALID_ARGUMENT",
        MSG.INVALID_ARGUMENT,
        {
          hint: `fulfillment_status must be one of: ${[...FULFILLMENT].join(", ")}`,
          api: "shopify-admin-graphql",
        },
      );
    }
    if (ff !== "any") parts.push(`fulfillment_status:${ff}`);
  }
  if (typeof args.created_at_min === "string" && args.created_at_min.trim()) {
    parts.push(`created_at:>=${args.created_at_min.trim()}`);
  }
  if (typeof args.created_at_max === "string" && args.created_at_max.trim()) {
    parts.push(`created_at:<=${args.created_at_max.trim()}`);
  }
  return parts.length ? parts.join(" ") : undefined;
}

export async function shopifyListOrders(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  return withShopify(ctx, "shopify_list_orders", "read_orders", async (http, creds) => {
    if (typeof args.status === "string" && args.status.trim()) {
      const st = args.status.trim().toLowerCase();
      if (!["any", "open", "closed", "cancelled"].includes(st)) {
        return failEnvelope("shopify_list_orders", "INVALID_ARGUMENT", MSG.INVALID_ARGUMENT, {
          hint: "status must be any|open|closed|cancelled",
          api: "shopify-admin-graphql",
        });
      }
    }
    let query: string | undefined;
    try {
      query = buildOrderQuery(args);
    } catch (err) {
      if (err instanceof ToolError) {
        return failEnvelope("shopify_list_orders", err.error_code, err.message, err.extra);
      }
      throw err;
    }
    const first = asInt(args.page_size, 25, 1, 50);
    const after =
      typeof args.page_token === "string" && args.page_token.trim()
        ? args.page_token.trim()
        : undefined;
    const data = await http.graphql({
      operation: OP_ORDERS,
      variables: { first, after: after ?? null, query: query ?? null },
      tool: "shopify_list_orders",
    });
    const conn = data.orders as
      | {
          pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
          nodes?: unknown[];
        }
      | undefined;
    const nodes = Array.isArray(conn?.nodes) ? conn!.nodes! : [];
    const next =
      conn?.pageInfo?.hasNextPage && conn.pageInfo.endCursor
        ? String(conn.pageInfo.endCursor)
        : undefined;
    return okEnvelope("shopify_list_orders", {
      data: {
        orders: nodes,
        cited: {
          store: creds.storeHost,
          query: query ?? null,
          api_version: SHOPIFY_API_VERSION,
        },
      },
      page: {
        row_count: nodes.length,
        truncated: Boolean(next),
        next_page_token: next,
      },
      hint: nodes.length === 0 ? HINT_EMPTY_LIST : undefined,
    });
  });
}

export async function shopifyGetOrder(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  return withShopify(ctx, "shopify_get_order", "read_orders", async (http, creds) => {
    const id = normalizeGid(requireId(args.order_id, "order_id"), "Order");
    const data = await http.graphql({
      operation: OP_ORDER,
      variables: { id },
      tool: "shopify_get_order",
    });
    const order = data.order as Record<string, unknown> | null | undefined;
    if (!order) {
      return failEnvelope("shopify_get_order", "NOT_FOUND", MSG.NOT_FOUND, {
        resource_id: id,
        api: "shopify-admin-graphql",
        hint: "Copy order id from shopify_list_orders (gid or numeric).",
      });
    }
    return okEnvelope("shopify_get_order", {
      data: {
        order,
        cited: { store: creds.storeHost, order_id: id, api_version: SHOPIFY_API_VERSION },
      },
      resource: {
        type: "shopify_order",
        id: String(order.id ?? id),
        display_name: String(order.name ?? id),
      },
      page: { truncated: false, row_count: 1 },
    });
  });
}

export async function shopifyListLocations(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  return withShopify(ctx, "shopify_list_locations", "read_locations", async (http, creds) => {
    const first = asInt(args.page_size, 25, 1, 50);
    const after =
      typeof args.page_token === "string" && args.page_token.trim()
        ? args.page_token.trim()
        : undefined;
    const data = await http.graphql({
      operation: OP_LOCATIONS,
      variables: { first, after: after ?? null },
      tool: "shopify_list_locations",
    });
    const conn = data.locations as
      | {
          pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
          nodes?: unknown[];
        }
      | undefined;
    const nodes = Array.isArray(conn?.nodes) ? conn!.nodes! : [];
    const next =
      conn?.pageInfo?.hasNextPage && conn.pageInfo.endCursor
        ? String(conn.pageInfo.endCursor)
        : undefined;
    return okEnvelope("shopify_list_locations", {
      data: {
        locations: nodes,
        cited: { store: creds.storeHost, api_version: SHOPIFY_API_VERSION },
      },
      page: {
        row_count: nodes.length,
        truncated: Boolean(next),
        next_page_token: next,
      },
      hint: nodes.length === 0 ? HINT_EMPTY_LIST : "Copy location id for shopify_list_inventory_levels.",
    });
  });
}

export async function shopifyListInventoryLevels(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  return withShopify(ctx, "shopify_list_inventory_levels", "read_inventory", async (http, creds) => {
    const locationId = normalizeGid(requireId(args.location_id, "location_id"), "Location");
    const first = asInt(args.page_size, 25, 1, 50);
    const after =
      typeof args.page_token === "string" && args.page_token.trim()
        ? args.page_token.trim()
        : undefined;
    const data = await http.graphql({
      operation: OP_INVENTORY_LEVELS,
      variables: { id: locationId, first, after: after ?? null },
      tool: "shopify_list_inventory_levels",
    });
    const location = data.location as
      | {
          id?: string;
          name?: string;
          inventoryLevels?: {
            pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
            nodes?: unknown[];
          };
        }
      | null
      | undefined;
    if (!location) {
      return failEnvelope("shopify_list_inventory_levels", "NOT_FOUND", MSG.NOT_FOUND, {
        resource_id: locationId,
        api: "shopify-admin-graphql",
        hint: "Copy location id from shopify_list_locations (gid or numeric).",
      });
    }
    const conn = location.inventoryLevels;
    const nodes = Array.isArray(conn?.nodes) ? conn!.nodes! : [];
    const next =
      conn?.pageInfo?.hasNextPage && conn.pageInfo.endCursor
        ? String(conn.pageInfo.endCursor)
        : undefined;
    return okEnvelope("shopify_list_inventory_levels", {
      data: {
        location: { id: location.id, name: location.name },
        inventory_levels: nodes,
        cited: {
          store: creds.storeHost,
          location_id: locationId,
          api_version: SHOPIFY_API_VERSION,
        },
      },
      resource: {
        type: "shopify_location",
        id: String(location.id ?? locationId),
        display_name: String(location.name ?? locationId),
      },
      page: {
        row_count: nodes.length,
        truncated: Boolean(next),
        next_page_token: next,
      },
      hint:
        nodes.length === 0
          ? HINT_EMPTY_LIST
          : "Join item.sku to Merchant Center offerId. inventoryItem id is required for shopify_adjust_inventory.",
    });
  });
}
