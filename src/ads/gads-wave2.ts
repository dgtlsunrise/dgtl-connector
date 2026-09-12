/**
 * Wave 2 named Google Ads graph tools — plugin side.
 * dry_run default; live confirm_phrase with digits-only customer_id.
 * Local campaigns: honest NOT_IMPLEMENTED (Google sunset). Never hops Axos.
 */

import type { AppContext } from "../context.js";
import { failEnvelope, okEnvelope, type Envelope } from "../envelope.js";
import { MSG, ToolError } from "../errors.js";
import { requireId } from "../ids.js";
import {
  ALLOWED_STATUS,
  DEFAULT_MAX_DAILY_BUDGET_MICROS,
  assertBase64Image,
  assertConfirmContainsCustomerId,
  assertHttpsFinalUrl,
  assertHttpsMediaUrl,
  dryRunDefault,
  gateMutateOrFail,
  liveMutateHop,
  normalizeCustomerId,
  optionalLoginCustomerId,
  pmaxImageSlotReady,
  resolvePluginAmountMicros,
} from "./gads-write.js";

function digitsId(raw: unknown, field: string): string {
  return normalizeCustomerId(requireId(raw, field));
}

function optionalStatus(
  tool: string,
  args: Record<string, unknown>,
): { ok: true; status: string } | { ok: false; env: Envelope } {
  const statusRaw =
    typeof args.status === "string" && args.status.trim()
      ? args.status.trim().toUpperCase()
      : "PAUSED";
  if (!ALLOWED_STATUS.has(statusRaw)) {
    return {
      ok: false,
      env: failEnvelope(tool, "INVALID_ARGUMENT", "status must be ENABLED or PAUSED", {
        api: "google_ads",
      }),
    };
  }
  return { ok: true, status: statusRaw };
}

function amountOrFail(
  tool: string,
  args: Record<string, unknown>,
): { ok: true; amount_micros: string; daily_budget_dollars: number } | { ok: false; env: Envelope } {
  const amount = resolvePluginAmountMicros(args);
  if (!amount.ok) {
    return {
      ok: false,
      env: failEnvelope(
        tool,
        "INVALID_ARGUMENT",
        "Provide amount_micros or daily_budget_dollars",
        { api: "google_ads", hint: amount.reason },
      ),
    };
  }
  if (amount.amount_micros_number > DEFAULT_MAX_DAILY_BUDGET_MICROS) {
    return {
      ok: false,
      env: failEnvelope(tool, "SPEND_CAP_EXCEEDED", MSG.SPEND_CAP_EXCEEDED, {
        api: "google_ads",
        hint: `Max daily amount_micros is ${DEFAULT_MAX_DAILY_BUDGET_MICROS} ($100,000).`,
      }),
    };
  }
  return {
    ok: true,
    amount_micros: amount.amount_micros,
    daily_budget_dollars: amount.daily_budget_dollars,
  };
}

async function dryOrHop(
  ctx: AppContext,
  tool: string,
  args: Record<string, unknown>,
  proposed: Record<string, unknown>,
  note: string,
): Promise<Envelope> {
  const customer_id = String(proposed.customer_id);
  if (dryRunDefault(args)) {
    return okEnvelope(tool, {
      resource: {
        type: "gads_customer",
        id: customer_id,
        display_name: String(proposed.campaign_name ?? proposed.name ?? tool),
      },
      data: {
        dry_run: true,
        proposed,
        note,
        spend_cap_micros: DEFAULT_MAX_DAILY_BUDGET_MICROS,
      },
    });
  }
  try {
    assertConfirmContainsCustomerId(args.confirm_phrase, customer_id);
  } catch (err) {
    if (err instanceof ToolError) {
      return failEnvelope(tool, err.error_code, err.message, { ...err.extra, api: "google_ads" });
    }
    throw err;
  }
  return liveMutateHop(ctx, tool, proposed);
}

