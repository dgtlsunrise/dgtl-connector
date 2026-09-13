import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  assertApplyDoesNotSetEnabled,
  assertDraftCreateCannotSend,
  assertNoApplyAll,
  assertOneMutatePerConfirm,
  buildRecsApprovePushBrief,
  diffGtmWorkspace,
  KLAVIYO_SEND_TOKEN,
  missingGa4AdsLink,
  parseRecommendationResourceNames,
  WAVE22_MUTATE_TOOLS,
  WAVE22_SURFACES,
  type AdsRecommendation,
} from "../src/recs/approve-push.js";
import { buildDraftCampaignBody } from "../src/klaviyo/klaviyo-write.js";
import { ToolError } from "../src/errors.js";
import { dispatch } from "../src/tools/dispatch.js";
import { CONSENT_A_TOOLS, LICENSE_GATED_TOOLS, LOCAL_FREE_TOOLS, TOOLS } from "../src/tools/registry.js";
import * as S from "../src/tools/schemas.js";
import {
  installNetworkGuard,
  makeCtx,
  ROOT,
  signLicense,
  testEnv,
  TEST_TOKEN,
} from "./helpers.js";

const GATEWAY = "https://stamp.test";
const ADS_TOKEN = "consent-c-ads-user-token";
const CUSTOMER = "1234567890";
const FIXTURE_KEY = "pk_fixture_wave18_not_a_live_key";
const ACCOUNT_ID = "W18aCc";

function loadJson(rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(ROOT, rel), "utf8")) as Record<string, unknown>;
}

const THREE = loadJson("fixtures/ads/recommendations.three.json") as {
  customer_id: string;
  recommendations: AdsRecommendation[];
};

const GTM_DIFF = loadJson("fixtures/gtm/workspace-diff.json") as {
  public_id: string;
  workspace: { tags: Array<{ id: string; name?: string }>; triggers: Array<{ id: string }>; variables: Array<{ id: string }> };
  live: { tags: Array<{ id: string; name?: string }>; triggers: Array<{ id: string }>; variables: Array<{ id: string }> };
};

function licensedEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const jwt = signLicense({
    sub: "w22-user",
    exp: Math.floor(Date.now() / 1000) + 86400,
    features: ["ads", "meta", "tiktok"],
    jti: "w22-jti",
  });
  return testEnv({
    DGTL_LICENSE_JWT: jwt,
    GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
    GOOGLE_ADS_ACCESS_TOKEN: ADS_TOKEN,
    DGTL_GATEWAY_URL: GATEWAY,
    ...extra,
  });
}

