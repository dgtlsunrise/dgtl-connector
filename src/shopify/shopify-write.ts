/**
 * Confirm-gated Shopify writes (Wave 7).
 * Same merchant token as reads. Not Polar. Not stamp vault.
 * Fail order: WRITE_NOT_ENABLED → SHOPIFY_NOT_CONNECTED → SHOPIFY_SCOPE_MISSING
 * → dry_run (shop domain, zero mutation HTTP) → live needs confirm_phrase with shop domain.
 */
import type { AppContext } from "../context.js";
import { failEnvelope, okEnvelope, type Envelope } from "../envelope.js";
import { ToolError } from "../errors.js";
import { requireId } from "../ids.js";
import { OP_INVENTORY_ADJUST } from "./queries.js";
import { SHOPIFY_API_VERSION, type ShopifyCredentials } from "./auth.js";
import { normalizeGid, withShopify } from "./shopify.js";

const HINT_FLAG =
  "Set DGTL_WRITES_ENABLED=true only after the merchant custom app grants write_inventory. Inventory/location reads stay LOCAL_FREE without this flag. Not Polar. Not a stamp multi-store vault. Marketplace default stays off.";

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
  if (!ctx.flags.writesEnabled) {
    return failEnvelope(
      tool,
      "WRITE_NOT_ENABLED",
      "Shopify write tools are flagged off (DGTL_WRITES_ENABLED=false). Inventory/location reads still work with the merchant token. Writes need write_inventory on the custom app plus this flag (local only; never marketplace default).",
      { hint: HINT_FLAG, api: "shopify-admin-graphql" },
    );
  }

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

    assertConfirmContainsShopDomain(args.confirm_phrase, creds.storeHost);

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
