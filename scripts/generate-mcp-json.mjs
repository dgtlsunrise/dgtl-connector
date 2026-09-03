#!/usr/bin/env node
/**
 * Dual-emit mcp.json (Agent Plugins / Cursor) and .mcp.json (Grok Build)
 * from one source. Do not hand-maintain two files.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcPath = join(root, "src/packaging/mcp.template.json");
const parsed = JSON.parse(readFileSync(srcPath, "utf8"));
const out = `${JSON.stringify(parsed, null, 2)}\n`;
writeFileSync(join(root, "mcp.json"), out);
writeFileSync(join(root, ".mcp.json"), out);
console.log("wrote mcp.json and .mcp.json from src/packaging/mcp.template.json");