function copyImageSlots(args: Record<string, unknown>, proposed: Record<string, unknown>): Envelope | null {
  const urlFields = [
    "marketing_image_file_url",
    "square_marketing_image_file_url",
    "logo_file_url",
  ] as const;
  for (const k of urlFields) {
    if (args[k] === undefined || args[k] === null || args[k] === "") continue;
    const u = assertHttpsMediaUrl(args[k], k);
    if (!u.ok) {
      return failEnvelope("gads", "INVALID_ARGUMENT", `${k} must be https://…`, {
        api: "google_ads",
        hint: u.reason,
      });
    }
    proposed[k] = u.url;
  }
  const bytesFields = ["marketing_image_bytes", "square_marketing_image_bytes", "logo_bytes"] as const;
  for (const k of bytesFields) {
    if (args[k] === undefined || args[k] === null || args[k] === "") continue;
    const b = assertBase64Image(args[k]);
    if (!b.ok) {
      return failEnvelope("gads", "INVALID_ARGUMENT", `${k} must be base64 image`, {
        api: "google_ads",
        hint: b.reason,
      });
    }
    proposed[k] = b.bytes;
  }
  for (const k of [
    "marketing_image_asset_resource_names",
    "square_marketing_image_asset_resource_names",
    "logo_asset_resource_names",
  ]) {
    if (args[k] !== undefined) proposed[k] = args[k];
  }
  return null;
}

export async function gadsCreateResponsiveDisplayAd(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "gads_create_responsive_display_ad";
  const miss = gateMutateOrFail(ctx, tool);
  if (miss) return miss;
  const hasMarketing = pmaxImageSlotReady(
    args,
    "marketing_image_asset_resource_names",
    "marketing_image_file_url",
    "marketing_image_bytes",
  );
  const hasSquare = pmaxImageSlotReady(
    args,
    "square_marketing_image_asset_resource_names",
    "square_marketing_image_file_url",
    "square_marketing_image_bytes",
  );
  if (!hasMarketing || !hasSquare) {
    return failEnvelope(tool, "INVALID_ARGUMENT", "RDA needs marketing + square images", {
      api: "google_ads",
      hint: "Call gads_upload_asset or pass marketing_image_file_url / square_marketing_image_file_url (or *_bytes). Zero hop.",
    });
  }
  const customer_id = digitsId(args.customer_id, "customer_id");
  const ad_group_id = digitsId(args.ad_group_id, "ad_group_id");
  const url = assertHttpsFinalUrl(args.final_url);
  if (!url.ok) {
    return failEnvelope(tool, "INVALID_ARGUMENT", "final_url must be https://…", {
      api: "google_ads",
      hint: url.reason,
    });
  }
  const st = optionalStatus(tool, args);
  if (!st.ok) return st.env;
  const long_headline =
    typeof args.long_headline === "string"
      ? args.long_headline.trim()
      : Array.isArray(args.long_headlines)
        ? String(args.long_headlines[0] ?? "").trim()
        : "";
  if (!long_headline) {
    return failEnvelope(tool, "INVALID_ARGUMENT", "long_headline is required (≤90 chars)", {
      api: "google_ads",
    });
  }
  const proposed: Record<string, unknown> = {
    customer_id,
    ad_group_id,
    headlines: args.headlines,
    long_headline,
    descriptions: args.descriptions,
    business_name: args.business_name,
    final_url: url.final_url,
    status: st.status,
  };
  const img = copyImageSlots(args, proposed);
  if (img) return img;
  const login = optionalLoginCustomerId(args);
  if (login) proposed.login_customer_id = login;
  return dryOrHop(
    ctx,
    tool,
    args,
    proposed,
    "No Ads mutate HTTP. Responsive Display Ad defaults PAUSED. Live needs confirm_phrase with customer_id.",
  );
}

