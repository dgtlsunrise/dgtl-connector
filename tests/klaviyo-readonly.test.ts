import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { helpText } from "../src/auth/login-cli.js";
import { createAppContext } from "../src/context.js";
import { assertKlaviyoPath } from "../src/klaviyo/http.js";
import { isKlaviyoPrivateKey, resolveKlaviyoCredentials, writeKlaviyoStore } from "../src/klaviyo/auth.js";
import { sparsifyProfile } from "../src/klaviyo/klaviyo.js";
import { dispatch } from "../src/tools/dispatch.js";
import {
  CONSENT_A_TOOLS,
  KLAVIYO_TOOL_NAMES,
  KLAVIYO_WRITE_TOOL_NAMES,
  LICENSE_GATED_TOOLS,
  LOCAL_FREE_TOOLS,
  TOOLS,
} from "../src/tools/registry.js";
import * as S from "../src/tools/schemas.js";
import { installNetworkGuard, ROOT, testEnv } from "./helpers.js";

const FIX = join(ROOT, "fixtures/klaviyo");
const ACCOUNT_ID = "W18aCc";
const FIXTURE_KEY = "pk_fixture_wave18_not_a_live_key";

const KLAVIYO_READ_TOOLS = [
  "klaviyo_get_account",
  "klaviyo_list_profiles",
  "klaviyo_get_profile",
  "klaviyo_list_lists",
  "klaviyo_list_segments",
  "klaviyo_list_flows",
  "klaviyo_get_flow",
  "klaviyo_list_campaigns",
  "klaviyo_list_metrics",
] as const;

function loadFix(name: string): unknown {
  return JSON.parse(readFileSync(join(FIX, name), "utf8"));
}

function klaviyoCtx(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch) {
  return createAppContext({
    pluginRoot: ROOT,
    env,
    fetchImpl,
    now: () => new Date("2026-09-13T12:00:00Z"),
  });
}

