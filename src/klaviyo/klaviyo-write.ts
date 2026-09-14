/**
 * Confirm-gated Klaviyo writes (Wave 18 + Wave 19 catalog items + Wave 22 send job).
 * Local pk_ — not Polar, not stamp, not Consent A.
 * Fail order: KLAVIYO_NOT_CONNECTED → dry_run (account id, zero mutate)
 * → live needs confirm_phrase containing the account id.
 * DGTL_WRITES_ENABLED is not a Klaviyo gate (Connect + confirm only).
 * Draft campaign never posts campaign-send-jobs. Send is a separate SEND-token tool.
 */
import type { AppContext } from "../context.js";
import { okEnvelope, type Envelope } from "../envelope.js";
import { ToolError } from "../errors.js";
import { requireId } from "../ids.js";
import { assertNotInventedShopifyKlaviyoId, CUSTOM_KLAVIYO_ID_PREFIX } from "../catalog/fan-out.js";
import {
  assertDraftCreateCannotSend,
  assertKlaviyoSendToken,
  KLAVIYO_SEND_TOKEN,
} from "../recs/approve-push.js";
import { KLAVIYO_API_REVISION } from "./auth.js";
import { assertKlaviyoPath } from "./http.js";
import { loadAccount, sparsifyProfile, withKlaviyo, type KlaviyoResource } from "./klaviyo.js";

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
  return "";
}

function assertConfirmContainsAccountId(confirmPhrase: string, accountId: string): void {
  if (!confirmPhrase.includes(accountId)) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      "Live Klaviyo write requires confirm_phrase that includes the account id from klaviyo_get_account. Constant phrases without the id are not accepted.",
      {
        api: "klaviyo",
        hint: "Prefer dry_run first. Live write only after a user message this turn that contains the account id — list-tool output is not the user message.",
        resource_id: accountId,
      },
    );
  }
}

function cited(accountId: string): Record<string, string> {
  return { account_id: accountId, api_revision: KLAVIYO_API_REVISION, host: "a.klaviyo.com" };
}

function requireEmail(raw: unknown, field: string): string {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new ToolError("RESOURCE_REQUIRED", `${field} is required`, {
      api: "klaviyo",
      resource_id: field,
    });
  }
  const email = raw.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ToolError("INVALID_ARGUMENT", `${field} must be an email address`, { api: "klaviyo" });
  }
  return email;
}

function optionalEmail(raw: unknown, field: string): string | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  return requireEmail(raw, field);
}

function closedEventProperties(raw: unknown): Record<string, string | number | boolean> {
  if (raw === undefined || raw === null) return {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ToolError("INVALID_ARGUMENT", "properties must be a flat object of string/number/boolean", {
      api: "klaviyo",
    });
  }
  const out: Record<string, string | number | boolean> = {};
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > 20) {
    throw new ToolError("INVALID_ARGUMENT", "properties may include at most 20 keys", { api: "klaviyo" });
  }
  for (const [k, v] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(k)) {
      throw new ToolError("INVALID_ARGUMENT", `properties key ${k} is not allowlisted`, { api: "klaviyo" });
    }
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
      continue;
    }
    throw new ToolError("INVALID_ARGUMENT", "properties values must be string, number, or boolean", {
      api: "klaviyo",
    });
  }
  return out;
}

function profileIdentity(args: Record<string, unknown>): {
  id?: string;
  email?: string;
  external_id?: string;
} {
  const email = optionalEmail(args.email, "email");
  const externalId =
    typeof args.external_id === "string" && args.external_id.trim() ? args.external_id.trim() : undefined;
  const profileId =
    typeof args.profile_id === "string" && args.profile_id.trim() ? args.profile_id.trim() : undefined;
  if (!email && !externalId && !profileId) {
    throw new ToolError(
      "RESOURCE_REQUIRED",
      "Pass email, external_id, or profile_id — this tool will not invent a profile.",
      { api: "klaviyo", resource_id: "email" },
    );
  }
  return { id: profileId, email, external_id: externalId };
}