export async function gadsAddShoppingListingGroups(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "gads_add_shopping_listing_groups";
  const miss = gateMutateOrFail(ctx, tool);
  if (miss) return miss;
  const customer_id = digitsId(args.customer_id, "customer_id");
  const proposed: Record<string, unknown> = {
    customer_id,
    listing_group_type:
      typeof args.listing_group_type === "string" ? args.listing_group_type : "ALL_PRODUCTS",
  };
  if (typeof args.campaign_id === "string" && args.campaign_id.trim()) {
    proposed.campaign_id = normalizeCustomerId(args.campaign_id);
  }
  if (typeof args.ad_group_id === "string" && args.ad_group_id.trim()) {
    proposed.ad_group_id = normalizeCustomerId(args.ad_group_id);
  }
  if (typeof args.ad_group_name === "string") proposed.ad_group_name = args.ad_group_name;
  if (args.listing_group_values !== undefined) proposed.listing_group_values = args.listing_group_values;
  if (args.brands !== undefined) proposed.brands = args.brands;
  if (args.cpc_bid_micros !== undefined) proposed.cpc_bid_micros = args.cpc_bid_micros;
  const login = optionalLoginCustomerId(args);
  if (login) proposed.login_customer_id = login;
  if (!proposed.ad_group_id && !proposed.campaign_id) {
    return failEnvelope(tool, "INVALID_ARGUMENT", "Provide ad_group_id or campaign_id + ad_group_name", {
      api: "google_ads",
    });
  }
  return dryOrHop(
    ctx,
    tool,
    args,
    proposed,
    "No Ads mutate HTTP. Listing groups are structure (UNIT all-products or brand/item subdivision). Campaign stays PAUSED; new shopping ad group is ENABLED under it.",
  );
}

async function createChannelCampaign(
  ctx: AppContext,
  tool: string,
  args: Record<string, unknown>,
  extra: Record<string, unknown>,
  note: string,
): Promise<Envelope> {
  const miss = gateMutateOrFail(ctx, tool);
  if (miss) return miss;
  const customer_id = digitsId(args.customer_id, "customer_id");
  const campaign_name = requireId(args.campaign_name, "campaign_name").trim();
  const amount = amountOrFail(tool, args);
  if (!amount.ok) return amount.env;
  const st = optionalStatus(tool, args);
  if (!st.ok) return st.env;
  const proposed: Record<string, unknown> = {
    customer_id,
    campaign_name,
    amount_micros: amount.amount_micros,
    daily_budget_dollars: amount.daily_budget_dollars,
    status: st.status,
    ...extra,
  };
  if (typeof args.ad_group_name === "string") proposed.ad_group_name = args.ad_group_name;
  const login = optionalLoginCustomerId(args);
  if (login) proposed.login_customer_id = login;
  return dryOrHop(ctx, tool, args, proposed, note);
}

export async function gadsCreateVideoCampaign(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const extra: Record<string, unknown> = { advertising_channel_type: "VIDEO" };
  if (typeof args.youtube_video_id === "string") extra.youtube_video_id = args.youtube_video_id.trim();
  if (args.headlines) extra.headlines = args.headlines;
  if (args.long_headlines) extra.long_headlines = args.long_headlines;
  if (args.descriptions) extra.descriptions = args.descriptions;
  if (typeof args.final_url === "string") {
    const url = assertHttpsFinalUrl(args.final_url);
    if (!url.ok) {
      return failEnvelope("gads_create_video_campaign", "INVALID_ARGUMENT", "final_url must be https://…", {
        api: "google_ads",
        hint: url.reason,
      });
    }
    extra.final_url = url.final_url;
  }
  return createChannelCampaign(
    ctx,
    "gads_create_video_campaign",
    args,
    extra,
    "No Ads mutate HTTP. VIDEO campaign defaults PAUSED; child VIDEO_RESPONSIVE ad group ENABLED. Optional YouTube video ad defaults PAUSED.",
  );
}

