/**
 * Merchant Center writes — Merchant API ProductInput + API data sources.
 *
 * Wave 14: Consent MC (`content`) is already write-capable. Reads stay GET-only
 * on GoogleHttp. Writes use GoogleMcWriteHttp. Polar JWT `ads` (no separate mc
 * bit). Never Consent A. Never stamp. Write ProductInput with dataSource, not
 * processed Product.
 */
import type { AppContext } from "../context.js";
import { failEnvelope, okEnvelope, type Envelope } from "../envelope.js";
import { MSG, ToolError } from "../errors.js";
import {
  normalizeMcDataSource,
  normalizeMcProductId,
  normalizeMerchantId,
  requireId,
} from "../ids.js";
import { APIS, SCOPE } from "./scopes.js";
import { requireMcHop, requireMcLicense } from "./mc.js";

const HOST = APIS.merchant;
const SCOPE_CONTENT = SCOPE.content;

const HINT_FLAG =
  "Set DGTL_WRITES_ENABLED=true for live Merchant API ProductInput / data-source writes. Consent MC (content) is already write-capable — never add it to Consent A. Prefer dry_run first.";

const HINT_CONFIRM =
  "Prefer dry_run first. Live mutate needs confirm_phrase containing this merchant_id (digits). List-tool output is not the user message.";

type Rec = Record<string, unknown>;

const AVAILABILITY = ["IN_STOCK", "OUT_OF_STOCK", "PREORDER", "BACKORDER"] as const;
const CONDITION = ["NEW", "USED", "REFURBISHED"] as const;
const CHANNELS = ["ONLINE_PRODUCTS"] as const;
const SOURCE_KINDS = ["primary", "supplemental"] as const;

type Channel = (typeof CHANNELS)[number];
type SourceKind = (typeof SOURCE_KINDS)[number];

const ATTR_CAMEL: Record<string, string> = {
  title: "title",
  description: "description",
  link: "link",
  image_link: "imageLink",
  imagelink: "imageLink",
  availability: "availability",
  condition: "condition",
  price: "price",
  brand: "brand",
  gtin: "gtin",
  mpn: "mpn",
  google_product_category: "googleProductCategory",
  googleproductcategory: "googleProductCategory",
};

function dryRunDefault(args: Rec): boolean {
  return args.dry_run !== false;
}

function confirmPhrase(args: Rec): unknown {
  if (typeof args.confirm_phrase === "string") return args.confirm_phrase;
  return args.confirm;
}

function wMeta(tool: string, query?: Record<string, string | number | undefined>) {
  return { requiredScope: SCOPE_CONTENT, tool, query };
}

function merchantResource(merchant: { id: string; name: string }) {
  return { type: "mc_account", id: merchant.id, display_name: merchant.name };
}

function assertConfirmContainsMerchant(confirm: unknown, merchantId: string): void {
  const phrase = typeof confirm === "string" ? confirm : "";
  if (!phrase.includes(merchantId)) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      `Live Merchant Center mutate requires confirm_phrase that includes merchant_id ${JSON.stringify(merchantId)}. Constant phrases without that merchant_id are not accepted.`,
      { hint: HINT_CONFIRM, resource_id: merchantId, api: HOST },
    );
  }
}

function dataSourceRaw(args: Rec): string {
  if (typeof args.data_source === "string" && args.data_source.trim()) return args.data_source;
  if (typeof args.dataSource === "string" && args.dataSource.trim()) return args.dataSource;
  return requireId(undefined, "data_source");
}

function refuseFileInput(args: Rec): void {
  const banned = ["file_input", "fileInput", "file_name", "fileName", "fetch_url", "fetchUrl"];
  for (const key of banned) {
    if (args[key] !== undefined && args[key] !== null && args[key] !== "") {
      throw new ToolError(
        "INVALID_ARGUMENT",
        "mc_create_data_source creates API-type data sources only (no fileInput / fetch URL). Use mc_fetch_data_source for an existing FILE source.",
        { api: HOST },
      );
    }
  }
}

function closedEnum<T extends string>(
  raw: unknown,
  field: string,
  allowed: readonly T[],
  fallback?: T,
): T | undefined {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const upper = String(raw).trim().toUpperCase();
  const hit = allowed.find((a) => a === upper);
  if (!hit) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      `${field} must be one of: ${allowed.join(", ")}`,
      { api: HOST, resource_id: field },
    );
  }
  return hit;
}

function assertHttpsUrl(value: string, field: string): void {
  if (!value.startsWith("https://")) {
    throw new ToolError("INVALID_ARGUMENT", `${field} must be an https URL`, {
      api: HOST,
      resource_id: field,
    });
  }
}

