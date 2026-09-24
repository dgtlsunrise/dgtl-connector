import type { GoogleLink } from "./auth";
import { json } from "./http";

/**
 * Free Google scopes for Muse `/connect`.
 * Same strings as tip `CONSENT_A` in `src/google/scopes.ts`.
 * Never request adwords, content (Merchant), or business.manage.
 */
export const SCOPE = {
  analytics: "https://www.googleapis.com/auth/analytics.readonly",
  webmasters: "https://www.googleapis.com/auth/webmasters.readonly",
  tagmanager: "https://www.googleapis.com/auth/tagmanager.readonly",
  email: "https://www.googleapis.com/auth/userinfo.email",
  openid: "openid",
  business: "https://www.googleapis.com/auth/business.manage",
  adwords: "https://www.googleapis.com/auth/adwords",
  tagmanagerEditContainers: "https://www.googleapis.com/auth/tagmanager.edit.containers",
  tagmanagerEditContainerversions: "https://www.googleapis.com/auth/tagmanager.edit.containerversions",
  tagmanagerPublish: "https://www.googleapis.com/auth/tagmanager.publish",
  webmastersWrite: "https://www.googleapis.com/auth/webmasters",
  analyticsEdit: "https://www.googleapis.com/auth/analytics.edit",
  content: "https://www.googleapis.com/auth/content",
} as const;

export const CONSENT_A = [
  SCOPE.openid,
  SCOPE.email,
  SCOPE.analytics,
  SCOPE.webmasters,
  SCOPE.tagmanager,
  SCOPE.analyticsEdit,
  SCOPE.tagmanagerEditContainers,
  SCOPE.tagmanagerEditContainerversions,
  SCOPE.tagmanagerPublish,
  SCOPE.webmastersWrite,
] as const;

/** Scopes that must never be requested on Muse Free Connect. */
export const FREE_GOOGLE_NEVER = [SCOPE.adwords, SCOPE.content, SCOPE.business] as const;

/** GA4 manage (custom dimensions and other Admin writes). */
export const GA4_MANAGE_SCOPES = [SCOPE.analyticsEdit] as const;

export function refusalForGoogleScopes(
  google: GoogleLink | null,
  required: readonly string[],
): Response | null {
  if (google === null) {
    return json({ error: "google_not_linked" }, 403);
  }
  const granted = new Set(google.scopes);
  const missing = required.filter((scope) => !granted.has(scope));
  if (missing.length === 0) {
    return null;
  }
  return json(
    {
      error: "google_reconnect_required",
      message: `This Google connection is missing ${missing.join(", ")}. Reopen /connect and reconnect Google.`,
      missing_scopes: missing,
    },
    403,
  );
}