export async function gadsCreateDemandGenCampaign(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const extra: Record<string, unknown> = { advertising_channel_type: "DEMAND_GEN" };
  if (args.headlines) extra.headlines = args.headlines;
  if (args.descriptions) extra.descriptions = args.descriptions;
  if (args.business_name) extra.business_name = args.business_name;
  if (typeof args.final_url === "string") {
    const url = assertHttpsFinalUrl(args.final_url);
    if (!url.ok) {
      return failEnvelope("gads_create_demand_gen_campaign", "INVALID_ARGUMENT", "final_url must be https://…", {
        api: "google_ads",
        hint: url.reason,
      });
    }
    extra.final_url = url.final_url;
  }
  const img = copyImageSlots(args, extra);
  if (img) return img;
  return createChannelCampaign(
    ctx,
    "gads_create_demand_gen_campaign",
    args,
    extra,
    "No Ads mutate HTTP. DEMAND_GEN campaign defaults PAUSED. Optional multi-asset ad when images are supplied.",
  );
}

export async function gadsCreateAppCampaign(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const app_id = requireId(args.app_id, "app_id").trim();
  const app_store =
    typeof args.app_store === "string" && args.app_store.trim()
      ? args.app_store.trim().toUpperCase()
      : "GOOGLE_APP_STORE";
  const extra: Record<string, unknown> = {
    advertising_channel_type: "MULTI_CHANNEL",
    app_id,
    app_store,
  };
  if (args.target_cpa_micros !== undefined) extra.target_cpa_micros = args.target_cpa_micros;
  return createChannelCampaign(
    ctx,
    "gads_create_app_campaign",
    args,
    extra,
    "No Ads mutate HTTP. App campaign (MULTI_CHANNEL / APP_CAMPAIGN) defaults PAUSED. Google generates ads; no traditional ad group.",
  );
}

export async function gadsCreateHotelCampaign(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const hotel = args.hotel_center_id;
  if (hotel === undefined || hotel === null || hotel === "") {
    return failEnvelope(
      "gads_create_hotel_campaign",
      "INVALID_ARGUMENT",
      "Hotel create needs hotel_center_id",
      { api: "google_ads", hint: "Pass digits-only hotel_center_id. Zero hop." },
    );
  }
  return createChannelCampaign(
    ctx,
    "gads_create_hotel_campaign",
    args,
    { advertising_channel_type: "HOTEL", hotel_center_id: String(hotel).trim() },
    "No Ads mutate HTTP. HOTEL campaign defaults PAUSED; child HOTELS_ADS ad group ENABLED.",
  );
}

export async function gadsCreateLocalCampaign(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "gads_create_local_campaign";
  const miss = gateMutateOrFail(ctx, tool);
  if (miss) return miss;
  void args;
  return failEnvelope(
    tool,
    "NOT_IMPLEMENTED",
    "Google sunset Local campaigns; create Performance Max instead.",
    {
      api: "google_ads",
      hint: "advertisingChannelType LOCAL is not available for new creates. Use gads_create_performance_max_campaign. Zero hop.",
    },
  );
}

export async function gadsAddNegativeKeywords(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "gads_add_negative_keywords";
  const miss = gateMutateOrFail(ctx, tool);
  if (miss) return miss;
  const customer_id = digitsId(args.customer_id, "customer_id");
  const st = optionalStatus(tool, args);
  if (!st.ok) return st.env;
  const proposed: Record<string, unknown> = {
    customer_id,
    keywords: args.keywords,
    status: st.status,
  };
  if (typeof args.campaign_id === "string" && args.campaign_id.trim()) {
    proposed.campaign_id = normalizeCustomerId(args.campaign_id);
  }
  if (typeof args.ad_group_id === "string" && args.ad_group_id.trim()) {
    proposed.ad_group_id = normalizeCustomerId(args.ad_group_id);
  }
  const login = optionalLoginCustomerId(args);
  if (login) proposed.login_customer_id = login;
  return dryOrHop(
    ctx,
    tool,
    args,
    proposed,
    "No Ads mutate HTTP. Standalone negative keywords default PAUSED (same as keyword add). ENABLED only with explicit status + confirm.",
  );
}