function productAttributesFromArgs(args: Rec): Rec | undefined {
  const out: Rec = {};
  if (typeof args.title === "string" && args.title.trim()) out.title = args.title.trim();
  if (typeof args.description === "string" && args.description.trim()) {
    out.description = args.description.trim();
  }
  if (typeof args.link === "string" && args.link.trim()) {
    assertHttpsUrl(args.link.trim(), "link");
    out.link = args.link.trim();
  }
  if (typeof args.image_link === "string" && args.image_link.trim()) {
    assertHttpsUrl(args.image_link.trim(), "image_link");
    out.imageLink = args.image_link.trim();
  }
  const availability = closedEnum(args.availability, "availability", AVAILABILITY);
  if (availability) out.availability = availability;
  const condition = closedEnum(args.condition, "condition", CONDITION);
  if (condition) out.condition = condition;
  if (args.price_micros !== undefined && args.price_micros !== null && args.price_micros !== "") {
    const micros = String(args.price_micros).trim();
    if (!/^[0-9]+$/.test(micros)) {
      throw new ToolError("INVALID_ARGUMENT", "price_micros must be a non-negative integer (string or number)", {
        api: HOST,
      });
    }
    const currency =
      typeof args.currency === "string" && args.currency.trim()
        ? args.currency.trim().toUpperCase()
        : requireId(undefined, "currency");
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new ToolError("INVALID_ARGUMENT", "currency must be a 3-letter ISO code (e.g. USD)", {
        api: HOST,
      });
    }
    out.price = { amountMicros: micros, currencyCode: currency };
  }
  if (typeof args.brand === "string" && args.brand.trim()) out.brand = args.brand.trim();
  if (typeof args.gtin === "string" && args.gtin.trim()) out.gtin = args.gtin.trim();
  if (typeof args.mpn === "string" && args.mpn.trim()) out.mpn = args.mpn.trim();
  if (typeof args.google_product_category === "string" && args.google_product_category.trim()) {
    out.googleProductCategory = args.google_product_category.trim();
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function mapUpdateMask(raw: string): string {
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    throw new ToolError("INVALID_ARGUMENT", "update_mask must list one or more product attribute fields", {
      api: HOST,
    });
  }
  return parts
    .map((field) => {
      const stripped = field
        .replace(/^productAttributes\./, "")
        .replace(/^product_attributes\./, "")
        .replace(/^productattributes\./i, "");
      const key = stripped.toLowerCase();
      const camel = ATTR_CAMEL[key] ?? ATTR_CAMEL[stripped];
      if (!camel) {
        throw new ToolError(
          "INVALID_ARGUMENT",
          `update_mask field ${JSON.stringify(field)} is not in the closed ProductInput attribute set`,
          { api: HOST },
        );
      }
      return `productAttributes.${camel}`;
    })
    .join(",");
}

function offerTriple(args: Rec): { offerId: string; contentLanguage: string; feedLabel: string; productId: string } {
  if (typeof args.product_id === "string" && args.product_id.trim()) {
    const productId = normalizeMcProductId(args.product_id);
    const parts = productId.split("~");
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
      throw new ToolError(
        "INVALID_ARGUMENT",
        "product_id must be contentLanguage~feedLabel~offerId. Legacy local~… ProductInputs are not in this wave.",
        { api: HOST, resource_id: productId },
      );
    }
    return {
      contentLanguage: parts[0],
      feedLabel: parts[1],
      offerId: parts[2],
      productId,
    };
  }
  const offerId = requireId(args.offer_id, "offer_id");
  const contentLanguage = requireId(args.content_language, "content_language");
  const feedLabel = requireId(args.feed_label, "feed_label");
  if (offerId.includes("/") || offerId.includes("~") || offerId.includes("%")) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      "offer_id must not contain /, %, or ~. Use a simple SKU; product_id is contentLanguage~feedLabel~offerId.",
      { api: HOST, resource_id: offerId },
    );
  }
  return {
    offerId,
    contentLanguage,
    feedLabel,
    productId: `${contentLanguage}~${feedLabel}~${offerId}`,
  };
}

async function gateLiveWrite(ctx: AppContext, tool: string): Promise<Envelope | null> {
  if (!ctx.flags.writesEnabled) {
    return failEnvelope(tool, "WRITE_NOT_ENABLED", MSG.WRITE_NOT_ENABLED, {
      hint: HINT_FLAG,
      api: HOST,
    });
  }
  return requireMcHop(ctx, tool);
}

function sourceKind(args: Rec): SourceKind {
  const raw = typeof args.kind === "string" ? args.kind.trim().toLowerCase() : "primary";
  if (raw === "primary" || raw === "supplemental") return raw;
  throw new ToolError("INVALID_ARGUMENT", "kind must be primary or supplemental (API data source only)", {
    api: HOST,
  });
}

