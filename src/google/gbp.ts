import type { AppContext } from "../context.js";
import { failEnvelope, type Envelope } from "../envelope.js";
import { MSG } from "../errors.js";

const HINT =
  "GBP is commercially free but access-request-gated on DGTL's GCP project. Consent B (business.manage) is a separate grant — not on the GA4/GSC/GTM screen. Live calls wait for Phase 7 after quota is non-zero.";

export function gbpNotEnabled(tool: string, ctx: AppContext): Envelope {
  if (!ctx.flags.gbpEnabled) {
    return failEnvelope(tool, "GBP_NOT_ENABLED", MSG.GBP_NOT_ENABLED, { hint: HINT, api: "businessprofileperformance.googleapis.com" });
  }
  return failEnvelope(tool, "GBP_NOT_ENABLED", MSG.GBP_NOT_ENABLED, {
    hint: "gbp.enabled is on but live GBP HTTP is not in this binary (Phase 7).",
  });
}