export async function gadsAttachAudience(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "gads_attach_audience";
  const miss = gateMutateOrFail(ctx, tool);
  if (miss) return miss;
  const customer_id = digitsId(args.customer_id, "customer_id");
  const audience_resource_name = requireId(args.audience_resource_name, "audience_resource_name").trim();
  const st = optionalStatus(tool, args);
  if (!st.ok) return st.env;
  const proposed: Record<string, unknown> = {
    customer_id,
    audience_resource_name,
    status: st.status,
  };
  if (typeof args.campaign_id === "string" && args.campaign_id.trim()) {
    proposed.campaign_id = normalizeCustomerId(args.campaign_id);
  }
  if (typeof args.ad_group_id === "string" && args.ad_group_id.trim()) {
    proposed.ad_group_id = normalizeCustomerId(args.ad_group_id);
  }
  const login = optionalLoginCustomerId(args);
  if (login) proposed.login_customer_id = login;
  return dryOrHop(
    ctx,
    tool,
    args,
    proposed,
    "No Ads mutate HTTP. Audience criterion defaults PAUSED. Cite audience_resource_name from gads_search recipe=audiences.",
  );
}

export async function gadsAddGeoTargets(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "gads_add_geo_targets";
  const miss = gateMutateOrFail(ctx, tool);
  if (miss) return miss;
  const customer_id = digitsId(args.customer_id, "customer_id");
  const campaign_id = digitsId(args.campaign_id, "campaign_id");
  const st = optionalStatus(tool, args);
  if (!st.ok) return st.env;
  const proposed: Record<string, unknown> = {
    customer_id,
    campaign_id,
    geo_target_constant_ids: args.geo_target_constant_ids,
    status: st.status,
  };
  if (args.negative === true) proposed.negative = true;
  const login = optionalLoginCustomerId(args);
  if (login) proposed.login_customer_id = login;
  return dryOrHop(
    ctx,
    tool,
    args,
    proposed,
    "No Ads mutate HTTP. Geo criteria default PAUSED. Pass geo_target_constant_ids from gads_search recipe=geo.",
  );
}

export async function gadsAddLanguages(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "gads_add_languages";
  const miss = gateMutateOrFail(ctx, tool);
  if (miss) return miss;
  const customer_id = digitsId(args.customer_id, "customer_id");
  const campaign_id = digitsId(args.campaign_id, "campaign_id");
  const st = optionalStatus(tool, args);
  if (!st.ok) return st.env;
  const proposed: Record<string, unknown> = {
    customer_id,
    campaign_id,
    language_constant_ids: args.language_constant_ids ?? args.language_ids,
    status: st.status,
  };
  const login = optionalLoginCustomerId(args);
  if (login) proposed.login_customer_id = login;
  return dryOrHop(ctx, tool, args, proposed, "No Ads mutate HTTP. Language criteria default PAUSED.");
}

export async function gadsAddDemographics(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "gads_add_demographics";
  const miss = gateMutateOrFail(ctx, tool);
  if (miss) return miss;
  const customer_id = digitsId(args.customer_id, "customer_id");
  const ad_group_id = digitsId(args.ad_group_id, "ad_group_id");
  const st = optionalStatus(tool, args);
  if (!st.ok) return st.env;
  const proposed: Record<string, unknown> = {
    customer_id,
    ad_group_id,
    status: st.status,
  };
  for (const k of ["age_ranges", "genders", "parental_statuses", "income_ranges"] as const) {
    if (args[k] !== undefined) proposed[k] = args[k];
  }
  const login = optionalLoginCustomerId(args);
  if (login) proposed.login_customer_id = login;
  return dryOrHop(
    ctx,
    tool,
    args,
    proposed,
    "No Ads mutate HTTP. Demographic criteria default PAUSED. Closed enums only (age/gender/parental/income).",
  );
}