function includedAudienceIds(args: Record<string, unknown>): string[] {
  const raw = args.included_list_ids;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ToolError("RESOURCE_REQUIRED", "included_list_ids must name at least one list or segment id", {
      api: "klaviyo",
      resource_id: "included_list_ids",
    });
  }
  if (raw.length > 5) {
    throw new ToolError("INVALID_ARGUMENT", "included_list_ids is capped at 5", { api: "klaviyo" });
  }
  return raw.map((id, i) => {
    if (typeof id !== "string" || !id.trim()) {
      throw new ToolError("INVALID_ARGUMENT", `included_list_ids[${i}] must be a non-empty string`, {
        api: "klaviyo",
      });
    }
    return id.trim();
  });
}

export function buildDraftCampaignBody(args: Record<string, unknown>): Record<string, unknown> {
  assertDraftCreateCannotSend(args);
  const name = typeof args.name === "string" ? args.name.trim() : "";
  if (!name || name.length > 128) {
    throw new ToolError("INVALID_ARGUMENT", "name is required (max 128 characters)", { api: "klaviyo" });
  }
  const subject = typeof args.subject === "string" ? args.subject.trim() : "";
  const fromEmail = requireEmail(args.from_email, "from_email");
  const fromLabel = typeof args.from_label === "string" ? args.from_label.trim() : "";
  if (!subject || !fromLabel) {
    throw new ToolError("INVALID_ARGUMENT", "subject and from_label are required for an email draft", {
      api: "klaviyo",
    });
  }
  const included = includedAudienceIds(args);
  const excluded = Array.isArray(args.excluded_list_ids)
    ? args.excluded_list_ids.map((id) => String(id).trim()).filter(Boolean)
    : [];
  const preview =
    typeof args.preview_text === "string" && args.preview_text.trim() ? args.preview_text.trim() : undefined;
  const content: Record<string, string> = {
    subject,
    from_email: fromEmail,
    from_label: fromLabel,
  };
  if (preview) content.preview_text = preview;
  return {
    data: {
      type: "campaign",
      attributes: {
        name,
        audiences: { included, excluded },
        send_strategy: { method: "immediate" },
        "campaign-messages": {
          data: [
            {
              type: "campaign-message",
              attributes: {
                definition: {
                  channel: "email",
                  label: name,
                  content,
                },
              },
            },
          ],
        },
      },
    },
  };
}

export function buildProfileImportBody(args: Record<string, unknown>): Record<string, unknown> {
  const ident = profileIdentity(args);
  const attributes: Record<string, unknown> = {};
  if (ident.email) attributes.email = ident.email;
  if (ident.external_id) attributes.external_id = ident.external_id;
  if (typeof args.first_name === "string" && args.first_name.trim()) {
    attributes.first_name = args.first_name.trim();
  }
  if (typeof args.last_name === "string" && args.last_name.trim()) {
    attributes.last_name = args.last_name.trim();
  }
  if (args.properties !== undefined) {
    throw new ToolError("UNSUPPORTED_OPERATION", "Wave 18 upsert refuses the properties bag (PII dump)", {
      api: "klaviyo",
    });
  }
  const data: Record<string, unknown> = { type: "profile", attributes };
  if (ident.id) data.id = ident.id;
  return { data };
}

export function buildEventBody(args: Record<string, unknown>): Record<string, unknown> {
  const metric =
    typeof args.metric_name === "string" && args.metric_name.trim() ? args.metric_name.trim() : "";
  if (!metric || metric.length > 128) {
    throw new ToolError("INVALID_ARGUMENT", "metric_name is required (max 128 characters)", { api: "klaviyo" });
  }
  const ident = profileIdentity(args);
  const profileAttrs: Record<string, unknown> = {};
  if (ident.email) profileAttrs.email = ident.email;
  if (ident.external_id) profileAttrs.external_id = ident.external_id;
  const profileData: Record<string, unknown> = { type: "profile", attributes: profileAttrs };
  if (ident.id) profileData.id = ident.id;

  const attributes: Record<string, unknown> = {
    properties: closedEventProperties(args.properties),
    backfill: args.backfill !== false,
    metric: { data: { type: "metric", attributes: { name: metric } } },
    profile: { data: profileData },
  };
  if (typeof args.time === "string" && args.time.trim()) attributes.time = args.time.trim();
  if (typeof args.unique_id === "string" && args.unique_id.trim()) {
    attributes.unique_id = args.unique_id.trim();
  }
  if (typeof args.value === "number" && Number.isFinite(args.value)) attributes.value = args.value;
  if (typeof args.value_currency === "string" && args.value_currency.trim()) {
    attributes.value_currency = args.value_currency.trim().toUpperCase();
  }
  return { data: { type: "event", attributes } };
}