function createKlaviyoFetch(): {
  fetchImpl: typeof fetch;
  calls: { method: string; host: string; path: string; search: string; headers: Record<string, string>; body: string }[];
} {
  const calls: {
    method: string;
    host: string;
    path: string;
    search: string;
    headers: Record<string, string>;
    body: string;
  }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const method = (init?.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {};
    const raw = init?.headers;
    if (raw && typeof raw === "object") {
      for (const [k, v] of Object.entries(raw as Record<string, string>)) {
        headers[k.toLowerCase()] = String(v);
      }
    }
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ method, host: url.hostname, path: url.pathname, search: url.search, headers, body });

    if (url.hostname !== "a.klaviyo.com") {
      throw new Error(`NETWORK_FORBIDDEN ${url.href}`);
    }

    if (url.pathname.includes("campaign-send-jobs") || url.pathname.includes("catalog") || url.pathname.includes("reviews")) {
      return new Response(JSON.stringify({ errors: [{ detail: "out of wave" }] }), { status: 404 });
    }

    if (method === "GET" && url.pathname === "/api/accounts") {
      return new Response(JSON.stringify(loadFix("account.get.json")), {
        status: 200,
        headers: { "content-type": "application/vnd.api+json" },
      });
    }
    if (method === "GET" && url.pathname === "/api/profiles") {
      return new Response(JSON.stringify(loadFix("profiles.list.json")), {
        status: 200,
        headers: { "content-type": "application/vnd.api+json" },
      });
    }
    if (method === "GET" && url.pathname.startsWith("/api/profiles/")) {
      return new Response(JSON.stringify(loadFix("profile.get.json")), {
        status: 200,
        headers: { "content-type": "application/vnd.api+json" },
      });
    }
    if (method === "GET" && url.pathname === "/api/lists") {
      return new Response(JSON.stringify(loadFix("lists.list.json")), {
        status: 200,
        headers: { "content-type": "application/vnd.api+json" },
      });
    }
    if (method === "GET" && url.pathname === "/api/segments") {
      return new Response(JSON.stringify(loadFix("segments.list.json")), {
        status: 200,
        headers: { "content-type": "application/vnd.api+json" },
      });
    }
    if (method === "GET" && url.pathname === "/api/flows") {
      return new Response(JSON.stringify(loadFix("flows.list.json")), {
        status: 200,
        headers: { "content-type": "application/vnd.api+json" },
      });
    }
    if (method === "GET" && url.pathname.startsWith("/api/flows/")) {
      return new Response(JSON.stringify(loadFix("flow.get.json")), {
        status: 200,
        headers: { "content-type": "application/vnd.api+json" },
      });
    }
    if (method === "GET" && url.pathname === "/api/campaigns") {
      return new Response(JSON.stringify(loadFix("campaigns.list.json")), {
        status: 200,
        headers: { "content-type": "application/vnd.api+json" },
      });
    }
    if (method === "GET" && url.pathname === "/api/metrics") {
      return new Response(JSON.stringify(loadFix("metrics.list.json")), {
        status: 200,
        headers: { "content-type": "application/vnd.api+json" },
      });
    }
    if (method === "POST" && url.pathname === "/api/campaigns") {
      return new Response(JSON.stringify(loadFix("campaign.create.json")), {
        status: 201,
        headers: { "content-type": "application/vnd.api+json" },
      });
    }
    if (method === "POST" && url.pathname === "/api/profile-import") {
      return new Response(JSON.stringify(loadFix("profile.import.json")), {
        status: 201,
        headers: { "content-type": "application/vnd.api+json" },
      });
    }
    if (method === "POST" && url.pathname === "/api/events") {
      return new Response(JSON.stringify(loadFix("event.create.json")), {
        status: 202,
        headers: { "content-type": "application/vnd.api+json" },
      });
    }
    return new Response(JSON.stringify({ errors: [{ detail: `unknown ${method} ${url.pathname}` }] }), {
      status: 404,
    });
  };
  return { fetchImpl, calls };
}

