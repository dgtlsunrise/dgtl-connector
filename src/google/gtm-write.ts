import type { AppContext } from "../context.js";
import { failEnvelope, type Envelope } from "../envelope.js";
import { MSG } from "../errors.js";
import { SCOPE } from "./scopes.js";

const HINT_FLAG =
  "Set DGTL_WRITES_ENABLED=true only after a separate Consent W OAuth client exists. Free Consent A (analytics/webmasters/tagmanager.readonly) must stay readonly — see docs/ops/FULL-STACK-ACCELERATE.md.";

const HINT_CONSENT =
  "Use GOOGLE_WRITE_ACCESS_TOKEN or PLUGIN_DATA/google-oauth-write.json (Consent W). Do not reuse GOOGLE_ACCESS_TOKEN / google-oauth.json (Consent A). Do not add tagmanager.edit.containers or tagmanager.publish to the free Desktop Consent A client.";

/**
 * Gate for GTM write/publish stubs.
 * Flag off → WRITE_NOT_ENABLED.
 * Flag on but Consent W token absent → CONSENT_W_REQUIRED.
 * Never reads ctx.auth (Consent A).
 */
export async function gtmWriteNotReady(tool: string, ctx: AppContext): Promise<Envelope> {
  if (!ctx.flags.writesEnabled) {
    return failEnvelope(tool, "WRITE_NOT_ENABLED", MSG.WRITE_NOT_ENABLED, {
      hint: HINT_FLAG,
      api: "tagmanager.googleapis.com",
    });
  }

  // Consent W only — never fall back to ctx.auth / GOOGLE_ACCESS_TOKEN.
  const writeTok = await ctx.authWrite.getAccessToken();
  if (!writeTok?.accessToken) {
    return failEnvelope(tool, "CONSENT_W_REQUIRED", MSG.CONSENT_W_REQUIRED, {
      hint: HINT_CONSENT,
      api: "tagmanager.googleapis.com",
      missing_scope: SCOPE.tagmanagerEditContainers,
    });
  }

  // Live mutate/publish HTTP is PR-8 (GoogleWriteHttp). Token store is ready.
  return failEnvelope(tool, "CONSENT_W_REQUIRED", MSG.CONSENT_W_REQUIRED, {
    hint: "Consent W token is present and writes flag is on, but live GTM mutate/publish (GoogleWriteHttp) is not implemented in this binary yet.",
    api: "tagmanager.googleapis.com",
    missing_scope: SCOPE.tagmanagerPublish,
  });
}
