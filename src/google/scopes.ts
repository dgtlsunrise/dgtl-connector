export const SCOPE = {
  analytics: "https://www.googleapis.com/auth/analytics.readonly",
  webmasters: "https://www.googleapis.com/auth/webmasters.readonly",
  tagmanager: "https://www.googleapis.com/auth/tagmanager.readonly",
  email: "https://www.googleapis.com/auth/userinfo.email",
  openid: "openid",
  business: "https://www.googleapis.com/auth/business.manage",
  adwords: "https://www.googleapis.com/auth/adwords",
  /** Consent W — never add to CONSENT_A */
  tagmanagerEditContainers: "https://www.googleapis.com/auth/tagmanager.edit.containers",
  tagmanagerPublish: "https://www.googleapis.com/auth/tagmanager.publish",
  webmastersWrite: "https://www.googleapis.com/auth/webmasters",
  analyticsEdit: "https://www.googleapis.com/auth/analytics.edit",
} as const;

/** Free Desktop Consent A — readonly product scopes + identity only. */
export const CONSENT_A = [
  SCOPE.analytics,
  SCOPE.webmasters,
  SCOPE.tagmanager,
  SCOPE.openid,
  SCOPE.email,
] as const;

/**
 * Consent W candidate scopes (separate OAuth client). Pick per tool; do not
 * request unused. Never merge into CONSENT_A / free Desktop client.
 */
export const CONSENT_W = [
  SCOPE.tagmanagerEditContainers,
  SCOPE.tagmanagerPublish,
  SCOPE.webmastersWrite,
  SCOPE.analyticsEdit,
] as const;

/** GTM edit/publish subset of Consent W (first write tools). */
export const CONSENT_W_GTM = [SCOPE.tagmanagerEditContainers, SCOPE.tagmanagerPublish] as const;

export const APIS = {
  admin: "analyticsadmin.googleapis.com",
  data: "analyticsdata.googleapis.com",
  searchconsole: "searchconsole.googleapis.com",
  tagmanager: "tagmanager.googleapis.com",
  userinfo: "openidconnect.googleapis.com",
  oauth2: "oauth2.googleapis.com",
  www: "www.googleapis.com",
  accounts: "accounts.google.com",
} as const;
