import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildGoogleAuthUrl, generatePkce } from "../src/auth/pkce.js";
import { ROOT } from "./helpers.js";
import { TOOLS } from "../src/tools/registry.js";

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === "dist") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

describe("packaging and secrets", () => {
  it("mcp.json and .mcp.json are identical (generated from one source)", () => {
    const a = readFileSync(join(ROOT, "mcp.json"), "utf8");
    const b = readFileSync(join(ROOT, ".mcp.json"), "utf8");
    assert.equal(a, b);
    const parsed = JSON.parse(a);
    const srv = parsed.mcpServers["dgtl-connector"];
    assert.equal(srv.type, "stdio");
    assert.equal(srv.command, "./bin/dgtl-connector-mcp");
    assert.ok(!JSON.stringify(parsed).includes("npx"));
    assert.ok(!JSON.stringify(parsed).toLowerCase().includes("client_secret"));
  });

  it("binary --help exits 0", () => {
    const bin = join(ROOT, "bin/dgtl-connector-mcp");
    assert.equal(existsSync(bin), true);
    const out = execFileSync(bin, ["--help"], { encoding: "utf8" });
    assert.ok(out.includes("stdio"));
    assert.ok(out.toLowerCase().includes("pkce"));
    assert.ok(out.includes("Connect card") || out.includes("connect card"));
    assert.ok(out.includes("Manual") || out.includes("host-injected") || out.includes("no Gmail"));
  });

  it("PKCE auth URL has no client_secret and uses S256", () => {
    const pkce = generatePkce();
    const url = buildGoogleAuthUrl({
      clientId: "example-public-client-id.apps.googleusercontent.com",
      redirectUri: "http://127.0.0.1:8732/callback",
      challenge: pkce.challenge,
      state: pkce.state,
    });
    assert.ok(url.includes("code_challenge_method=S256"));
    assert.ok(!url.includes("client_secret"));
    assert.ok(url.includes("analytics.readonly"));
    assert.ok(!url.includes("adwords"));
    assert.ok(!url.includes("business.manage"));
    assert.ok(!url.includes("tagmanager.edit.containers"));
    assert.ok(!url.includes("tagmanager.publish"));
  });

  it("no secrets or developer-token in fixtures", () => {
    const files = walk(join(ROOT, "fixtures"));
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      assert.ok(!/developer-token/i.test(text), f);
      assert.ok(!/ya29\.[0-9A-Za-z._-]+/.test(text), f);
      assert.ok(!/GOCSPX-/.test(text), f);
      assert.ok(!/"refresh_token"\s*:\s*"[^"]+"/.test(text), f);
      assert.ok(!/breakwater/i.test(text), f);
      assert.ok(!/axos/i.test(text), f);
    }
  });

  it("catalog count 23 matches registry free tools and tools.schema $defs", () => {
    const catalog = JSON.parse(readFileSync(join(ROOT, "schemas/v1/catalog.json"), "utf8"));
    assert.equal(catalog.count, 23);
    assert.equal(catalog.tools.length, 23);
    const schema = JSON.parse(readFileSync(join(ROOT, "schemas/v1/tools.schema.json"), "utf8"));
    for (const t of catalog.tools) {
      assert.ok(schema.$defs[t.name], `missing schema for ${t.name}`);
      assert.ok(TOOLS.some((x) => x.name === t.name), t.name);
    }
    const plugin = JSON.parse(readFileSync(join(ROOT, "plugin.json"), "utf8"));
    assert.equal(plugin.name, "dgtl-connector");
    assert.equal(plugin.extensions["com.dgtlsunrise"].closedToolCount, 23);
    assert.equal(plugin.license, "Apache-2.0");
    assert.equal(plugin.author.name, "DGTL Sunrise");
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    assert.equal(pkg.name, "dgtl-connector");
    assert.ok(pkg.bin["dgtl-connector-mcp"]);
    for (const name of ["gtm_create_tag", "gtm_update_tag", "gtm_publish_container"]) {
      const g = catalog.gated_tools.find((x: { name: string }) => x.name === name);
      assert.ok(g, name);
      assert.equal(g.fail, "WRITE_NOT_ENABLED", name);
    }
  });

  it("README tells the truth about stdio auth", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    assert.ok(/pkce/i.test(readme));
    assert.ok(/stdio/i.test(readme));
    assert.ok(/manual/i.test(readme) || /host-injected/i.test(readme));
    assert.ok(/no Gmail-style Connect card/i.test(readme) || /not a Gmail-style Connect card/i.test(readme));
    assert.ok(!/npx .*dgtl-connector-mcp/.test(readme));
    assert.ok(!/npx .*dgtl-marketing-mcp/.test(readme));
  });
});