describe("Wave 18 Klaviyo local pk_ lane", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("registers 9 reads + 3 writes as LOCAL_FREE, not Consent A, not Polar", () => {
    assert.equal(CONSENT_A_TOOLS.length, 26);
    assert.equal(KLAVIYO_TOOL_NAMES.length, 12);
    assert.deepEqual(KLAVIYO_WRITE_TOOL_NAMES.slice().sort(), [
      "klaviyo_create_campaign",
      "klaviyo_create_event",
      "klaviyo_upsert_profile",
    ]);
    for (const name of KLAVIYO_READ_TOOLS) {
      const t = TOOLS.find((x) => x.name === name);
      assert.ok(t, name);
      assert.equal(t!.family, "klaviyo");
      assert.equal(t!.annotations.readOnlyHint, true);
      assert.ok(LOCAL_FREE_TOOLS.includes(name), name);
      assert.ok(!CONSENT_A_TOOLS.includes(name), name);
      assert.ok(!LICENSE_GATED_TOOLS.includes(name), name);
      assert.equal(t!.stampHop, undefined);
    }
    for (const name of KLAVIYO_WRITE_TOOL_NAMES) {
      const t = TOOLS.find((x) => x.name === name);
      assert.ok(t, name);
      assert.equal(t!.family, "klaviyo_write");
      assert.equal(t!.annotations.readOnlyHint, false);
      assert.ok(LOCAL_FREE_TOOLS.includes(name), name);
      assert.ok(!CONSENT_A_TOOLS.includes(name), name);
      assert.ok(!LICENSE_GATED_TOOLS.includes(name), name);
    }
    assert.equal(TOOLS.some((t) => t.name.includes("send_job") || t.name.includes("send-job")), false);
    assert.equal(TOOLS.some((t) => t.name === "klaviyo_list_catalogs" || t.name === "klaviyo_list_reviews"), false);
  });

  it("schemas stay closed; live writes require confirm_phrase", () => {
    assert.equal(S.klaviyoGetAccount.safeParse({}).success, true);
    assert.equal(S.klaviyoGetProfile.safeParse({}).success, false);
    assert.equal(S.klaviyoGetProfile.safeParse({ profile_id: "01JWAVE18PROFILETEST01" }).success, true);
    assert.equal(S.klaviyoListCampaigns.safeParse({ channel: "email" }).success, true);
    assert.equal(S.klaviyoListCampaigns.safeParse({ channel: "postcard" }).success, false);
    assert.equal(S.klaviyoListProfiles.safeParse({ extra_fields: ["phone_number"] }).success, false);
    assert.equal(S.klaviyoCreateCampaign.safeParse({ name: "x" }).success, false);
    const live = S.klaviyoCreateCampaign.safeParse({
      name: "Draft",
      included_list_ids: ["X1List"],
      subject: "Hi",
      from_email: "hello@example.com",
      from_label: "Example Brand",
      dry_run: false,
    });
    assert.equal(live.success, false);
    const dry = S.klaviyoCreateCampaign.safeParse({
      name: "Draft",
      included_list_ids: ["X1List"],
      subject: "Hi",
      from_email: "hello@example.com",
      from_label: "Example Brand",
    });
    assert.equal(dry.success, true);
  });

  it("private key shape rejects non-pk_ values; never throws the secret", () => {
    assert.equal(isKlaviyoPrivateKey(FIXTURE_KEY), true);
    assert.equal(isKlaviyoPrivateKey("sk_not_klaviyo"), false);
    assert.equal(isKlaviyoPrivateKey("pk_short"), false);
    const creds = resolveKlaviyoCredentials({
      env: { KLAVIYO_API_KEY: "not-a-key" },
      pluginDataDir: "/tmp/does-not-exist-klaviyo",
    });
    assert.equal(creds, null);
  });

  it("allowlist refuses send jobs / catalog / reviews", () => {
    assert.throws(() => assertKlaviyoPath("/api/campaign-send-jobs", "POST"));
    assert.throws(() => assertKlaviyoPath("/api/catalog-items", "GET"));
    assert.throws(() => assertKlaviyoPath("/api/reviews", "GET"));
    assertKlaviyoPath("/api/accounts", "GET");
    assertKlaviyoPath("/api/campaigns", "POST");
  });

  it("sparsifyProfile strips phone / location / properties", () => {
    const sparse = sparsifyProfile({
      type: "profile",
      id: "x",
      attributes: {
        email: "alex@example.com",
        phone_number: "+15555550100",
        location: { city: "hidden" },
        properties: { secret: "no" },
        created: "2026-01-01T00:00:00+00:00",
      },
    });
    assert.equal(sparse?.attributes?.email, "alex@example.com");
    assert.equal(sparse?.attributes?.phone_number, undefined);
    assert.equal(sparse?.attributes?.location, undefined);
    assert.equal(sparse?.attributes?.properties, undefined);
  });

  it("KLAVIYO_NOT_CONNECTED without a key — zero HTTP", async () => {
    const { fetchImpl, calls } = createKlaviyoFetch();
    const ctx = klaviyoCtx(testEnv({ GOOGLE_ACCESS_TOKEN: "t" }), fetchImpl);
    const env = await dispatch(ctx, "klaviyo_get_account", {});
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "KLAVIYO_NOT_CONNECTED");
    assert.equal(calls.length, 0);
    assert.ok(!JSON.stringify(env).includes(FIXTURE_KEY));
  });

  it("reads hop fixtures with revision header; key never appears in envelope", async () => {
    const { fetchImpl, calls } = createKlaviyoFetch();
    const ctx = klaviyoCtx(testEnv({ KLAVIYO_API_KEY: FIXTURE_KEY, GOOGLE_ACCESS_TOKEN: "t" }), fetchImpl);

    const account = await dispatch(ctx, "klaviyo_get_account", {});
    assert.equal(account.ok, true);
    assert.equal((account.data as { account?: { id?: string } }).account?.id, ACCOUNT_ID);
    assert.equal(account.resource?.id, ACCOUNT_ID);

    const profiles = await dispatch(ctx, "klaviyo_list_profiles", {});
    assert.equal(profiles.ok, true);
    const listed = (profiles.data as { profiles: Array<{ attributes?: Record<string, unknown> }> }).profiles;
    assert.equal(listed[0]?.attributes?.email, "alex@example.com");
    assert.equal(listed[0]?.attributes?.phone_number, undefined);

    const one = await dispatch(ctx, "klaviyo_get_profile", { profile_id: "01JWAVE18PROFILETEST01" });
    assert.equal(one.ok, true);
    const got = (one.data as { profile?: { attributes?: Record<string, unknown> } }).profile;
    assert.equal(got?.attributes?.email, "alex@example.com");
    assert.equal(got?.attributes?.phone_number, undefined);
    assert.equal(got?.attributes?.location, undefined);
    assert.equal(got?.attributes?.properties, undefined);

    const lists = await dispatch(ctx, "klaviyo_list_lists", {});
    assert.equal(lists.ok, true);
    const segs = await dispatch(ctx, "klaviyo_list_segments", {});
    assert.equal(segs.ok, true);
    const flows = await dispatch(ctx, "klaviyo_list_flows", {});
    assert.equal(flows.ok, true);
    const flow = await dispatch(ctx, "klaviyo_get_flow", { flow_id: "F1Flow" });
    assert.equal(flow.ok, true);
    const camps = await dispatch(ctx, "klaviyo_list_campaigns", {});
    assert.equal(camps.ok, true);
    const metrics = await dispatch(ctx, "klaviyo_list_metrics", {});
    assert.equal(metrics.ok, true);

    assert.ok(calls.some((c) => c.path === "/api/accounts" && c.headers.revision === "2026-07-15"));
    assert.ok(calls.some((c) => c.path === "/api/campaigns" && c.search.includes("messages.channel")));
    assert.ok(calls.every((c) => c.host === "a.klaviyo.com"));
    assert.ok(calls.every((c) => c.method === "GET"));
    const blob = JSON.stringify([account, profiles, one, lists, segs, flows, flow, camps, metrics]);
    assert.ok(!blob.includes(FIXTURE_KEY));
    assert.ok(!blob.includes("Klaviyo-API-Key pk_"));
  });

  it("PLUGIN_DATA/klaviyo.json resolves when env is unset", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-klaviyo-"));
    try {
      writeKlaviyoStore(dir, { api_key: FIXTURE_KEY });
      const { fetchImpl } = createKlaviyoFetch();
      const ctx = klaviyoCtx(testEnv({ GOOGLE_ACCESS_TOKEN: "t", PLUGIN_DATA: dir }), fetchImpl);
      const env = await dispatch(ctx, "klaviyo_get_account", {});
      assert.equal(env.ok, true);
      assert.equal(env.resource?.id, ACCOUNT_ID);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skill + help document local pk_ and refuse send/catalog/Polar", () => {
    const skill = readFileSync(join(ROOT, "skills/klaviyo-readonly/SKILL.md"), "utf8");
    assert.ok(skill.includes("name: klaviyo-readonly"));
    assert.ok(skill.includes("KLAVIYO_NOT_CONNECTED"));
    assert.ok(skill.includes("2026-07-15"));
    assert.ok(skill.includes("campaign-send-jobs"));
    assert.ok(/never log the key/i.test(skill));
    const help = helpText();
    assert.ok(help.includes("KLAVIYO_API_KEY"));
    assert.ok(help.includes("klaviyo.json"));
    assert.ok(help.includes("KLAVIYO_NOT_CONNECTED"));
  });
});