export async function gadsSetAdSchedule(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "gads_set_ad_schedule";
  const miss = gateMutateOrFail(ctx, tool);
  if (miss) return miss;
  const customer_id = digitsId(args.customer_id, "customer_id");
  const campaign_id = digitsId(args.campaign_id, "campaign_id");
  const st = optionalStatus(tool, args);
  if (!st.ok) return st.env;
  const proposed: Record<string, unknown> = {
    customer_id,
    campaign_id,
    schedules: args.schedules,
    status: st.status,
  };
  const login = optionalLoginCustomerId(args);
  if (login) proposed.login_customer_id = login;
  return dryOrHop(ctx, tool, args, proposed, "No Ads mutate HTTP. Ad-schedule criteria default PAUSED.");
}

export async function gadsSetCampaignBidStrategy(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "gads_set_campaign_bid_strategy";
  const miss = gateMutateOrFail(ctx, tool);
  if (miss) return miss;
  const customer_id = digitsId(args.customer_id, "customer_id");
  const campaign_id = digitsId(args.campaign_id, "campaign_id");
  const proposed: Record<string, unknown> = { customer_id, campaign_id };
  for (const k of [
    "bid_strategy_type",
    "target_cpa_micros",
    "target_roas",
    "target_cpm_micros",
    "cpc_bid_ceiling_micros",
    "location",
    "location_fraction_micros",
    "bidding_strategy_resource_name",
  ] as const) {
    if (args[k] !== undefined) proposed[k] = args[k];
  }
  const login = optionalLoginCustomerId(args);
  if (login) proposed.login_customer_id = login;
  return dryOrHop(
    ctx,
    tool,
    args,
    proposed,
    "No Ads mutate HTTP. Closed-enum bid strategies only (no invent). Portfolio via bidding_strategy_resource_name.",
  );
}

export async function gadsCreateSharedBudget(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "gads_create_shared_budget";
  const miss = gateMutateOrFail(ctx, tool);
  if (miss) return miss;
  const customer_id = digitsId(args.customer_id, "customer_id");
  const name = requireId(args.name ?? args.campaign_name, "name").trim();
  const amount = amountOrFail(tool, args);
  if (!amount.ok) return amount.env;
  const proposed: Record<string, unknown> = {
    customer_id,
    name,
    amount_micros: amount.amount_micros,
    daily_budget_dollars: amount.daily_budget_dollars,
  };
  const login = optionalLoginCustomerId(args);
  if (login) proposed.login_customer_id = login;
  return dryOrHop(ctx, tool, args, proposed, "No Ads mutate HTTP. Shared campaign budget (explicitlyShared=true). Spend-capped.");
}

export async function gadsCreatePortfolioBiddingStrategy(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "gads_create_portfolio_bidding_strategy";
  const miss = gateMutateOrFail(ctx, tool);
  if (miss) return miss;
  const customer_id = digitsId(args.customer_id, "customer_id");
  const name = requireId(args.name ?? args.bidding_strategy_name, "name").trim();
  const proposed: Record<string, unknown> = {
    customer_id,
    name,
    bid_strategy_type: args.bid_strategy_type ?? "TARGET_CPA",
  };
  for (const k of ["target_cpa_micros", "target_roas", "cpc_bid_ceiling_micros", "target_cpm_micros"] as const) {
    if (args[k] !== undefined) proposed[k] = args[k];
  }
  const login = optionalLoginCustomerId(args);
  if (login) proposed.login_customer_id = login;
  return dryOrHop(ctx, tool, args, proposed, "No Ads mutate HTTP. Portfolio bidding strategy (closed enum). Attach with gads_set_campaign_bid_strategy.");
}

export async function gadsCreateConversionAction(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "gads_create_conversion_action";
  const miss = gateMutateOrFail(ctx, tool);
  if (miss) return miss;
  const customer_id = digitsId(args.customer_id, "customer_id");
  const name = requireId(args.name ?? args.conversion_action_name, "name").trim();
  const proposed: Record<string, unknown> = {
    customer_id,
    name,
    conversion_action_type: args.conversion_action_type ?? "WEBPAGE",
    conversion_category: args.conversion_category ?? "DEFAULT",
  };
  if (args.default_value !== undefined) proposed.default_value = args.default_value;
  const login = optionalLoginCustomerId(args);
  if (login) proposed.login_customer_id = login;
  return dryOrHop(
    ctx,
    tool,
    args,
    proposed,
    "No Ads mutate HTTP. Conversion action tracking (does not spend). Status ENABLED is Google’s tracking default.",
  );
}