export async function klaviyoCreateCampaign(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "klaviyo_create_campaign";
  const proposed = buildDraftCampaignBody(args);
  assertKlaviyoPath("/api/campaigns", "POST");

  return withKlaviyo(ctx, tool, async (http) => {
    const { id, display } = await loadAccount(http);
    const dryRun = dryRunDefault(args);
    if (dryRun) {
      return okEnvelope(tool, {
        resource: { type: "klaviyo_account", id, display_name: display },
        data: {
          dry_run: true,
          account_id: id,
          proposed,
          send_job: false,
          cited: cited(id),
        },
        page: { truncated: false, row_count: 0 },
        hint: `Dry-run draft only. Live needs dry_run=false and confirm_phrase containing ${id}. Zero campaign POST. No send job.`,
      });
    }
    assertConfirmContainsAccountId(confirmPhraseOf(args), id);
    const json = await http.post("/api/campaigns", proposed);
    const campaign = json.data as KlaviyoResource | undefined;
    return okEnvelope(tool, {
      resource: {
        type: "klaviyo_campaign",
        id: String(campaign?.id ?? id),
        display_name: String(campaign?.attributes?.name ?? display),
      },
      data: {
        dry_run: false,
        account_id: id,
        campaign,
        send_job: false,
        cited: cited(id),
      },
      page: { truncated: false, row_count: campaign ? 1 : 0 },
      hint: "Draft created. This tool does not POST /api/campaign-send-jobs. Use klaviyo_create_campaign_send_job with SEND.",
    });
  });
}

export async function klaviyoUpsertProfile(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "klaviyo_upsert_profile";
  const proposed = buildProfileImportBody(args);

  return withKlaviyo(ctx, tool, async (http) => {
    const { id, display } = await loadAccount(http);
    const dryRun = dryRunDefault(args);
    if (dryRun) {
      return okEnvelope(tool, {
        resource: { type: "klaviyo_account", id, display_name: display },
        data: { dry_run: true, account_id: id, proposed, cited: cited(id) },
        page: { truncated: false, row_count: 0 },
        hint: `Dry-run only. Live needs dry_run=false and confirm_phrase containing ${id}. Zero profile-import POST.`,
      });
    }
    assertConfirmContainsAccountId(confirmPhraseOf(args), id);
    const json = await http.post("/api/profile-import", proposed);
    const profile = sparsifyProfile(json.data as KlaviyoResource | undefined);
    return okEnvelope(tool, {
      resource: {
        type: "klaviyo_profile",
        id: String(profile?.id ?? id),
        display_name: String(profile?.attributes?.email ?? display),
      },
      data: { dry_run: false, account_id: id, profile, cited: cited(id) },
      page: { truncated: false, row_count: profile ? 1 : 0 },
    });
  });
}

export async function klaviyoCreateEvent(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "klaviyo_create_event";
  const proposed = buildEventBody(args);

  return withKlaviyo(ctx, tool, async (http) => {
    const { id, display } = await loadAccount(http);
    const dryRun = dryRunDefault(args);
    if (dryRun) {
      return okEnvelope(tool, {
        resource: { type: "klaviyo_account", id, display_name: display },
        data: { dry_run: true, account_id: id, proposed, cited: cited(id) },
        page: { truncated: false, row_count: 0 },
        hint: `Dry-run backfill only. Live needs dry_run=false and confirm_phrase containing ${id}. Zero events POST.`,
      });
    }
    assertConfirmContainsAccountId(confirmPhraseOf(args), id);
    const json = await http.post("/api/events", proposed);
    return okEnvelope(tool, {
      resource: { type: "klaviyo_account", id, display_name: display },
      data: {
        dry_run: false,
        account_id: id,
        accepted: true,
        result: json.data ?? { accepted: true },
        cited: cited(id),
      },
      page: { truncated: false, row_count: 1 },
      hint: "Event accepted for processing (backfill defaults true so flows do not re-fire).",
    });
  });
}

