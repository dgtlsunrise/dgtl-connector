import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import { ROOT } from "./helpers.js";

describe("validate-spec", () => {
  it("python3 scripts/validate-spec.py exits 0", () => {
    const out = execFileSync("python3", ["scripts/validate-spec.py"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    assert.ok(out.includes("SPEC OK"), out);
    assert.ok(out.includes("tools=23"), out);
  });
});