export async function gadsApplyRecommendation(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "gads_apply_recommendation";
  const miss = gateMutateOrFail(ctx, tool);
  if (miss) return miss;
  const customer_id = digitsId(args.customer_id, "customer_id");
  const proposed: Record<string, unknown> = { customer_id };
  if (typeof args.recommendation_resource_name === "string") {
    proposed.recommendation_resource_name = args.recommendation_resource_name.trim();
  } else {
    proposed.recommendation_id = requireId(args.recommendation_id, "recommendation_id");
  }
  const login = optionalLoginCustomerId(args);
  if (login) proposed.login_customer_id = login;
  return dryOrHop(
    ctx,
    tool,
    args,
    proposed,
    "No Ads mutate HTTP. Applies a recommendation from gads_search recipe=recommendations. Confirm-gated.",
  );
}

export async function gadsLinkMerchantCenter(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "gads_link_merchant_center";
  const miss = gateMutateOrFail(ctx, tool);
  if (miss) return miss;
  const mc = args.merchant_center_id;
  if (mc === undefined || mc === null || mc === "") {
    return failEnvelope(tool, "MERCHANT_CENTER_REQUIRED", MSG.MERCHANT_CENTER_REQUIRED, {
      api: "google_ads",
      hint: "Call gads_list_merchant_center_links first. Zero hop.",
    });
  }
  const customer_id = digitsId(args.customer_id, "customer_id");
  const proposed: Record<string, unknown> = {
    customer_id,
    merchant_center_id: String(mc).trim(),
  };
  const login = optionalLoginCustomerId(args);
  if (login) proposed.login_customer_id = login;
  return dryOrHop(
    ctx,
    tool,
    args,
    proposed,
    "No Ads mutate HTTP. ProductLink create for Merchant Center (not MCC link). Confirm-gated.",
  );
}

export async function gadsUnlinkMerchantCenter(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "gads_unlink_merchant_center";
  const miss = gateMutateOrFail(ctx, tool);
  if (miss) return miss;
  const customer_id = digitsId(args.customer_id, "customer_id");
  const proposed: Record<string, unknown> = { customer_id };
  if (typeof args.product_link_resource_name === "string") {
    proposed.product_link_resource_name = args.product_link_resource_name.trim();
  } else {
    proposed.product_link_id = requireId(args.product_link_id, "product_link_id");
  }
  const login = optionalLoginCustomerId(args);
  if (login) proposed.login_customer_id = login;
  return dryOrHop(ctx, tool, args, proposed, "No Ads mutate HTTP. ProductLink remove. Confirm-gated.");
}

export async function gadsCreateExperiment(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "gads_create_experiment";
  const miss = gateMutateOrFail(ctx, tool);
  if (miss) return miss;
  const customer_id = digitsId(args.customer_id, "customer_id");
  const campaign_id = digitsId(args.campaign_id, "campaign_id");
  const name = requireId(args.name ?? args.experiment_name, "name").trim();
  const proposed: Record<string, unknown> = {
    customer_id,
    campaign_id,
    name,
    experiment_type: args.experiment_type ?? "SEARCH_CUSTOM",
  };
  if (args.traffic_split_percent !== undefined) proposed.traffic_split_percent = args.traffic_split_percent;
  const login = optionalLoginCustomerId(args);
  if (login) proposed.login_customer_id = login;
  return dryOrHop(
    ctx,
    tool,
    args,
    proposed,
    "No Ads mutate HTTP. Experiment created in SETUP (not live). Control arm on existing campaign; treatment in-design.",
  );
}
