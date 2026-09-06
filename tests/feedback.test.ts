import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createAppContext } from "../src/context.js";
import { FEEDBACK_MAILBOX } from "../src/support/feedback.js";
import { clearFeedbackDrafts } from "../src/support/feedback.js";
import { dispatch } from "../src/tools/dispatch.js";
import { FREE_TOOL_NAMES, TOOLS } from "../src/tools/registry.js";
import { PLUGIN_VERSION } from "../src/version.js";
import { ROOT, installNetworkGuard, makeCtx, testEnv } from "./helpers.js";

const GATEWAY = "https://gateway.test.dgtl";
const FEEDBACK_OVERRIDE = "https://feedback.test.dgtl/v1/feedback";

type Captured = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
};

function headerMap(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  if (h instanceof Headers) {
    h.forEach((v, k) => {
      out[k.toLowerCase()] = v;
    });
    return out;
  }
  if (Array.isArray(h)) {
    for (const [k, v] of h) out[k.toLowerCase()] = String(v);
    return out;
  }
  for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = String(v);
  return out;
}

function mockFeedback(opts: { status?: number; body?: unknown } = {}): {
  fetchImpl: typeof fetch;
  captures: Captured[];
} {
  const captures: Captured[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = headerMap(init?.headers);
    let body: unknown;
    if (init?.body && typeof init.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    captures.push({ method, url, headers, body });
    if (url.includes("googleapis.com") || url.includes("graph.facebook.com")) {
      throw new Error(`NETWORK_FORBIDDEN live host: ${url}`);
    }
    return new Response(JSON.stringify(opts.body ?? { ok: true }), {
      status: opts.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetchImpl, captures };
}

function feedbackCtx(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch) {
  return createAppContext({
    pluginRoot: ROOT,
    env,
    fetchImpl,
    now: () => new Date("2026-09-02T12:00:00Z"),
  });
}

describe("feedback_prepare / feedback_send", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());
  beforeEach(() => {
    clearFeedbackDrafts();
  });

  it("prepare strips secrets and does not send", async () => {
    const ctx = makeCtx({}, testEnv({ DGTL_HOST: "Cursor", DGTL_GATEWAY_URL: GATEWAY }));
    const secretish = "Bearer should-not-echo plus developer-token and eyJhbGciOiJFRERTQSJ9.fake.payload";
    const env = await dispatch(ctx, "feedback_prepare", {
      message: `GTM 403 after enable. ${secretish}`,
      reply_to: "user@example.com",
      kind: "bug",
      last_tool: "gtm_list_accounts",
      error_code: "ACCESS_NOT_CONFIGURED",
      resource_id: "accounts/444444",
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    assert.equal(env.tool, "feedback_prepare");
    const data = env.data as {
      draft_id?: string;
      draft_text?: string;
      sent?: boolean;
      to?: string;
      reply_to?: string;
      plugin_version?: string;
    };
    assert.equal(typeof data.draft_id, "string");
    assert.ok((data.draft_id as string).length >= 8);
    assert.equal(data.sent, false);
    assert.equal(data.to, FEEDBACK_MAILBOX);
    assert.equal(data.reply_to, "user@example.com");
    assert.equal(data.plugin_version, PLUGIN_VERSION);
    assert.ok(data.draft_text?.includes("support@dgtlsunrise.com"));
    assert.ok(data.draft_text?.includes("user@example.com"));
    assert.ok(data.draft_text?.includes("[REDACTED]"));
    assert.ok(!data.draft_text?.includes("Bearer should-not-echo"));
    assert.ok(!data.draft_text?.includes("developer-token"));
    assert.ok(!data.draft_text?.includes("eyJhbGciOiJFRERTQSJ9"));
    assert.ok(!JSON.stringify(env).includes("noel@"));
    assert.equal(ctx.calls.length, 0);
  });

  it("send refuses without confirm and does not POST", async () => {
    const { fetchImpl, captures } = mockFeedback();
    const ctx = feedbackCtx(testEnv({ DGTL_GATEWAY_URL: GATEWAY, DGTL_HOST: "Cursor" }), fetchImpl);
    const prepared = await dispatch(ctx, "feedback_prepare", {
      message: "Persistent 403 on Tag Manager API.",
      reply_to: "user@example.com",
      kind: "bug",
      last_tool: "gtm_list_accounts",
      error_code: "ACCESS_NOT_CONFIGURED",
    });
    assert.equal(prepared.ok, true);
    const draftId = (prepared.data as { draft_id: string }).draft_id;

    const missing = await dispatch(ctx, "feedback_send", { draft_id: draftId });
    assert.equal(missing.ok, false);
    assert.equal(missing.error_code, "INVALID_ARGUMENT");
    assert.ok(String(missing.message).includes("confirm"));

    const falsey = await dispatch(ctx, "feedback_send", { draft_id: draftId, confirm: false });
    assert.equal(falsey.ok, false);
    assert.equal(falsey.error_code, "INVALID_ARGUMENT");

    const asString = await dispatch(ctx, "feedback_send", { draft_id: draftId, confirm: "true" });
    assert.equal(asString.ok, false);
    assert.equal(asString.error_code, "INVALID_ARGUMENT");

    assert.equal(captures.length, 0);
  });

  it("send posts expected JSON shape (mock fetch)", async () => {
    const { fetchImpl, captures } = mockFeedback();
    const ctx = feedbackCtx(testEnv({ DGTL_GATEWAY_URL: GATEWAY, DGTL_HOST: "Cursor" }), fetchImpl);
    const prepared = await dispatch(ctx, "feedback_prepare", {
      message: "Persistent 403 on Tag Manager API after enable.",
      reply_to: "user@example.com",
      kind: "bug",
      last_tool: "gtm_list_accounts",
      error_code: "ACCESS_NOT_CONFIGURED",
      resource_id: "accounts/444444",
    });
    assert.equal(prepared.ok, true);
    const draftId = (prepared.data as { draft_id: string }).draft_id;

    const sent = await dispatch(ctx, "feedback_send", { confirm: true, draft_id: draftId });
    assert.equal(sent.ok, true, JSON.stringify(sent));
    assert.equal((sent.data as { sent?: boolean }).sent, true);
    assert.equal((sent.data as { to?: string }).to, FEEDBACK_MAILBOX);

    assert.equal(captures.length, 1);
    const hop = captures[0]!;
    assert.equal(hop.method, "POST");
    assert.equal(hop.url, `${GATEWAY}/v1/feedback`);
    assert.equal(hop.headers.authorization, undefined);
    assert.ok(!JSON.stringify(hop.headers).toLowerCase().includes("bearer"));
    const body = hop.body as Record<string, unknown>;
    assert.equal(body.to, "support@dgtlsunrise.com");
    assert.equal(body.reply_to, "user@example.com");
    assert.equal(body.kind, "bug");
    assert.equal(body.message, "Persistent 403 on Tag Manager API after enable.");
    assert.equal(body.draft_id, draftId);
    assert.equal(typeof body.draft_text, "string");
    assert.equal(body.plugin_version, PLUGIN_VERSION);
    assert.equal(body.host, "Cursor");
    assert.equal(body.last_tool, "gtm_list_accounts");
    assert.equal(body.error_code, "ACCESS_NOT_CONFIGURED");
    assert.equal(body.resource_id, "accounts/444444");
    assert.equal(body.confirm, true);
    assert.ok(!JSON.stringify(body).includes("noel@"));
    assert.ok(!JSON.stringify(body).toLowerCase().includes("bearer"));
    assert.ok(!JSON.stringify(body).includes("developer-token"));
  });

  it("send with full draft fields (no cache) still posts", async () => {
    const { fetchImpl, captures } = mockFeedback();
    const ctx = feedbackCtx(testEnv({ DGTL_FEEDBACK_URL: FEEDBACK_OVERRIDE }), fetchImpl);
    const env = await dispatch(ctx, "feedback_send", {
      confirm: true,
      message: "Feature request: export GSC queries as CSV.",
      reply_to: "user@example.com",
      kind: "feature",
    });
    assert.equal(env.ok, true, JSON.stringify(env));
    assert.equal(captures.length, 1);
    assert.equal(captures[0]!.url, FEEDBACK_OVERRIDE);
    const body = captures[0]!.body as Record<string, unknown>;
    assert.equal(body.to, FEEDBACK_MAILBOX);
    assert.equal(body.kind, "feature");
    assert.equal(typeof body.draft_id, "string");
  });

  it("send without gateway or feedback URL returns GATEWAY_UNAVAILABLE", async () => {
    const { fetchImpl, captures } = mockFeedback();
    const ctx = feedbackCtx(testEnv({ DGTL_GATEWAY_URL: "", DGTL_FEEDBACK_URL: "" }), fetchImpl);
    const env = await dispatch(ctx, "feedback_send", {
      confirm: true,
      message: "Hard failure after diagnosis.",
      reply_to: "user@example.com",
    });
    assert.equal(env.ok, false);
    assert.equal(env.error_code, "GATEWAY_UNAVAILABLE");
    assert.ok(String(env.message).includes("DGTL_FEEDBACK_URL") || String(env.hint).includes("DGTL_FEEDBACK_URL"));
    assert.ok(String(env.message).includes("support@dgtlsunrise.com") || String(env.hint).includes("support@"));
    assert.equal(captures.length, 0);
  });

  it("diagnostics stay out of the 23 Consent A tools", () => {
    for (const name of ["support_packet", "feedback_prepare", "feedback_send"] as const) {
      assert.ok(TOOLS.some((t) => t.name === name), name);
      assert.ok(!FREE_TOOL_NAMES.includes(name), name);
    }
    assert.equal(FREE_TOOL_NAMES.length, 23);
    const send = TOOLS.find((t) => t.name === "feedback_send");
    assert.equal(send?.annotations.readOnlyHint, false);
    const prep = TOOLS.find((t) => t.name === "feedback_prepare");
    assert.equal(prep?.annotations.readOnlyHint, true);
  });
});
