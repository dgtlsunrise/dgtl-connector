import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { collectDoctor, DOCTOR_ENV_NAMES, formatDoctorReport } from "../src/auth/doctor.js";
import { CONSENT_A } from "../src/google/scopes.js";
import { ERROR_RUNBOOKS } from "../src/support/runbooks.js";
import { CONSENT_A_KERNEL_COUNT, CONSENT_A_TOOLS, TOOLS } from "../src/tools/registry.js";
import { dispatch } from "../src/tools/dispatch.js";
import { installNetworkGuard, makeCtx, ROOT, testEnv, TEST_TOKEN } from "./helpers.js";

const APPLY_SECRET = "apply-key-wave23-must-never-echo";

describe("Wave 23 ops honesty (support / marketplace / kernel)", () => {
  let restore: () => void;
  before(() => {
    restore = installNetworkGuard();
  });
  after(() => restore());

  it("Consent A kernel stays 26 and catalog/plugin do not promise writes", () => {
    const catalog = JSON.parse(readFileSync(join(ROOT, "schemas/v1/catalog.json"), "utf8")) as {
      count: number;
      tools: Array<{ name: string }>;
    };
    const plugin = JSON.parse(readFileSync(join(ROOT, "plugin.json"), "utf8")) as {
      description: string;
      extensions: { "com.dgtlsunrise": { closedToolCount: number; consentA: string[] } };
    };
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { description: string };
    assert.equal(CONSENT_A_KERNEL_COUNT, 26);
    assert.equal(CONSENT_A_TOOLS.length, 26);
    assert.equal(catalog.count, 26);
    assert.equal(catalog.tools.length, 26);
    assert.equal(plugin.extensions["com.dgtlsunrise"].closedToolCount, 26);
    assert.deepEqual(plugin.extensions["com.dgtlsunrise"].consentA, [
      "https://www.googleapis.com/auth/analytics.readonly",
      "https://www.googleapis.com/auth/webmasters.readonly",
      "https://www.googleapis.com/auth/tagmanager.readonly",
      "https://www.googleapis.com/auth/analytics.edit",
      "https://www.googleapis.com/auth/tagmanager.edit.containers",
      "https://www.googleapis.com/auth/tagmanager.publish",
      "https://www.googleapis.com/auth/webmasters",
    ]);
    assert.ok(CONSENT_A.includes("https://www.googleapis.com/auth/analytics.readonly"));
    assert.ok(CONSENT_A.includes("https://www.googleapis.com/auth/analytics.edit"));
    assert.ok(!(CONSENT_A as readonly string[]).includes("https://www.googleapis.com/auth/adwords"));
    const kernel = new Set(catalog.tools.map((t) => t.name));
    for (const banned of [
      "gtm_create_tag",
      "gtm_publish_container",
      "gsc_submit_sitemap",
      "shopify_product_set",
      "klaviyo_create_campaign",
      "klaviyo_create_campaign_send_job",
      "mc_upsert_product_input",
    ]) {
      assert.ok(!kernel.has(banned), banned);
      assert.ok(!CONSENT_A_TOOLS.includes(banned), banned);
    }
    assert.match(plugin.description, /read and manage/i);
    assert.match(pkg.description, /read and manage/i);
    assert.match(plugin.description, /in-chat confirm/i);
    assert.match(pkg.description, /in-chat confirm/i);
    assert.doesNotMatch(plugin.description, /read-only/i);
    assert.doesNotMatch(pkg.description, /read-only/i);
    assert.ok(TOOLS.some((t) => t.name === "support_packet"));
    assert.ok(TOOLS.some((t) => t.name === "conversion_fabric_status"));
  });

  it("CONSENT_G runbook is Wave 11+ mutate, not Wave 10 plumbing-only", async () => {
    const hint = ERROR_RUNBOOKS.CONSENT_G_REQUIRED;
    assert.ok(hint);
    assert.match(hint.next_human_step, /login-ga4-admin/);
    assert.match(hint.next_human_step, /properties\/\{id\}/);
    assert.doesNotMatch(hint.next_human_step, /Wave 10 is plumbing/i);
    assert.doesNotMatch(hint.next_human_step, /no Admin mutate/i);
    const env = await dispatch(makeCtx(), "support_packet", {
      last_tool: "ga4_create_key_event",
      error_code: "CONSENT_G_REQUIRED",
    });
    assert.equal(env.ok, true);
    const data = env.data as { runbook?: string; next_human_step?: string };
    assert.equal(data.runbook, "docs/ops/RUNBOOKS.md#consent_g_required");
    assert.match(String(data.next_human_step), /login-ga4-admin/);
    assert.doesNotMatch(String(data.next_human_step), /plumbing only/i);
  });

  it("support_packet reports conversion fabric + G/S/Klaviyo stores without secrets", async () => {
    const ctx = makeCtx(
      {},
      testEnv({
        GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
        DGTL_SGTM_APPLY_KEY: APPLY_SECRET,
        DGTL_LICENSE_JWT: "",
      }),
    );
    const env = await dispatch(ctx, "support_packet", {
      last_tool: "sgtm_ingest_test",
      error_code: "SGTM_APPLY_KEY_MISSING",
    });
    assert.equal(env.ok, true);
    const data = env.data as {
      stores?: Record<string, boolean>;
      license?: { sgtm?: boolean };
      conversion_fabric?: {
        polar_sgtm?: { reserved?: boolean; default?: string; mint?: boolean; present?: boolean };
        apply_key_present?: boolean;
      };
      runbook?: string | null;
    };
    assert.equal(typeof data.stores?.consent_g, "boolean");
    assert.equal(typeof data.stores?.consent_s, "boolean");
    assert.equal(typeof data.stores?.klaviyo, "boolean");
    assert.equal(data.license?.sgtm, false);
    assert.equal(data.conversion_fabric?.polar_sgtm?.reserved, true);
    assert.equal(data.conversion_fabric?.polar_sgtm?.default, "off");
    assert.equal(data.conversion_fabric?.polar_sgtm?.mint, false);
    assert.equal(data.conversion_fabric?.polar_sgtm?.present, false);
    assert.equal(data.conversion_fabric?.apply_key_present, true);
    assert.equal(data.runbook, "docs/ops/RUNBOOKS.md#sgtm_apply_key_missing");
    const blob = JSON.stringify(env);
    assert.ok(!blob.includes(APPLY_SECRET));
    assert.ok(!blob.includes(TEST_TOKEN));
  });

  it("doctor lists apply-key env names as SET/UNSET and never prints the value", async () => {
    assert.ok((DOCTOR_ENV_NAMES as readonly string[]).includes("DGTL_SGTM_APPLY_KEY"));
    assert.ok((DOCTOR_ENV_NAMES as readonly string[]).includes("DGTL_APPLY_KEY"));
    const dir = mkdtempSync(join(tmpdir(), "dgtl-wave23-doctor-"));
    try {
      const report = await collectDoctor({
        pluginRoot: ROOT,
        pluginDataDir: dir,
        env: {
          GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
          DGTL_SGTM_APPLY_KEY: APPLY_SECRET,
        },
      });
      assert.ok(report.env_set.includes("DGTL_SGTM_APPLY_KEY"));
      assert.ok(!report.env_set.includes(APPLY_SECRET));
      const text = formatDoctorReport(report);
      assert.ok(text.includes("DGTL_SGTM_APPLY_KEY"));
      assert.ok(!text.includes(APPLY_SECRET));
      assert.ok(!text.includes(TEST_TOKEN));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("marketplace + TOOLS + agency skill stay Consent A listing honest", () => {
    const market = readFileSync(join(ROOT, "docs/MARKETPLACE.md"), "utf8");
    const tools = readFileSync(join(ROOT, "docs/TOOLS.md"), "utf8");
    const perms = readFileSync(join(ROOT, "docs/PERMISSIONS.md"), "utf8");
    const agency = readFileSync(join(ROOT, "skills/agency-property-isolation/SKILL.md"), "utf8");
    const runbooks = readFileSync(join(ROOT, "docs/ops/RUNBOOKS.md"), "utf8");
    assert.match(market, /read and manage/i);
    assert.match(market, /Listing copy vs operator docs/);
    assert.match(tools, /Marketplace \/ public listing copy is Free Google read and manage/);
    assert.match(perms, /never requested on Consent A/i);
    assert.match(perms, /subsets of `CONSENT_A`/);
    assert.match(agency, /Shopify/);
    assert.match(agency, /Klaviyo/);
    assert.match(agency, /merchant_id/);
    assert.match(agency, /advertiser_id/);
    assert.match(runbooks, /## `META_NOT_CONNECTED`/);
    assert.match(runbooks, /## `TIKTOK_SCOPE_MISSING`/);
    assert.doesNotMatch(runbooks, /Wave 10 is plumbing only/);
  });

  it("validate-spec stays honest: kernel 26, local_free 36, skills 21", () => {
    const out = execFileSync("python3", [join(ROOT, "scripts/validate-spec.py")], {
      encoding: "utf8",
      cwd: ROOT,
    });
    assert.match(out, /SPEC OK  tools=26 \(Consent A kernel\)  local_free=36  skills=21/);
  });
});