function countriesFromArgs(args: Rec): string[] | undefined {
  if (args.countries === undefined || args.countries === null || args.countries === "") return undefined;
  const list = Array.isArray(args.countries) ? args.countries : [args.countries];
  const out: string[] = [];
  for (const item of list) {
    const code = String(item).trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) {
      throw new ToolError("INVALID_ARGUMENT", "countries must be ISO-3166 alpha-2 codes (e.g. US)", {
        api: HOST,
      });
    }
    out.push(code);
  }
  return out.length > 0 ? out : undefined;
}

function dataSourceBody(args: Rec, kind: SourceKind): Rec {
  refuseFileInput(args);
  const displayName = requireId(args.display_name, "display_name");
  const body: Rec = { displayName };
  switch (kind) {
    case "primary": {
      const channel = closedEnum(args.channel, "channel", CHANNELS, "ONLINE_PRODUCTS") as Channel;
      const primary: Rec = { channel };
      if (typeof args.feed_label === "string" && args.feed_label.trim()) {
        primary.feedLabel = args.feed_label.trim();
      }
      if (typeof args.content_language === "string" && args.content_language.trim()) {
        primary.contentLanguage = args.content_language.trim();
      }
      const countries = countriesFromArgs(args);
      if (countries) primary.countries = countries;
      body.primaryProductDataSource = primary;
      break;
    }
    case "supplemental": {
      body.supplementalProductDataSource = {};
      break;
    }
    default: {
      const _never: never = kind;
      throw new ToolError("INVALID_ARGUMENT", `Unhandled data source kind ${String(_never)}`, {
        api: HOST,
      });
    }
  }
  return body;
}

export async function mcCreateDataSource(ctx: AppContext, args: Rec): Promise<Envelope> {
  const tool = "mc_create_data_source";
  const merchant = normalizeMerchantId(requireId(args.merchant_id, "merchant_id"));
  const kind = sourceKind(args);
  const proposed = dataSourceBody(args, kind);
  const lic = await requireMcLicense(ctx, tool);
  if (lic) return lic;
  const path = `/datasources/v1/${merchant.name}/dataSources`;
  if (dryRunDefault(args)) {
    return okEnvelope(tool, {
      resource: merchantResource(merchant),
      data: {
        dry_run: true,
        merchant_id: merchant.id,
        method: "POST",
        path,
        data_source: proposed,
        note: `No Google mutate. Pass dry_run=false with confirm_phrase containing ${JSON.stringify(merchant.id)} only after a user message this turn that includes it. API-type only — ProductInput writes need this dataSource name.`,
      },
    });
  }
  const live = await gateLiveWrite(ctx, tool);
  if (live) return live;
  assertConfirmContainsMerchant(confirmPhrase(args), merchant.id);
  const created = (await ctx.httpMcWrite.post(path, proposed, wMeta(tool))) as Rec;
  return okEnvelope(tool, {
    resource: merchantResource(merchant),
    data: { dry_run: false, merchant_id: merchant.id, data_source: created },
  });
}

export async function mcFetchDataSource(ctx: AppContext, args: Rec): Promise<Envelope> {
  const tool = "mc_fetch_data_source";
  const merchant = normalizeMerchantId(requireId(args.merchant_id, "merchant_id"));
  const ds = normalizeMcDataSource(dataSourceRaw(args), merchant.id);
  const lic = await requireMcLicense(ctx, tool);
  if (lic) return lic;
  const path = `/datasources/v1/${merchant.name}/dataSources/${ds.id}:fetch`;
  if (dryRunDefault(args)) {
    return okEnvelope(tool, {
      resource: merchantResource(merchant),
      data: {
        dry_run: true,
        merchant_id: merchant.id,
        data_source: ds.name,
        method: "POST",
        path,
        note: `No Google mutate. Fetch is for FILE data sources. Pass dry_run=false with confirm_phrase containing ${JSON.stringify(merchant.id)}.`,
      },
    });
  }
  const live = await gateLiveWrite(ctx, tool);
  if (live) return live;
  assertConfirmContainsMerchant(confirmPhrase(args), merchant.id);
  const raw = await ctx.httpMcWrite.post(path, {}, wMeta(tool));
  return okEnvelope(tool, {
    resource: merchantResource(merchant),
    data: { dry_run: false, merchant_id: merchant.id, data_source: ds.name, fetched: true, result: raw ?? {} },
  });
}

