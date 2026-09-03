import type { AppContext } from "../context.js";
import { failEnvelope, type Envelope } from "../envelope.js";
import { MSG } from "../errors.js";
import { hasFeature } from "../license/verify.js";

export function metaDisabled(ctx: AppContext, tool: string): Envelope {
  if (!hasFeature(ctx.license, "meta")) {
    return failEnvelope(tool, "LICENSE_REQUIRED", MSG.LICENSE_REQUIRED, {
      hint: "Meta Ads is paid. The app secret never ships in this plugin; appsecret_proof is computed on the DGTL gateway (Phase 11).",
    });
  }
  return failEnvelope(tool, "META_NOT_CONNECTED", MSG.META_NOT_CONNECTED);
}