const CATALOG_ITEM_CAP = 20;

function httpsUrlOrThrow(raw: unknown, field: string): string {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new ToolError("RESOURCE_REQUIRED", `${field} is required`, { api: "klaviyo", resource_id: field });
  }
  const url = raw.trim();
  if (!url.startsWith("https://")) {
    throw new ToolError("INVALID_ARGUMENT", `${field} must be an https URL`, { api: "klaviyo", resource_id: field });
  }
  return url;
}

function optionalHttps(raw: unknown, field: string): string | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  return httpsUrlOrThrow(raw, field);
}

function catalogItemAttributes(raw: Record<string, unknown>, index: number): Record<string, unknown> {
  const externalId = typeof raw.external_id === "string" ? raw.external_id.trim() : "";
  if (!externalId) {
    throw new ToolError("RESOURCE_REQUIRED", `items[${index}].external_id is required`, {
      api: "klaviyo",
      resource_id: "external_id",
    });
  }
  assertNotInventedShopifyKlaviyoId(externalId, "external_id");
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!title) {
    throw new ToolError("INVALID_ARGUMENT", `items[${index}].title is required`, { api: "klaviyo" });
  }
  const description =
    typeof raw.description === "string" && raw.description.trim() ? raw.description.trim() : title;
  const url = httpsUrlOrThrow(raw.url, `items[${index}].url`);
  const attrs: Record<string, unknown> = {
    external_id: externalId,
    integration_type: "$custom",
    catalog_type: "$default",
    title,
    description,
    url,
    published: raw.published !== false,
  };
  const image = optionalHttps(raw.image_full_url, `items[${index}].image_full_url`);
  if (image) attrs.image_full_url = image;
  if (typeof raw.price === "number" && Number.isFinite(raw.price)) attrs.price = raw.price;
  if (typeof raw.price === "string" && raw.price.trim() && Number.isFinite(Number(raw.price))) {
    attrs.price = Number(raw.price);
  }
  return attrs;
}

function catalogItemIdOf(raw: Record<string, unknown>, index: number): string | undefined {
  const id = typeof raw.catalog_item_id === "string" ? raw.catalog_item_id.trim() : "";
  if (!id) return undefined;
  assertNotInventedShopifyKlaviyoId(id, "catalog_item_id");
  if (!id.startsWith(CUSTOM_KLAVIYO_ID_PREFIX)) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      `items[${index}].catalog_item_id must be $custom:::$default:::{external_id} copied from klaviyo_list_catalog_items`,
      { api: "klaviyo", resource_id: "catalog_item_id" },
    );
  }
  return id;
}

export function buildCatalogItemsJobs(args: Record<string, unknown>): {
  create?: Record<string, unknown>;
  update?: Record<string, unknown>;
} {
  const raw = args.items;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ToolError("RESOURCE_REQUIRED", "items must name at least one catalog item", {
      api: "klaviyo",
      resource_id: "items",
    });
  }
  if (raw.length > CATALOG_ITEM_CAP) {
    throw new ToolError("INVALID_ARGUMENT", `items is capped at ${CATALOG_ITEM_CAP}`, { api: "klaviyo" });
  }
  const creates: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  raw.forEach((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new ToolError("INVALID_ARGUMENT", `items[${index}] must be an object`, { api: "klaviyo" });
    }
    const rec = row as Record<string, unknown>;
    const attrs = catalogItemAttributes(rec, index);
    const existingId = catalogItemIdOf(rec, index);
    if (existingId) {
      updates.push({ type: "catalog-item", id: existingId, attributes: attrs });
    } else {
      creates.push({ type: "catalog-item", attributes: attrs });
    }
  });
  const out: { create?: Record<string, unknown>; update?: Record<string, unknown> } = {};
  if (creates.length) {
    out.create = {
      data: {
        type: "catalog-item-bulk-create-job",
        attributes: { items: { data: creates } },
      },
    };
  }
  if (updates.length) {
    out.update = {
      data: {
        type: "catalog-item-bulk-update-job",
        attributes: { items: { data: updates } },
      },
    };
  }
  return out;
}