function hopFetch(onHop: (url: string, body: Record<string, unknown>) => Response | void): typeof fetch {
  return (async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/v1/health")) {
      return new Response(JSON.stringify({ ok: true, ads_mutate_enabled: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const override = onHop(url, body);
    if (override) return override;
    return new Response(
      JSON.stringify({
        ok: true,
        tool: "hop",
        data: { results: [] },
        page: { truncated: false, row_count: 0 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
}

function klaviyoFetch(): {
  fetchImpl: typeof fetch;
  calls: { method: string; path: string; body: string }[];
} {
  const calls: { method: string; path: string; body: string }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ method, path: url.pathname, body });
    if (url.hostname !== "a.klaviyo.com") throw new Error(`NETWORK_FORBIDDEN ${url.href}`);
    if (method === "GET" && url.pathname === "/api/accounts") {
      return new Response(readFileSync(join(ROOT, "fixtures/klaviyo/account.get.json"), "utf8"), {
        status: 200,
      });
    }
    if (method === "POST" && url.pathname === "/api/campaigns") {
      return new Response(readFileSync(join(ROOT, "fixtures/klaviyo/campaign.create.json"), "utf8"), {
        status: 201,
      });
    }
    if (method === "POST" && url.pathname === "/api/campaign-send-jobs") {
      return new Response(
        readFileSync(join(ROOT, "fixtures/klaviyo/campaign-send-job.create.json"), "utf8"),
        { status: 202 },
      );
    }
    return new Response(JSON.stringify({ errors: [{ detail: "unexpected" }] }), { status: 404 });
  };
  return { fetchImpl, calls };
}

const DRAFT = {
  name: "Wave 22 draft",
  included_list_ids: ["X1List"],
  subject: "September note",
  from_email: "hello@example.com",
  from_label: "Example Brand",
};

describe("wave22 recs approve push", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("Consent A stays 26; named tools only; no apply-all mega tool", () => {
    assert.equal(CONSENT_A_TOOLS.length, 26);
    assert.ok(LICENSE_GATED_TOOLS.includes("gads_apply_recommendation"));
    assert.ok(LICENSE_GATED_TOOLS.includes("gads_apply_recommendations"));
    assert.ok(LOCAL_FREE_TOOLS.includes("klaviyo_create_campaign_send_job"));
    assert.ok(!CONSENT_A_TOOLS.includes("gads_apply_recommendations"));
    assert.ok(!CONSENT_A_TOOLS.includes("klaviyo_create_campaign_send_job"));
    assert.equal(
      TOOLS.some((t) => /apply_all_recommend|approve_and_push|send_all/i.test(t.name)),
      false,
    );
    const catalog = JSON.parse(readFileSync(join(ROOT, "schemas/v1/catalog.json"), "utf8")) as {
      gated_tools: Array<{ name: string; fail: string }>;
    };
    const batch = catalog.gated_tools.find((x) => x.name === "gads_apply_recommendations");
    assert.ok(batch);
    assert.equal(batch!.fail, "ADS_MUTATE_NOT_ENABLED");
    const send = catalog.gated_tools.find((x) => x.name === "klaviyo_create_campaign_send_job");
    assert.ok(send);
    assert.equal(send!.fail, "WRITE_NOT_ENABLED");
  });

  it("three-recs fixture: one confirmed RN → one mutate HTTP", async () => {
    assert.equal(THREE.recommendations.length, 3);
    const chosen = THREE.recommendations[0]!;
    let mutateHops = 0;
    let hopBody: Record<string, unknown> | undefined;
    const ctx = makeCtx({}, licensedEnv());
    ctx.fetchImpl = hopFetch((url, body) => {
      if (url.includes("/v1/gads/gads_apply_recommendation")) {
        mutateHops += 1;
        hopBody = body;
      }
    });
    const env = await dispatch(ctx, "gads_apply_recommendations", {
      customer_id: CUSTOMER,
      recommendation_resource_names: [chosen.resource_name],
      dry_run: false,
      confirm_phrase: `apply ${CUSTOMER} ${chosen.resource_name}`,
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    assert.equal(mutateHops, 1);
    const params = hopBody?.params as { recommendation_resource_names?: string[]; status?: string } | undefined;
    assert.deepEqual(params?.recommendation_resource_names, [chosen.resource_name]);
    assert.equal(params?.status, undefined);
    assert.equal(JSON.stringify(hopBody).includes("ENABLED"), false);
    assert.equal(
      JSON.stringify(hopBody).includes(THREE.recommendations[1]!.resource_name),
      false,
    );
  });

  it("apply-all and ENABLED side effect refuse with zero hop", async () => {
    let hops = 0;
    const ctx = makeCtx({}, licensedEnv());
    ctx.fetchImpl = hopFetch((url) => {
      if (url.includes("/v1/gads/")) hops += 1;
    });
    const all = await dispatch(ctx, "gads_apply_recommendations", {
      customer_id: CUSTOMER,
      apply_all: true,
      recommendation_resource_names: THREE.recommendations.map((r) => r.resource_name),
      dry_run: false,
      confirm_phrase: `${CUSTOMER} ALL`,
    });
    assert.equal(all.ok, false);
    assert.equal(all.error_code, "UNSUPPORTED_OPERATION");
    const enabled = await dispatch(ctx, "gads_apply_recommendation", {
      customer_id: CUSTOMER,
      recommendation_resource_name: THREE.recommendations[0]!.resource_name,
      status: "ENABLED",
      dry_run: false,
      confirm_phrase: `${CUSTOMER} ${THREE.recommendations[0]!.recommendation_id}`,
    });
    assert.equal(enabled.ok, false);
    assert.equal(enabled.error_code, "UNSUPPORTED_OPERATION");
    const unnamed = await dispatch(ctx, "gads_apply_recommendations", {
      customer_id: CUSTOMER,
      recommendation_resource_names: THREE.recommendations.map((r) => r.resource_name),
      dry_run: false,
      confirm_phrase: `apply ${CUSTOMER} only`,
    });
    assert.equal(unnamed.ok, false);
    assert.equal(unnamed.error_code, "INVALID_ARGUMENT");
    assert.equal(hops, 0);
    assert.throws(() => assertNoApplyAll({ apply_all: true }));
    assert.throws(() => assertApplyDoesNotSetEnabled({ status: "ENABLED" }));
  });

  it("schemas default dry_run true; hop catalog has batch apply row", () => {
    assert.equal(
      S.gadsApplyRecommendations.parse({
        customer_id: CUSTOMER,
        recommendation_resource_names: [THREE.recommendations[0]!.resource_name],
      }).dry_run,
      true,
    );
    assert.equal(S.klaviyoCreateCampaignSendJob.parse({ campaign_id: "C2Draft" }).dry_run, true);
    const hops = JSON.parse(readFileSync(join(ROOT, "src/gateway/hop-catalog.json"), "utf8")) as {
      comment: string;
      tools: Array<{ name: string; path_template: string }>;
    };
    assert.match(hops.comment, /gads_apply_recommendations/);
    assert.match(hops.comment, /apply-all/);
    const row = hops.tools.find((t) => t.name === "gads_apply_recommendations");
    assert.ok(row);
    assert.match(row!.path_template, /recommendations:apply/);
    const rns = parseRecommendationResourceNames(
      { recommendation_resource_names: THREE.recommendations.map((r) => r.resource_name) },
      CUSTOMER,
    );
    assert.equal(rns.length, 3);
  });

  it("send job cannot fire from draft create", async () => {
    assert.throws(
      () => buildDraftCampaignBody({ ...DRAFT, send_job: true }),
      (err: unknown) => err instanceof ToolError && err.error_code === "UNSUPPORTED_OPERATION",
    );
    assert.throws(() => assertDraftCreateCannotSend({ send: true }));
    const { fetchImpl, calls } = klaviyoFetch();
    const ctx = makeCtx(
      {},
      testEnv({ KLAVIYO_API_KEY: FIXTURE_KEY, DGTL_WRITES_ENABLED: "true" }),
    );
    ctx.fetchImpl = fetchImpl;
    const refused = await dispatch(ctx, "klaviyo_create_campaign", { ...DRAFT, send_job: true });
    assert.equal(refused.ok, false);
    assert.equal(refused.error_code, "UNSUPPORTED_OPERATION");
    const live = await dispatch(ctx, "klaviyo_create_campaign", {
      ...DRAFT,
      dry_run: false,
      confirm_phrase: `create draft on ${ACCOUNT_ID}`,
    });
    assert.equal(live.ok, true, JSON.stringify(live));
    assert.equal((live.data as { send_job?: boolean }).send_job, false);
    assert.ok(calls.some((c) => c.method === "POST" && c.path === "/api/campaigns"));
    assert.equal(calls.some((c) => c.path.includes("campaign-send-jobs")), false);
  });

  it("send job is confirm-gated with SEND token", async () => {
    const { fetchImpl, calls } = klaviyoFetch();
    const ctx = makeCtx(
      {},
      testEnv({ KLAVIYO_API_KEY: FIXTURE_KEY, DGTL_WRITES_ENABLED: "true" }),
    );
    ctx.fetchImpl = fetchImpl;
    const dry = await dispatch(ctx, "klaviyo_create_campaign_send_job", { campaign_id: "C2Draft" });
    assert.equal(dry.ok, true, JSON.stringify(dry));
    assert.equal((dry.data as { dry_run?: boolean }).dry_run, true);
    assert.equal(
      calls.filter((c) => c.path === "/api/campaign-send-jobs").length,
      0,
    );
    const noToken = await dispatch(ctx, "klaviyo_create_campaign_send_job", {
      campaign_id: "C2Draft",
      dry_run: false,
      confirm_phrase: `${ACCOUNT_ID} C2Draft`,
    });
    assert.equal(noToken.ok, false);
    assert.equal(noToken.error_code, "INVALID_ARGUMENT");
    assert.match(String(noToken.message), /SEND/);
    const live = await dispatch(ctx, "klaviyo_create_campaign_send_job", {
      campaign_id: "C2Draft",
      dry_run: false,
      confirm_phrase: `${ACCOUNT_ID} C2Draft ${KLAVIYO_SEND_TOKEN}`,
    });
    assert.equal(live.ok, true, JSON.stringify(live));
    assert.equal(calls.filter((c) => c.method === "POST" && c.path === "/api/campaign-send-jobs").length, 1);
  });

  it("sequences five surfaces; one mutate per confirm; GTM diff + missing Ads link", () => {
    assert.deepEqual([...WAVE22_SURFACES], [
      "ads_recommendations",
      "mc_issues",
      "gtm_workspace_diff",
      "klaviyo_flow_status",
      "ga4_ads_link",
    ]);
    const diff = diffGtmWorkspace(GTM_DIFF.workspace, GTM_DIFF.live);
    assert.equal(diff.added.length, 1);
    assert.equal(diff.added[0]?.id, "9");
    assert.equal(missingGa4AdsLink([], CUSTOMER), true);
    assert.equal(missingGa4AdsLink([{ customerId: CUSTOMER }], CUSTOMER), false);
    const brief = buildRecsApprovePushBrief({
      ads_recommendations: THREE.recommendations,
      mc_issue_count: 2,
      workspace: GTM_DIFF.workspace,
      live: GTM_DIFF.live,
      klaviyo_flows: [{ flow_id: "F1Flow", status: "draft", name: "Welcome series" }],
      ga4_ads_links: [],
      customer_id: CUSTOMER,
    });
    assert.equal(brief.apply_all, false);
    assert.equal(brief.enabled_side_effect, false);
    assert.equal(brief.next_mutate?.tool, "gads_apply_recommendations");
    assert.equal(brief.next_mutate?.dry_run, true);
    assert.throws(() =>
      assertOneMutatePerConfirm(["gads_apply_recommendations", "klaviyo_create_campaign_send_job"]),
    );
    assert.doesNotThrow(() => assertOneMutatePerConfirm(["gads_apply_recommendations"]));
    for (const name of WAVE22_MUTATE_TOOLS) {
      assert.ok(TOOLS.some((t) => t.name === name), name);
    }
  });

  it("skill documents sequence, one mutate, SEND, no apply-all", () => {
    const skill = readFileSync(join(ROOT, "skills/recs-approve-push/SKILL.md"), "utf8");
    assert.ok(skill.includes("name: recs-approve-push"));
    assert.ok(skill.includes("gads_search"));
    assert.ok(skill.includes("recommendations"));
    assert.ok(skill.includes("mc_list_account_issues"));
    assert.ok(skill.includes("gtm_get_live_container_version"));
    assert.ok(skill.includes("klaviyo_list_flows"));
    assert.ok(skill.includes("ga4_list_google_ads_links"));
    assert.ok(skill.includes("gads_apply_recommendations"));
    assert.ok(skill.includes("klaviyo_create_campaign_send_job"));
    assert.ok(skill.includes("SEND"));
    assert.ok(skill.includes("one mutate"));
    assert.ok(skill.includes("apply-all") || skill.includes("apply all"));
    assert.ok(skill.includes("ENABLED is not a side effect"));
    assert.match(skill, /Never Axos/);
  });

  it("sibling stamp hop-catalog batch apply row matches when checkout is present", () => {
    const stamp = process.env.DGTL_STAMP_ROOT?.trim() || "/workspace/dgtl-planning/services/stamp";
    if (!existsSync(join(stamp, "src/gateway/hop-catalog.json"))) return;
    const plugin = JSON.parse(readFileSync(join(ROOT, "src/gateway/hop-catalog.json"), "utf8")) as {
      tools: Array<{ name: string; path_template: string; method: string }>;
    };
    const remote = JSON.parse(readFileSync(join(stamp, "src/gateway/hop-catalog.json"), "utf8")) as {
      tools: Array<{ name: string; path_template: string; method: string }>;
    };
    const a = plugin.tools.find((t) => t.name === "gads_apply_recommendations");
    const b = remote.tools.find((t) => t.name === "gads_apply_recommendations");
    assert.ok(a);
    if (b) assert.deepEqual(a, b);
  });
});