export async function mcUpsertProductInput(ctx: AppContext, args: Rec): Promise<Envelope> {
  const tool = "mc_upsert_product_input";
  const merchant = normalizeMerchantId(requireId(args.merchant_id, "merchant_id"));
  const ds = normalizeMcDataSource(dataSourceRaw(args), merchant.id);
  const updateMaskRaw = typeof args.update_mask === "string" ? args.update_mask.trim() : "";
  const mode = updateMaskRaw ? "patch" : "insert";
  const triple = offerTriple(args);
  const attrs = productAttributesFromArgs(args);
  const lic = await requireMcLicense(ctx, tool);
  if (lic) return lic;

  if (mode === "insert") {
    const path = `/products/v1/${merchant.name}/productInputs:insert`;
    const body: Rec = {
      offerId: triple.offerId,
      contentLanguage: triple.contentLanguage,
      feedLabel: triple.feedLabel,
      ...(attrs ? { productAttributes: attrs } : {}),
    };
    if (dryRunDefault(args)) {
      return okEnvelope(tool, {
        resource: merchantResource(merchant),
        data: {
          dry_run: true,
          merchant_id: merchant.id,
          data_source: ds.name,
          method: "POST",
          path,
          product_input: body,
          note: `No Google mutate. Writes ProductInput (not processed Product) into dataSource ${ds.name}. Pass dry_run=false with confirm_phrase containing ${JSON.stringify(merchant.id)}.`,
        },
      });
    }
    const live = await gateLiveWrite(ctx, tool);
    if (live) return live;
    assertConfirmContainsMerchant(confirmPhrase(args), merchant.id);
    const created = await ctx.httpMcWrite.post(path, body, wMeta(tool, { dataSource: ds.name }));
    return okEnvelope(tool, {
      resource: { type: "mc_product_input", id: triple.productId, display_name: triple.offerId },
      data: { dry_run: false, merchant_id: merchant.id, data_source: ds.name, product_input: created },
    });
  }

  const mask = mapUpdateMask(updateMaskRaw);
  const path = `/products/v1/${merchant.name}/productInputs/${triple.productId}`;
  const body: Rec = {
    name: `${merchant.name}/productInputs/${triple.productId}`,
    ...(attrs ? { productAttributes: attrs } : {}),
  };
  if (dryRunDefault(args)) {
    return okEnvelope(tool, {
      resource: merchantResource(merchant),
      data: {
        dry_run: true,
        merchant_id: merchant.id,
        data_source: ds.name,
        method: "PATCH",
        path,
        update_mask: mask,
        product_input: body,
        note: `No Google mutate. Patch ProductInput (not processed Product). Pass dry_run=false with confirm_phrase containing ${JSON.stringify(merchant.id)}.`,
      },
    });
  }
  const live = await gateLiveWrite(ctx, tool);
  if (live) return live;
  assertConfirmContainsMerchant(confirmPhrase(args), merchant.id);
  const patched = await ctx.httpMcWrite.patch(
    path,
    body,
    wMeta(tool, { dataSource: ds.name, updateMask: mask }),
  );
  return okEnvelope(tool, {
    resource: { type: "mc_product_input", id: triple.productId, display_name: triple.offerId },
    data: { dry_run: false, merchant_id: merchant.id, data_source: ds.name, product_input: patched },
  });
}

export async function mcDeleteProductInput(ctx: AppContext, args: Rec): Promise<Envelope> {
  const tool = "mc_delete_product_input";
  const merchant = normalizeMerchantId(requireId(args.merchant_id, "merchant_id"));
  const ds = normalizeMcDataSource(dataSourceRaw(args), merchant.id);
  const productId = normalizeMcProductId(requireId(args.product_id, "product_id"));
  const lic = await requireMcLicense(ctx, tool);
  if (lic) return lic;
  const path = `/products/v1/${merchant.name}/productInputs/${productId}`;
  if (dryRunDefault(args)) {
    return okEnvelope(tool, {
      resource: merchantResource(merchant),
      data: {
        dry_run: true,
        merchant_id: merchant.id,
        data_source: ds.name,
        product_id: productId,
        method: "DELETE",
        path,
        note: `No Google mutate. Deletes a ProductInput from dataSource ${ds.name}, not a processed Product GET. Pass dry_run=false with confirm_phrase containing ${JSON.stringify(merchant.id)}.`,
      },
    });
  }
  const live = await gateLiveWrite(ctx, tool);
  if (live) return live;
  assertConfirmContainsMerchant(confirmPhrase(args), merchant.id);
  await ctx.httpMcWrite.delete(path, wMeta(tool, { dataSource: ds.name }));
  return okEnvelope(tool, {
    resource: { type: "mc_product_input", id: productId, display_name: productId },
    data: { dry_run: false, merchant_id: merchant.id, data_source: ds.name, deleted: true, product_id: productId },
  });
}
