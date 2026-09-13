import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createAppContext } from "../src/context.js";
import {
  buildDraftCampaignBody,
  buildEventBody,
  buildProfileImportBody,
} from "../src/klaviyo/klaviyo-write.js";
import { dispatch } from "../src/tools/dispatch.js";
import { installNetworkGuard, ROOT, testEnv } from "./helpers.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIX = join(ROOT, "fixtures/klaviyo");
const ACCOUNT_ID = "W18aCc";
const FIXTURE_KEY = "pk_fixture_wave18_not_a_live_key";

function loadFix(name: string): unknown {
  return JSON.parse(readFileSync(join(FIX, name), "utf8"));
}

function createKlaviyoFetch(): {
  fetchImpl: typeof fetch;
  calls: { method: string; path: string; body: string; headers: Record<string, string> }[];
} {
  const calls: { method: string; path: string; body: string; headers: Record<string, string> }[] = [];
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
    calls.push({ method, path: url.pathname, body, headers });
    if (url.hostname !== "a.klaviyo.com") throw new Error(`NETWORK_FORBIDDEN ${url.href}`);
    if (url.pathname.includes("campaign-send-jobs")) {
      return new Response(JSON.stringify({ errors: [{ detail: "send job refused" }] }), { status: 404 });
    }
    if (method === "GET" && url.pathname === "/api/accounts") {
      return new Response(JSON.stringify(loadFix("account.get.json")), { status: 200 });
    }
    if (method === "POST" && url.pathname === "/api/campaigns") {
      return new Response(JSON.stringify(loadFix("campaign.create.json")), { status: 201 });
    }
    if (method === "POST" && url.pathname === "/api/profile-import") {
      return new Response(JSON.stringify(loadFix("profile.import.json")), { status: 201 });
    }
    if (method === "POST" && url.pathname === "/api/events") {
      return new Response(JSON.stringify(loadFix("event.create.json")), { status: 202 });
    }
    return new Response(JSON.stringify({ errors: [{ detail: "unexpected" }] }), { status: 404 });
  };
  return { fetchImpl, calls };
}

function ctx(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch) {
  return createAppContext({
    pluginRoot: ROOT,
    env,
    fetchImpl,
    now: () => new Date("2026-09-13T12:00:00Z"),
  });
}

const DRAFT = {
  name: "Wave 18 draft",
  included_list_ids: ["X1List"],
  subject: "September note",
  from_email: "hello@example.com",
  from_label: "Example Brand",
};

