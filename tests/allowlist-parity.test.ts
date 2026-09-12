/**
 * W0.2 — registry gads/meta mutate tools ⊆ stamp allowlist mutate tools.
 * Describe/recipe tools stay plugin-local (A18). HTTPS closed-field checklist.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { CLOSED_HTTPS_FIELDS, GATEWAY_PARAM_ALLOW } from "../src/gateway/client.js";
import {
  GADS_MUTATE_TOOL_NAMES,
  META_MUTATE_TOOL_NAMES,
  TIKTOK_MUTATE_TOOL_NAMES,
  PLUGIN_LOCAL_DESCRIBE_TOOLS,
  TOOLS,
} from "../src/tools/registry.js";
import { ROOT } from "./helpers.js";

type ParityFixture = {
  gads_mutate: string[];
  meta_mutate: string[];
  plugin_local_describe: string[];
  gads_read_hop: string[];
  meta_read_hop: string[];
  tiktok_mutate?: string[];
  tiktok_read_hop?: string[];
  closed_https_fields: string[];
  path_only_url_adjacent: string[];
};

function loadParity(): ParityFixture {
  return JSON.parse(
    readFileSync(join(ROOT, "tests/fixtures/w0-2-mutate-parity.json"), "utf8"),
  ) as ParityFixture;
}

function sorted(xs: readonly string[]): string[] {
  return [...xs].sort();
}

function extractExportedStringArray(src: string, exportName: string): string[] {
  const header = `export const ${exportName}`;
  const start = src.indexOf(header);
  assert.ok(start >= 0, `missing export ${exportName}`);
  const bracket = src.indexOf("[", start);
  const end = src.indexOf("] as const", bracket);
  assert.ok(bracket >= 0 && end > bracket, `unparsed array ${exportName}`);
  return [...src.slice(bracket, end).matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]!);
}

function extractSetKeys(src: string, exportName: string): string[] {
  const re = new RegExp(`export const ${exportName}[\\s\\S]*?new Set\\(\\[([\\s\\S]*?)\\]\\)`);
  const m = src.match(re);
  assert.ok(m, `missing Set export ${exportName}`);
  return [...m[1]!.matchAll(/"([a-z0-9_]+)"/g)].map((x) => x[1]!);
}

function findStampRoot(): string | undefined {
  const env = process.env.DGTL_STAMP_ROOT?.trim();
  const candidates = [
    env,
    "/workspace/dgtl-planning/services/stamp",
    join(ROOT, "../dgtl-planning/services/stamp"),
    join(ROOT, "../../dgtl-planning/services/stamp"),
  ].filter((p): p is string => Boolean(p));
  for (const p of candidates) {
    if (existsSync(join(p, "src/gateway/allowlist.ts"))) return p;
  }
  return undefined;
}

describe("W0.2 registry ↔ stamp mutate allowlist parity", () => {
  const parity = loadParity();

  it("every gads_*/meta_*/tiktok_* tool is mutate, read-hop, or plugin-local describe", () => {
    const gadsMeta = TOOLS.filter(
      (t) => t.name.startsWith("gads_") || t.name.startsWith("meta_") || t.name.startsWith("tiktok_"),
    );
    const describe = new Set<string>(PLUGIN_LOCAL_DESCRIBE_TOOLS);
    const mutate = new Set([...GADS_MUTATE_TOOL_NAMES, ...META_MUTATE_TOOL_NAMES, ...TIKTOK_MUTATE_TOOL_NAMES]);
    const readHop = new Set([
      ...parity.gads_read_hop,
      ...parity.meta_read_hop,
      ...(parity.tiktok_read_hop ?? []),
    ]);
    for (const t of gadsMeta) {
      const bucket = describe.has(t.name) ? "describe" : mutate.has(t.name) ? "mutate" : readHop.has(t.name) ? "read-hop" : "unknown";
      assert.notEqual(bucket, "unknown", `unclassified ${t.name} (add to write group, describe list, or read-hop fixture)`);
    }
    assert.equal(
      gadsMeta.filter((t) => t.name.startsWith("gads_")).length,
      parity.gads_mutate.length + parity.gads_read_hop.length + 1,
    );
    assert.equal(
      gadsMeta.filter((t) => t.name.startsWith("meta_")).length,
      parity.meta_mutate.length + parity.meta_read_hop.length + 1,
    );
    assert.equal(
      gadsMeta.filter((t) => t.name.startsWith("tiktok_")).length,
      (parity.tiktok_mutate ?? []).length + (parity.tiktok_read_hop ?? []).length,
    );
  });

  it("registry mutate tools match the shared W0.2 fixture (stamp mutate surface)", () => {
    assert.deepEqual(sorted(GADS_MUTATE_TOOL_NAMES), sorted(parity.gads_mutate));
    assert.deepEqual(sorted(META_MUTATE_TOOL_NAMES), sorted(parity.meta_mutate));
    assert.deepEqual(sorted(TIKTOK_MUTATE_TOOL_NAMES), sorted(parity.tiktok_mutate ?? []));
    for (const t of TOOLS.filter(
      (x) => x.group === "gads-write" || x.group === "meta-write" || x.group === "tiktok-write",
    )) {
      assert.equal(t.annotations.destructiveHint, true, `${t.name} mutate must be destructive`);
      assert.equal(t.annotations.readOnlyHint, false, `${t.name} mutate must not be readOnly`);
    }
  });

  it("describe/recipe tools stay plugin-local (excluded from stamp mutate/read hops)", () => {
    assert.deepEqual(sorted(PLUGIN_LOCAL_DESCRIBE_TOOLS), sorted(parity.plugin_local_describe));
    const hop = new Set([
      ...parity.gads_mutate,
      ...parity.meta_mutate,
      ...parity.gads_read_hop,
      ...parity.meta_read_hop,
      ...(parity.tiktok_mutate ?? []),
      ...(parity.tiktok_read_hop ?? []),
    ]);
    for (const name of PLUGIN_LOCAL_DESCRIBE_TOOLS) {
      const spec = TOOLS.find((t) => t.name === name);
      assert.ok(spec, `registry missing ${name}`);
      assert.equal(spec!.annotations.readOnlyHint, true, `${name} must stay read-only`);
      assert.equal(hop.has(name), false, `${name} must not be a stamp hop`);
      assert.ok(
        spec!.description.toLowerCase().includes("zero") ||
          spec!.description.toLowerCase().includes("local"),
        `${name} description should say local / zero HTTP`,
      );
    }
  });

  it("HTTPS closed-field checklist: landing/media keys in hop allow", () => {
    assert.deepEqual(sorted([...CLOSED_HTTPS_FIELDS]), sorted(parity.closed_https_fields));
    for (const k of parity.closed_https_fields) {
      assert.ok(GATEWAY_PARAM_ALLOW.has(k), `${k} missing from GATEWAY_PARAM_ALLOW`);
    }
    for (const k of parity.path_only_url_adjacent) {
      assert.ok(GATEWAY_PARAM_ALLOW.has(k), `${k} missing from GATEWAY_PARAM_ALLOW`);
      assert.equal(CLOSED_HTTPS_FIELDS.has(k), false, `${k} is path-only, not https`);
    }
  });

  it("sibling stamp allowlist mutate names match registry when checkout is present", () => {
    const stamp = findStampRoot();
    if (!stamp) {
      // GitHub plugin CI has no stamp checkout. Fixture above is the contract.
      return;
    }
    const allowlist = readFileSync(join(stamp, "src/gateway/allowlist.ts"), "utf8");
    const stampGadsMutate = extractExportedStringArray(allowlist, "GADS_MUTATE_TOOLS");
    const stampMetaMutate = extractExportedStringArray(allowlist, "META_MUTATE_TOOLS");
    const stampTikTokMutate = extractExportedStringArray(allowlist, "TIKTOK_MUTATE_TOOLS");
    const stampGads = extractExportedStringArray(allowlist, "GADS_TOOLS");
    const stampMeta = extractExportedStringArray(allowlist, "META_TOOLS");
    const stampTikTok = extractExportedStringArray(allowlist, "TIKTOK_TOOLS");
    assert.deepEqual(sorted(stampGadsMutate), sorted(GADS_MUTATE_TOOL_NAMES), "stamp GADS_MUTATE_TOOLS ≠ plugin gads-write");
    assert.deepEqual(sorted(stampMetaMutate), sorted(META_MUTATE_TOOL_NAMES), "stamp META_MUTATE_TOOLS ≠ plugin meta-write");
    assert.deepEqual(sorted(stampTikTokMutate), sorted(TIKTOK_MUTATE_TOOL_NAMES), "stamp TIKTOK_MUTATE_TOOLS ≠ plugin tiktok-write");
    assert.deepEqual(sorted(stampGads), sorted([...parity.gads_mutate, ...parity.gads_read_hop]));
    assert.deepEqual(sorted(stampMeta), sorted([...parity.meta_mutate, ...parity.meta_read_hop]));
    assert.deepEqual(sorted(stampTikTok), sorted([...(parity.tiktok_mutate ?? []), ...(parity.tiktok_read_hop ?? [])]));
    for (const name of PLUGIN_LOCAL_DESCRIBE_TOOLS) {
      assert.equal(stampGads.includes(name), false, `${name} leaked into stamp GADS_TOOLS`);
      assert.equal(stampMeta.includes(name), false, `${name} leaked into stamp META_TOOLS`);
    }
    const stampFixture = readFileSync(join(stamp, "tests/fixtures/w0-2-mutate-parity.json"), "utf8");
    const pluginFixture = readFileSync(join(ROOT, "tests/fixtures/w0-2-mutate-parity.json"), "utf8");
    assert.equal(pluginFixture, stampFixture, "w0-2-mutate-parity.json must be identical across repos");
    assert.deepEqual(
      sorted(extractSetKeys(allowlist, "LANDING_URL_PARAM_KEYS")),
      sorted([...CLOSED_HTTPS_FIELDS]),
    );
  });
});
