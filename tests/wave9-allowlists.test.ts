/**
 * Wave 9 — generated hop allowlists, tools/list stability, stable error codes.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { CLOSED_HTTPS_FIELDS, GATEWAY_PARAM_ALLOW } from "../src/gateway/client.js";
import {
  CLOSED_HTTPS_FIELD_KEYS,
  GATEWAY_PARAM_ALLOW_KEYS,
  HOP_TOOLS,
  PLUGIN_LOCAL_DESCRIBE_TOOLS as CATALOG_DESCRIBE,
} from "../src/gateway/hop-maps.generated.js";
import { ERROR_CODES } from "../src/errors.js";
import { ERROR_RUNBOOKS } from "../src/support/runbooks.js";
import {
  PLUGIN_LOCAL_DESCRIBE_TOOLS,
  TOOLS,
  stampHopAnnotation,
} from "../src/tools/registry.js";
import { ROOT } from "./helpers.js";

const FROZEN = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/w9-tools-list.json"), "utf8")) as {
  count: number;
  names: string[];
};

function sorted(xs: readonly string[]): string[] {
  return [...xs].sort();
}

describe("Wave 9 generate allowlists + tools/list freeze", () => {
  it("generate --check is clean", () => {
    const out = execFileSync("node", ["scripts/generate-hop-maps.mjs", "--check"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    assert.match(out, /up to date/);
  });

  it("plugin hop allow is generated from hop-catalog.json", () => {
    assert.deepEqual(sorted([...GATEWAY_PARAM_ALLOW]), sorted([...GATEWAY_PARAM_ALLOW_KEYS]));
    assert.deepEqual(sorted([...CLOSED_HTTPS_FIELDS]), sorted([...CLOSED_HTTPS_FIELD_KEYS]));
    for (const k of CLOSED_HTTPS_FIELD_KEYS) {
      assert.ok(GATEWAY_PARAM_ALLOW.has(k), k);
    }
    assert.ok(GATEWAY_PARAM_ALLOW.has("path1"));
    assert.equal(CLOSED_HTTPS_FIELDS.has("path1"), false);
  });

  it("registry stampHop annotations match catalog; describe stays plugin-local", () => {
    const hopNames = new Set(HOP_TOOLS.map((t) => t.name));
    for (const t of TOOLS) {
      const hop = stampHopAnnotation(t);
      if (!t.name.startsWith("gads_") && !t.name.startsWith("meta_") && !t.name.startsWith("tiktok_")) {
        assert.equal(hop, null, t.name);
        continue;
      }
      assert.ok(hop, t.name);
      assert.equal(t.stampHop?.family, hop!.family, t.name);
      assert.equal(t.stampHop?.kind, hop!.kind, t.name);
      if (hop!.kind === "plugin_local") {
        assert.equal(hopNames.has(t.name), false, `${t.name} must not be a stamp hop`);
        assert.ok((CATALOG_DESCRIBE as readonly string[]).includes(t.name));
      } else {
        const row = HOP_TOOLS.find((x) => x.name === t.name);
        assert.ok(row, `catalog missing ${t.name}`);
        assert.equal(row!.family, hop!.family);
        assert.equal(row!.kind, hop!.kind);
      }
    }
    assert.deepEqual(sorted([...PLUGIN_LOCAL_DESCRIBE_TOOLS]), sorted([...CATALOG_DESCRIBE]));
    assert.equal(
      TOOLS.some((t) => t.name === "gads_mutate" || t.name === "meta_mutate"),
      false,
      "no agent-facing mutate envelope",
    );
  });

  it("tools/list does not shrink (frozen Wave 8/9 names stay)", () => {
    const live = TOOLS.map((t) => t.name);
    assert.ok(live.length >= FROZEN.count, `tools/list shrank ${live.length} < ${FROZEN.count}`);
    for (const name of FROZEN.names) {
      assert.ok(live.includes(name), `deleted named tool ${name}`);
    }
    assert.ok(!live.includes("gads_mutate"));
    assert.ok(!live.includes("meta_mutate"));
    assert.equal(CONSENT_A_SIZE(), 24);
  });

  it("stable error codes remain and have runbooks for support_packet", () => {
    const required = [
      "ADS_MUTATE_NOT_ENABLED",
      "MERCHANT_CENTER_REQUIRED",
      "META_SCOPE_MISSING",
      "GBP_NOT_ENABLED",
      "SHOPIFY_NOT_CONNECTED",
      "LICENSE_REQUIRED",
      "WRITE_NOT_ENABLED",
      "MC_NOT_CONNECTED",
      "MC_SCOPE_MISSING",
      "TIKTOK_NOT_CONNECTED",
      "TIKTOK_MUTATE_NOT_ENABLED",
      "META_MUTATE_NOT_ENABLED",
      "GBP_NOT_CONNECTED",
      "GATEWAY_UNAVAILABLE",
    ];
    for (const code of required) {
      assert.ok((ERROR_CODES as readonly string[]).includes(code), code);
      assert.ok(ERROR_RUNBOOKS[code as keyof typeof ERROR_RUNBOOKS], `missing runbook for ${code}`);
    }
    const runbooks = readFileSync(join(ROOT, "docs/ops/RUNBOOKS.md"), "utf8");
    for (const code of required) {
      assert.ok(runbooks.includes(`## \`${code}\``), `RUNBOOKS.md missing ${code}`);
    }
  });

  it("sibling stamp hop-catalog is byte-identical when checkout is present", () => {
    const stamp = process.env.DGTL_STAMP_ROOT?.trim() || "/workspace/dgtl-planning/services/stamp";
    if (!existsSync(join(stamp, "src/gateway/hop-catalog.json"))) return;
    const a = readFileSync(join(ROOT, "src/gateway/hop-catalog.json"), "utf8");
    const b = readFileSync(join(stamp, "src/gateway/hop-catalog.json"), "utf8");
    assert.equal(a, b);
  });
});

function CONSENT_A_SIZE(): number {
  return TOOLS.filter((t) => t.family === "identity" || t.family === "ga4" || t.family === "gsc" || t.family === "gtm")
    .length;
}
