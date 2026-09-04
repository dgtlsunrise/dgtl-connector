import type { AppContext } from "../context.js";
import { failEnvelope, type Envelope } from "../envelope.js";
import { MSG } from "../errors.js";
import { SCOPE } from "./scopes.js";

const HINT_FLAG =
  "Set DGTL_WRITES_ENABLED=true only after a separate Consent W OAuth client exists. Free Consent A (analytics/webmasters/tagmanager.readonly) must stay readonly — see docs/ops/FULL-STACK-ACCELERATE.md.";

const HINT_CONSENT =
  "Use GOOGLE_OAUTH_WRITE_CLIENT_ID / GOOGLE_OAUTH_WRITE_CLIENT_SECRET (gitignored) for a Consent W client. Do not add tagmanager.edit.containers or tagmanager.publish to the free Desktop Consent A client.";

/**
 * Gate for GTM write/publish stubs.
 * Flag off → WRITE_NOT_ENABLED.
 * Flag on but Consent W path not wired / scopes absent → CONSENT_W_REQUIRED.
 */
export function gtmWriteNotReady(tool: string, ctx: AppContext): Envelope {
  if (!ctx.flags.writesEnabled) {
    return failEnvelope(tool, "WRITE_NOT_ENABLED", MSG.WRITE_NOT_ENABLED, {
      hint: HINT_FLAG,
      api: "tagmanager.googleapis.com",
    });
  }

  const writeClientId = ctx.env.GOOGLE_OAUTH_WRITE_CLIENT_ID?.trim();
  if (!writeClientId) {
    return failEnvelope(tool, "CONSENT_W_REQUIRED", MSG.CONSENT_W_REQUIRED, {
      hint: HINT_CONSENT,
      api: "tagmanager.googleapis.com",
      missing_scope: SCOPE.tagmanagerEditContainers,
    });
  }

  // Live mutate/publish HTTP is not in this binary yet (scaffold only).
  return failEnvelope(tool, "CONSENT_W_REQUIRED", MSG.CONSENT_W_REQUIRED, {
    hint: "Consent W client id is set and writes flag is on, but live GTM mutate/publish is not implemented in this binary yet.",
    api: "tagmanager.googleapis.com",
    missing_scope: SCOPE.tagmanagerPublish,
  });
}
