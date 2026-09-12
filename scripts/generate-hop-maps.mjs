#!/usr/bin/env node
/**
 * Wave 9 — generate stamp/plugin hop maps from hop-catalog.json.
 * Source of truth: src/gateway/hop-catalog.json (byte-identical across repos).
 * Do not hand-edit hop-maps.generated.ts or w0-2-mutate-parity.json.
 *
 * Usage:
 *   node scripts/generate-hop-maps.mjs
 *   node scripts/generate-hop-maps.mjs --check
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG_PATH = join(ROOT, "src/gateway/hop-catalog.json");
const GENERATED_PATH = join(ROOT, "src/gateway/hop-maps.generated.ts");
const PARITY_PATH = join(ROOT, "tests/fixtures/w0-2-mutate-parity.json");

const catalog = JSON.parse(readFileSync(CATALOG_PATH, "utf8"));
if (catalog.schema !== "dgtl.hop-catalog.v1") {
  throw new Error(`unexpected hop-catalog schema: ${catalog.schema}`);
}

const tools = catalog.tools;
const names = tools.map((t) => t.name);
if (new Set(names).size !== names.length) {
  throw new Error("duplicate tool names in hop-catalog.json");
}
for (const name of catalog.plugin_local_describe) {
  if (names.includes(name)) {
    throw new Error(`${name} is plugin-local and must not appear in hop-catalog tools[]`);
  }
}

function namesOf(family, kind) {
  return tools.filter((t) => t.family === family && t.kind === kind).map((t) => t.name);
}

const parity = {
  comment:
    "GENERATED from src/gateway/hop-catalog.json (Wave 9). Keep byte-identical across dgtl-stamp and dgtl-connector. Do not edit by hand — run node scripts/generate-hop-maps.mjs. Mutate names must match stamp builders and plugin write groups. Describe tools are plugin-local (zero Ads/Graph HTTP) and MUST NOT appear in stamp GADS_TOOLS/META_TOOLS/TIKTOK_TOOLS.",
  gads_mutate: namesOf("gads", "mutate"),
  meta_mutate: namesOf("meta", "mutate"),
  plugin_local_describe: catalog.plugin_local_describe,
  gads_read_hop: namesOf("gads", "read_hop"),
  meta_read_hop: namesOf("meta", "read_hop"),
  tiktok_mutate: namesOf("tiktok", "mutate"),
  tiktok_read_hop: namesOf("tiktok", "read_hop"),
  closed_https_fields: catalog.closed_https_fields,
  path_only_url_adjacent: catalog.path_only_url_adjacent,
};

const generated = `/* eslint-disable */
/**
 * GENERATED from src/gateway/hop-catalog.json — do not edit.
 * Run: node scripts/generate-hop-maps.mjs
 * Wave 9: stamp GADS/META/TIKTOK maps + plugin hop allow are this file, not a second handwritten list.
 */
export const HOP_CATALOG_SCHEMA = ${JSON.stringify(catalog.schema)} as const;

export const PLUGIN_LOCAL_DESCRIBE_TOOLS = ${JSON.stringify(catalog.plugin_local_describe, null, 2)} as const;

export const CLOSED_HTTPS_FIELD_KEYS = ${JSON.stringify(catalog.closed_https_fields, null, 2)} as const;

export const PATH_ONLY_URL_ADJACENT = ${JSON.stringify(catalog.path_only_url_adjacent, null, 2)} as const;

export const GATEWAY_PARAM_ALLOW_KEYS = ${JSON.stringify(catalog.gateway_param_allow, null, 2)} as const;

export const HOP_TOOLS = ${JSON.stringify(catalog.tools, null, 2)} as const;

export type HopTool = (typeof HOP_TOOLS)[number];
export type HopFamily = HopTool["family"];
export type HopKind = HopTool["kind"];
export type GadsTool = Extract<HopTool, { family: "gads" }>["name"];
export type MetaTool = Extract<HopTool, { family: "meta" }>["name"];
export type TikTokTool = Extract<HopTool, { family: "tiktok" }>["name"];
export type GatewayTool = HopTool["name"];
`;

function writeOrCheck(path, content) {
  const check = process.argv.includes("--check");
  if (check) {
    let current = "";
    try {
      current = readFileSync(path, "utf8");
    } catch {
      current = "";
    }
    if (current !== content) {
      console.error(`stale generated file: ${path}`);
      process.exitCode = 1;
      return false;
    }
    return true;
  }
  writeFileSync(path, content);
  return true;
}

const parityJson = `${JSON.stringify(parity, null, 2)}\n`;
const okGen = writeOrCheck(GENERATED_PATH, generated);
const okParity = writeOrCheck(PARITY_PATH, parityJson);
if (!process.argv.includes("--check")) {
  console.log(`wrote ${GENERATED_PATH}`);
  console.log(`wrote ${PARITY_PATH}`);
  console.log(
    `hop tools=${tools.length} gads=${namesOf("gads", "read_hop").length}+${namesOf("gads", "mutate").length} meta=${namesOf("meta", "read_hop").length}+${namesOf("meta", "mutate").length} tiktok=${namesOf("tiktok", "read_hop").length}+${namesOf("tiktok", "mutate").length}`,
  );
} else if (okGen && okParity) {
  console.log("hop maps up to date");
}