describe("Wave 18 Klaviyo writes (draft / upsert / backfill)", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("WRITE_NOT_ENABLED before any Klaviyo HTTP when flag is off", async () => {
    const { fetchImpl, calls } = createKlaviyoFetch();
    const env = await dispatch(
      ctx(testEnv({ KLAVIYO_API_KEY: FIXTURE_KEY, DGTL_WRITES_ENABLED: "false" }), fetchImpl),
      "klaviyo_create_campaign",
      DRAFT,
    );
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "WRITE_NOT_ENABLED");
    assert.equal(calls.length, 0);
  });

  it("KLAVIYO_NOT_CONNECTED when writes are on but no key", async () => {
    const { fetchImpl, calls } = createKlaviyoFetch();
    const env = await dispatch(
      ctx(testEnv({ DGTL_WRITES_ENABLED: "true" }), fetchImpl),
      "klaviyo_upsert_profile",
      { email: "sam@example.com" },
    );
    assert.equal(env.error_code, "KLAVIYO_NOT_CONNECTED");
    assert.equal(calls.length, 0);
  });

  it("dry_run GETs account only — zero mutate POST", async () => {
    const { fetchImpl, calls } = createKlaviyoFetch();
    const env = await dispatch(
      ctx(testEnv({ KLAVIYO_API_KEY: FIXTURE_KEY, DGTL_WRITES_ENABLED: "true" }), fetchImpl),
      "klaviyo_create_campaign",
      DRAFT,
    );
    assert.equal(env.ok, true);
    const data = env.data as { dry_run?: boolean; account_id?: string; send_job?: boolean };
    assert.equal(data.dry_run, true);
    assert.equal(data.account_id, ACCOUNT_ID);
    assert.equal(data.send_job, false);
    assert.deepEqual(
      calls.map((c) => `${c.method} ${c.path}`),
      ["GET /api/accounts"],
    );
    assert.ok(!JSON.stringify(env).includes(FIXTURE_KEY));
  });

  it("live without account id in confirm_phrase fails; still no campaign POST", async () => {
    const { fetchImpl, calls } = createKlaviyoFetch();
    const env = await dispatch(
      ctx(testEnv({ KLAVIYO_API_KEY: FIXTURE_KEY, DGTL_WRITES_ENABLED: "true" }), fetchImpl),
      "klaviyo_create_campaign",
      { ...DRAFT, dry_run: false, confirm_phrase: "yes send it" },
    );
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "INVALID_ARGUMENT");
    assert.deepEqual(
      calls.map((c) => `${c.method} ${c.path}`),
      ["GET /api/accounts"],
    );
  });

  it("live draft create confirms account id and never hits send jobs", async () => {
    const { fetchImpl, calls } = createKlaviyoFetch();
    const env = await dispatch(
      ctx(testEnv({ KLAVIYO_API_KEY: FIXTURE_KEY, DGTL_WRITES_ENABLED: "true" }), fetchImpl),
      "klaviyo_create_campaign",
      { ...DRAFT, dry_run: false, confirm_phrase: `create draft on ${ACCOUNT_ID}` },
    );
    assert.equal(env.ok, true);
    const data = env.data as { dry_run?: boolean; campaign?: { id?: string }; send_job?: boolean };
    assert.equal(data.dry_run, false);
    assert.equal(data.campaign?.id, "C2Draft");
    assert.equal(data.send_job, false);
    assert.ok(calls.some((c) => c.method === "POST" && c.path === "/api/campaigns"));
    assert.equal(calls.some((c) => c.path.includes("send-job")), false);
    const posted = JSON.parse(calls.find((c) => c.method === "POST")!.body) as {
      data: { attributes: { "campaign-messages": { data: Array<{ attributes: { definition: { channel: string } } }> } } };
    };
    assert.equal(posted.data.attributes["campaign-messages"].data[0]?.attributes.definition.channel, "email");
  });

  it("upsert + event live paths; event backfill defaults true", async () => {
    const { fetchImpl, calls } = createKlaviyoFetch();
    const c = ctx(testEnv({ KLAVIYO_API_KEY: FIXTURE_KEY, DGTL_WRITES_ENABLED: "true" }), fetchImpl);
    const upsert = await dispatch(c, "klaviyo_upsert_profile", {
      email: "sam@example.com",
      first_name: "Sam",
      dry_run: false,
      confirm_phrase: ACCOUNT_ID,
    });
    assert.equal(upsert.ok, true);
    const event = await dispatch(c, "klaviyo_create_event", {
      metric_name: "Placed Order",
      email: "sam@example.com",
      unique_id: "evt-w18-1",
      properties: { value: 12 },
      dry_run: false,
      confirm_phrase: ACCOUNT_ID,
    });
    assert.equal(event.ok, true);
    const eventBody = JSON.parse(calls.find((x) => x.path === "/api/events")!.body) as {
      data: { attributes: { backfill?: boolean } };
    };
    assert.equal(eventBody.data.attributes.backfill, true);
    assert.ok(!JSON.stringify([upsert, event]).includes(FIXTURE_KEY));
  });

  it("builders refuse send jobs and properties-bag upsert", () => {
    assert.throws(() => buildDraftCampaignBody({ ...DRAFT, send_job: true }));
    assert.throws(() => buildProfileImportBody({ email: "sam@example.com", properties: { bag: true } }));
    const ev = buildEventBody({ metric_name: "Viewed Product", email: "sam@example.com" });
    const attrs = (ev.data as { attributes: { backfill?: boolean } }).attributes;
    assert.equal(attrs.backfill, true);
  });
});
