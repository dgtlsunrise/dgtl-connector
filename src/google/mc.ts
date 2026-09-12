/**
 * Merchant Center — Merchant API (direct Google hop).
 *
 * Wave 4: read-only products / status / feed issues. Not Ads product_link.
 * Not stamp (Ads developer-token is the wrong secret; Content API for Shopping
 * sunset 2026-08-18). Consent MC only — never ctx.auth / Consent A.
 */
import type { AppContext } from "../context.js";
import { failEnvelope, HINT_EMPTY_LIST, okEnvelope, pageFromList, type Envelope } from "../envelope.js";
import { MSG } from "../errors.js";
import { asInt, normalizeMcProductId, normalizeMerchantId, requireId } from "../ids.js";
import { hasFeature } from "../license/verify.js";
import { APIS, SCOPE } from "./scopes.js";

const HOST = APIS.merchant;
const SCOPE_CONTENT = SCOPE.content;

type Rec = Record<string, unknown>;

function meta(tool: string, api: string) {
  return { api, requiredScope: SCOPE_CONTENT, tool };
}

function pageArgs(args: Rec): { pageSize: number; pageToken: string | undefined } {
  return {
    pageSize: asInt(args.page_size, 25, 1, 200),
    pageToken: typeof args.page_token === "string" ? args.page_token : undefined,
  };
}

/**
 * LICENSE_REQUIRED (ads) → MC_NOT_CONNECTED → MC_SCOPE_MISSING.
 * Direct hop: never GATEWAY_UNAVAILABLE. Never ctx.auth.
 */
export async function requireMcHop(ctx: AppContext, tool: string): Promise<Envelope | null> {
  if (!hasFeature(ctx.license, "ads")) {
    return failEnvelope(tool, "LICENSE_REQUIRED", MSG.LICENSE_REQUIRED, {
      hint: "Merchant Center reads are Pro (Polar ads feature). Polar has no separate mc bit. Consent MC is still a separate OAuth — never Consent A.",
    });
  }
  const tok = await ctx.authMc.getAccessToken();
  if (!tok?.accessToken) {
    return failEnvelope(tool, "MC_NOT_CONNECTED", MSG.MC_NOT_CONNECTED, {
      hint: "License is valid. Connect Consent MC via GOOGLE_MC_ACCESS_TOKEN or `auth login-mc` (PLUGIN_DATA/google-oauth-mc.json). Never reuse GOOGLE_ACCESS_TOKEN / Consent A. No stamp hop.",
      missing_scope: SCOPE_CONTENT,
    });
  }
  if (tok.scopes && tok.scopes.length > 0 && !tok.scopes.includes(SCOPE_CONTENT)) {
    return failEnvelope(tool, "MC_SCOPE_MISSING", MSG.MC_SCOPE_MISSING, {
      missing_scope: SCOPE_CONTENT,
      hint: "Re-run `auth login-mc` on the Consent MC client. Do not add content scope to the free Consent A Desktop client.",
    });
  }
  return null;
}

function merchantResource(merchant: { id: string; name: string }) {
  return { type: "mc_account", id: merchant.id, display_name: merchant.name };
}

export async function mcListAccounts(ctx: AppContext, args: Rec): Promise<Envelope> {
  const miss = await requireMcHop(ctx, "mc_list_accounts");
  if (miss) return miss;
  const { pageSize, pageToken } = pageArgs(args);
  const raw = (await ctx.httpMc.get(
    HOST,
    "/accounts/v1/accounts",
    { pageSize, pageToken },
    meta("mc_list_accounts", "merchantapi.googleapis.com/accounts/v1"),
  )) as Rec;
  const accounts = Array.isArray(raw.accounts) ? raw.accounts : [];
  return okEnvelope("mc_list_accounts", {
    data: { accounts },
    page: pageFromList(
      accounts,
      accounts.length,
      typeof raw.nextPageToken === "string" ? raw.nextPageToken : undefined,
    ),
    ...(accounts.length === 0 ? { hint: HINT_EMPTY_LIST } : {}),
  });
}

export async function mcListProducts(ctx: AppContext, args: Rec): Promise<Envelope> {
  const miss = await requireMcHop(ctx, "mc_list_products");
  if (miss) return miss;
  const merchant = normalizeMerchantId(requireId(args.merchant_id, "merchant_id"));
  const { pageSize, pageToken } = pageArgs(args);
  const raw = (await ctx.httpMc.get(
    HOST,
    `/products/v1/${merchant.name}/products`,
    { pageSize, pageToken },
    meta("mc_list_products", "merchantapi.googleapis.com/products/v1"),
  )) as Rec;
  const products = Array.isArray(raw.products) ? raw.products : [];
  return okEnvelope("mc_list_products", {
    resource: merchantResource(merchant),
    data: { products },
    page: pageFromList(
      products,
      products.length,
      typeof raw.nextPageToken === "string" ? raw.nextPageToken : undefined,
    ),
    ...(products.length === 0
      ? { hint: `${HINT_EMPTY_LIST} Empty products is not an auth failure — check merchant_id and feed.` }
      : {}),
  });
}

export async function mcGetProduct(ctx: AppContext, args: Rec): Promise<Envelope> {
  const miss = await requireMcHop(ctx, "mc_get_product");
  if (miss) return miss;
  const merchant = normalizeMerchantId(requireId(args.merchant_id, "merchant_id"));
  const productId = normalizeMcProductId(requireId(args.product_id, "product_id"));
  const raw = (await ctx.httpMc.get(
    HOST,
    `/products/v1/${merchant.name}/products/${productId}`,
    undefined,
    meta("mc_get_product", "merchantapi.googleapis.com/products/v1"),
  )) as Rec;
  const offerId = typeof raw.offerId === "string" ? raw.offerId : productId;
  return okEnvelope("mc_get_product", {
    resource: {
      type: "mc_product",
      id: productId,
      display_name: typeof (raw.productAttributes as Rec | undefined)?.title === "string"
        ? String((raw.productAttributes as Rec).title)
        : offerId,
    },
    data: raw,
  });
}