export async function klaviyoUpsertCatalogItems(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "klaviyo_upsert_catalog_items";
  const proposed = buildCatalogItemsJobs(args);
  if (proposed.create) assertKlaviyoPath("/api/catalog-item-bulk-create-jobs", "POST");
  if (proposed.update) assertKlaviyoPath("/api/catalog-item-bulk-update-jobs", "POST");

  return withKlaviyo(ctx, tool, async (http) => {
    const { id, display } = await loadAccount(http);
    const dryRun = dryRunDefault(args);
    if (dryRun) {
      return okEnvelope(tool, {
        resource: { type: "klaviyo_account", id, display_name: display },
        data: {
          dry_run: true,
          account_id: id,
          proposed,
          integration_type: "$custom",
          catalog_type: "$default",
          invented_shopify_ids: false,
          cited: cited(id),
        },
        page: { truncated: false, row_count: 0 },
        hint: `Dry-run custom catalog only. Live needs dry_run=false and confirm_phrase containing ${id}. Zero catalog POST. Never $shopify::: ids.`,
      });
    }
    assertConfirmContainsAccountId(confirmPhraseOf(args), id);
    const jobs: Record<string, unknown> = {};
    if (proposed.create) {
      jobs.create = await http.post("/api/catalog-item-bulk-create-jobs", proposed.create);
    }
    if (proposed.update) {
      jobs.update = await http.post("/api/catalog-item-bulk-update-jobs", proposed.update);
    }
    return okEnvelope(tool, {
      resource: { type: "klaviyo_account", id, display_name: display },
      data: {
        dry_run: false,
        account_id: id,
        jobs,
        integration_type: "$custom",
        catalog_type: "$default",
        invented_shopify_ids: false,
        cited: cited(id),
      },
      page: { truncated: false, row_count: 1 },
      hint: "Custom catalog job accepted. Klaviyo mints $custom:::$default:::{external_id}. This tool does not invent $shopify::: ids.",
    });
  });
}

export function buildCampaignSendJobBody(campaignId: string): Record<string, unknown> {
  const id = campaignId.trim();
  if (!id) {
    throw new ToolError("RESOURCE_REQUIRED", "campaign_id is required", {
      api: "klaviyo",
      resource_id: "campaign_id",
    });
  }
  return { data: { type: "campaign-send-job", id } };
}

export async function klaviyoCreateCampaignSendJob(
  ctx: AppContext,
  args: Record<string, unknown>,
): Promise<Envelope> {
  const tool = "klaviyo_create_campaign_send_job";
  const campaignId = requireId(args.campaign_id, "campaign_id").trim();
  const proposed = buildCampaignSendJobBody(campaignId);
  assertKlaviyoPath("/api/campaign-send-jobs", "POST");

  return withKlaviyo(ctx, tool, async (http) => {
    const { id, display } = await loadAccount(http);
    const dryRun = dryRunDefault(args);
    if (dryRun) {
      return okEnvelope(tool, {
        resource: { type: "klaviyo_account", id, display_name: display },
        data: {
          dry_run: true,
          account_id: id,
          campaign_id: campaignId,
          proposed,
          send_job: true,
          send_token_required: KLAVIYO_SEND_TOKEN,
          cited: cited(id),
        },
        page: { truncated: false, row_count: 0 },
        hint: `Dry-run send job only. Live needs dry_run=false and confirm_phrase containing ${id}, ${campaignId}, and ${KLAVIYO_SEND_TOKEN}. Zero campaign-send-jobs POST. Draft create cannot fire this.`,
      });
    }
    assertKlaviyoSendToken(confirmPhraseOf(args), id, campaignId);
    const json = await http.post("/api/campaign-send-jobs", proposed);
    return okEnvelope(tool, {
      resource: {
        type: "klaviyo_campaign_send_job",
        id: String((json.data as KlaviyoResource | undefined)?.id ?? campaignId),
        display_name: display,
      },
      data: {
        dry_run: false,
        account_id: id,
        campaign_id: campaignId,
        send_job: json.data ?? { type: "campaign-send-job", id: campaignId },
        cited: cited(id),
      },
      page: { truncated: false, row_count: 1 },
      hint: "Send job accepted. This tool is confirm-gated and cannot run from klaviyo_create_campaign.",
    });
  });
}
