import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { describe, it } from "node:test";
import { join } from "node:path";
import { ALL_SCOPES, ROOT, TEST_TOKEN } from "./helpers.js";
import { FREE_TOOL_NAMES } from "../src/tools/registry.js";

type Rpc = { jsonrpc: "2.0"; id?: number; method?: string; params?: unknown; result?: unknown; error?: unknown };

function send(proc: ReturnType<typeof spawn>, msg: Rpc): void {
  proc.stdin!.write(`${JSON.stringify(msg)}\n`);
}

async function readRpc(proc: ReturnType<typeof spawn>, timeoutMs = 15000): Promise<Rpc> {
  return await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout waiting for MCP message")), timeoutMs);
    let buf = "";
    const onData = (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      const nl = buf.indexOf("\n");
      if (nl !== -1) {
        clearTimeout(t);
        proc.stdout!.off("data", onData);
        const line = buf.slice(0, nl).trim();
        try {
          resolve(JSON.parse(line) as Rpc);
        } catch (e) {
          reject(new Error(`bad json: ${line}`));
        }
      }
    };
    proc.stdout!.on("data", onData);
  });
}

describe("binary MCP initialize + tools/list", () => {
  it("speaks initialize and lists the closed tools", async () => {
    const bin = join(ROOT, "bin/dgtl-connector-mcp");
    const proc = spawn(bin, [], {
      cwd: ROOT,
      env: {
        ...process.env,
        GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
        GOOGLE_GRANTED_SCOPES: ALL_SCOPES,
        PLUGIN_ROOT: ROOT,
        PLUGIN_DATA: join(ROOT, ".dgtl-plugin-data-test"),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const err: string[] = [];
    proc.stderr?.on("data", (c) => err.push(String(c)));
    try {
      send(proc, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "dgtl-proof", version: "0.0.0" },
        },
      });
      const init = await readRpc(proc);
      assert.equal(init.id, 1);
      assert.ok(init.result, JSON.stringify(init));
      const result = init.result as { serverInfo?: { name?: string }; protocolVersion?: string };
      assert.equal(result.serverInfo?.name, "dgtl-connector");

      send(proc, { jsonrpc: "2.0", method: "notifications/initialized" });
      send(proc, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
      const listed = await readRpc(proc);
      assert.equal(listed.id, 2);
      const tools = (listed.result as { tools: Array<{ name: string }> }).tools;
      const names = tools.map((t) => t.name);
      for (const n of FREE_TOOL_NAMES) {
        assert.ok(names.includes(n), `missing ${n}`);
      }
      assert.ok(names.includes("gads_search"));
      assert.ok(names.includes("gbp_list_locations"));
      assert.ok(names.includes("meta_insights"));
      assert.ok(names.includes("license_status"));
      assert.ok(names.includes("support_packet"));
      assert.ok(names.includes("feedback_prepare"));
      assert.ok(names.includes("feedback_send"));
      assert.ok(!names.some((n) => n.includes(".")));

      send(proc, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "ga4_run_report",
          arguments: {
            property_id: "properties/111111111",
            date_ranges: [{ start_date: "2026-08-01", end_date: "2026-08-31" }],
            metrics: ["sessions"],
            dimensions: ["searchQuery"],
          },
        },
      });
      const denied = await readRpc(proc);
      const text = (denied.result as { content: Array<{ text: string }> }).content[0]?.text ?? "";
      const envelope = JSON.parse(text) as { error_code?: string; ok?: boolean };
      assert.equal(envelope.error_code, "UNSUPPORTED_DIMENSION");
      assert.equal(envelope.ok, false);
    } finally {
      proc.kill("SIGTERM");
    }
  });
});
