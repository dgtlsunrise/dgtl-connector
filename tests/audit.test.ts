import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { loadFlags } from "../src/flags.js";
import { dispatch } from "../src/tools/dispatch.js";
import {
  TEST_TOKEN,
  installNetworkGuard,
  makeCtx,
  reportArgs,
  signLicense,
  testEnv,
} from "./helpers.js";

function captureStderr(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    lines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return orig(chunk as never, ...(rest as never[]));
  }) as typeof process.stderr.write;
  return {
    lines,
    restore: () => {
      process.stderr.write = orig;
    },
  };
}

function parseAuditLines(raw: string[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const chunk of raw) {
    for (const line of chunk.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("{")) continue;
      try {
        out.push(JSON.parse(t) as Record<string, unknown>);
      } catch {
        /* ignore non-json stderr */
      }
    }
  }
  return out;
}

describe("PR-2 local audit jsonl + log-only request_id", () => {
  let restoreNet: () => void;
  before(() => {
    restoreNet = installNetworkGuard();
  });
  after(() => restoreNet());

  it("DGTL_AUDIT_LOCAL flag defaults false and accepts truthy", () => {
    assert.equal(loadFlags({}).auditLocal, false);
    assert.equal(loadFlags({ DGTL_AUDIT_LOCAL: "true" }).auditLocal, true);
    assert.equal(loadFlags({ DGTL_AUDIT_LOCAL: "1" }).auditLocal, true);
  });

  it("stderr audit includes request_id + resource; envelope has no request_id", async () => {
    const cap = captureStderr();
    try {
      const ctx = makeCtx();
      const env = await dispatch(ctx, "ga4_get_property", { property_id: "properties/111111111" });
      assert.equal(env.ok, true);
      assert.equal("request_id" in env, false);
      const blob = JSON.stringify(env);
      assert.ok(!blob.includes("request_id"));

      const rows = parseAuditLines(cap.lines).filter((r) => r.tool === "ga4_get_property");
      assert.equal(rows.length, 1);
      const row = rows[0]!;
      assert.equal(typeof row.request_id, "string");
      assert.ok(String(row.request_id).length > 8);
      assert.equal(row.resource_type, env.resource?.type);
      assert.equal(row.resource_id, env.resource?.id);
      assert.equal(row.error_code, null);
      assert.equal(typeof row.duration_ms, "number");
      assert.equal(typeof row.ts, "string");
      const rowBlob = JSON.stringify(row);
      assert.ok(!rowBlob.includes(TEST_TOKEN));
      assert.ok(!rowBlob.toLowerCase().includes("bearer"));
      assert.ok(!rowBlob.includes("refresh_token"));
    } finally {
      cap.restore();
    }
  });

  it("optional PLUGIN_DATA/audit.jsonl when DGTL_AUDIT_LOCAL=true; never tokens/JWT/rows", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-audit-"));
    const jwt = signLicense({
      sub: "audit-user",
      exp: Math.floor(Date.now() / 1000) + 86400,
      features: ["ads"],
      jti: "audit-jti-secret-should-not-leak-as-jwt",
    });
    const cap = captureStderr();
    try {
      const ctx = makeCtx(
        {},
        testEnv({
          PLUGIN_DATA: dir,
          DGTL_AUDIT_LOCAL: "true",
          DGTL_LICENSE_JWT: jwt,
        }),
      );
      assert.equal(ctx.flags.auditLocal, true);
      const env = await dispatch(ctx, "ga4_run_report", reportArgs());
      assert.equal(env.ok, true);
      const rows = (env.data as { rows?: unknown[] }).rows ?? [];
      assert.ok(rows.length > 0);

      const path = join(dir, "audit.jsonl");
      assert.ok(existsSync(path), "audit.jsonl should exist");
      const file = readFileSync(path, "utf8");
      const parsed = file
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l) as Record<string, unknown>);
      assert.ok(parsed.some((r) => r.tool === "ga4_run_report" && typeof r.request_id === "string"));

      assert.ok(!file.includes(TEST_TOKEN));
      assert.ok(!file.includes(jwt));
      assert.ok(!file.includes("eyJ")); // JWT header fragment
      assert.ok(!file.includes("sessions")); // report metric / row content
      assert.ok(!file.toLowerCase().includes("authorization"));
      assert.ok(!file.includes("refresh_token"));

      const stderrRows = parseAuditLines(cap.lines).filter((r) => r.tool === "ga4_run_report");
      assert.equal(stderrRows.length, 1);
      assert.equal(stderrRows[0]?.request_id, parsed.find((r) => r.tool === "ga4_run_report")?.request_id);
    } finally {
      cap.restore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not create audit.jsonl when DGTL_AUDIT_LOCAL is off", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dgtl-audit-off-"));
    try {
      const ctx = makeCtx({}, testEnv({ PLUGIN_DATA: dir, DGTL_AUDIT_LOCAL: "false" }));
      assert.equal(ctx.flags.auditLocal, false);
      const env = await dispatch(ctx, "gsc_list_sites", {});
      assert.equal(env.ok, true);
      assert.equal(existsSync(join(dir, "audit.jsonl")), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("unknown tool still gets a log-only request_id", async () => {
    const cap = captureStderr();
    try {
      const ctx = makeCtx();
      const env = await dispatch(ctx, "definitely_not_a_tool", {});
      assert.equal(env.ok, false);
      assert.equal("request_id" in env, false);
      const rows = parseAuditLines(cap.lines).filter((r) => r.tool === "definitely_not_a_tool");
      assert.equal(rows.length, 1);
      assert.equal(typeof rows[0]?.request_id, "string");
      assert.equal(rows[0]?.error_code, "UNSUPPORTED_OPERATION");
    } finally {
      cap.restore();
    }
  });
});
