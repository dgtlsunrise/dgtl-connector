import { createHash, randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const TOKEN_PREFIX = "dgtl_muse_";

export function createMint(now = new Date()) {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const hash = createHash("sha256").update(token).digest("hex");
  const grant = {
    v: 1,
    grant_id: randomUUID(),
    created_at: now.toISOString(),
    status: "active",
    google: null,
    shopify: null,
    klaviyo: null,
  };
  const putCommand = `wrangler kv key put --binding MUSE_TOKENS ${hash} '${JSON.stringify(grant)}' --remote`;
  return { token, hash, grant, putCommand };
}

export function formatMint(minted) {
  return `${minted.token}\n${minted.putCommand}\n`;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) {
  process.stdout.write(formatMint(createMint()));
}