function statusRow(product: Rec): Rec {
  const name = typeof product.name === "string" ? product.name : "";
  const productId = name.includes("/products/") ? name.split("/products/")[1] ?? name : name;
  const attrs = product.productAttributes && typeof product.productAttributes === "object"
    ? (product.productAttributes as Rec)
    : {};
  const status = product.productStatus && typeof product.productStatus === "object"
    ? (product.productStatus as Rec)
    : {};
  const issues = Array.isArray(status.itemLevelIssues) ? status.itemLevelIssues : [];
  const destinations = Array.isArray(status.destinationStatuses) ? status.destinationStatuses : [];
  return {
    product_id: productId,
    offer_id: typeof product.offerId === "string" ? product.offerId : null,
    title: typeof attrs.title === "string" ? attrs.title : null,
    feed_label: typeof product.feedLabel === "string" ? product.feedLabel : null,
    content_language: typeof product.contentLanguage === "string" ? product.contentLanguage : null,
    destination_statuses: destinations,
    item_level_issues: issues,
    shopping_ads_ready: destinations.some((d) => {
      if (!d || typeof d !== "object") return false;
      const row = d as Rec;
      const ctx = typeof row.reportingContext === "string" ? row.reportingContext : "";
      const approved = Array.isArray(row.approvedCountries) ? row.approvedCountries : [];
      return ctx === "SHOPPING_ADS" && approved.length > 0;
    }),
  };
}

export async function mcListProductStatuses(ctx: AppContext, args: Rec): Promise<Envelope> {
  const miss = await requireMcHop(ctx, "mc_list_product_statuses");
  if (miss) return miss;
  const merchant = normalizeMerchantId(requireId(args.merchant_id, "merchant_id"));
  const { pageSize, pageToken } = pageArgs(args);
  const raw = (await ctx.httpMc.get(
    HOST,
    `/products/v1/${merchant.name}/products`,
    { pageSize, pageToken },
    meta("mc_list_product_statuses", "merchantapi.googleapis.com/products/v1"),
  )) as Rec;
  const products = Array.isArray(raw.products) ? raw.products : [];
  const statuses = products.map((p) => statusRow(p && typeof p === "object" ? (p as Rec) : {}));
  return okEnvelope("mc_list_product_statuses", {
    resource: merchantResource(merchant),
    data: { product_statuses: statuses },
    page: pageFromList(
      statuses,
      statuses.length,
      typeof raw.nextPageToken === "string" ? raw.nextPageToken : undefined,
    ),
    hint:
      statuses.length === 0
        ? `${HINT_EMPTY_LIST} shopping_ads_ready is true when SHOPPING_ADS has approvedCountries.`
        : "shopping_ads_ready is true when destinationStatuses includes SHOPPING_ADS with approvedCountries. item_level_issues block Shopping ads until fixed in Merchant Center.",
  });
}

export async function mcListAccountIssues(ctx: AppContext, args: Rec): Promise<Envelope> {
  const miss = await requireMcHop(ctx, "mc_list_account_issues");
  if (miss) return miss;
  const merchant = normalizeMerchantId(requireId(args.merchant_id, "merchant_id"));
  const { pageSize, pageToken } = pageArgs(args);
  const languageCode = typeof args.language_code === "string" ? args.language_code : undefined;
  const raw = (await ctx.httpMc.get(
    HOST,
    `/accounts/v1/${merchant.name}/issues`,
    { pageSize, pageToken, languageCode },
    meta("mc_list_account_issues", "merchantapi.googleapis.com/accounts/v1"),
  )) as Rec;
  const issues = Array.isArray(raw.accountIssues) ? raw.accountIssues : [];
  return okEnvelope("mc_list_account_issues", {
    resource: merchantResource(merchant),
    data: { account_issues: issues },
    page: pageFromList(
      issues,
      issues.length,
      typeof raw.nextPageToken === "string" ? raw.nextPageToken : undefined,
    ),
    ...(issues.length === 0
      ? { hint: `${HINT_EMPTY_LIST} No account issues is not an auth failure.` }
      : {
          hint: "Account issues (website, feeds, suspensions) block Shopping ads even when individual products look ready.",
        }),
  });
}

export async function mcListDataSources(ctx: AppContext, args: Rec): Promise<Envelope> {
  const miss = await requireMcHop(ctx, "mc_list_data_sources");
  if (miss) return miss;
  const merchant = normalizeMerchantId(requireId(args.merchant_id, "merchant_id"));
  const { pageSize, pageToken } = pageArgs(args);
  const raw = (await ctx.httpMc.get(
    HOST,
    `/datasources/v1/${merchant.name}/dataSources`,
    { pageSize, pageToken },
    meta("mc_list_data_sources", "merchantapi.googleapis.com/datasources/v1"),
  )) as Rec;
  const dataSources = Array.isArray(raw.dataSources) ? raw.dataSources : [];
  return okEnvelope("mc_list_data_sources", {
    resource: merchantResource(merchant),
    data: { data_sources: dataSources },
    page: pageFromList(
      dataSources,
      dataSources.length,
      typeof raw.nextPageToken === "string" ? raw.nextPageToken : undefined,
    ),
    ...(dataSources.length === 0
      ? { hint: `${HINT_EMPTY_LIST} No data sources means no product feed is configured.` }
      : { hint: "Data sources are Merchant API feeds (primary/supplemental). Pair with mc_list_account_issues and product item_level_issues." }),
  });
}


