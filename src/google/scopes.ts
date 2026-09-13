export const SCOPE = {
  analytics: "https://www.googleapis.com/auth/analytics.readonly",
  webmasters: "https://www.googleapis.com/auth/webmasters.readonly",
  tagmanager: "https://www.googleapis.com/auth/tagmanager.readonly",
  email: "https://www.googleapis.com/auth/userinfo.email",
  openid: "openid",
  business: "https://www.googleapis.com/auth/business.manage",
  adwords: "https://www.googleapis.com/auth/adwords",
  /** GTM write family — on free Connect; mutates still need DGTL_WRITES_ENABLED. */
  tagmanagerEditContainers: "https://www.googleapis.com/auth/tagmanager.edit.containers",
  tagmanagerPublish: "https://www.googleapis.com/auth/tagmanager.publish",
  webmastersWrite: "https://www.googleapis.com/auth/webmasters",
  analyticsEdit: "https://www.googleapis.com/auth/analytics.edit",
  /** Consent MC — Merchant API. Never add to CONSENT_A. Google has no readonly content scope. */
  content: "https://www.googleapis.com/auth/content",
} as const;

/**
 * Free Google (CONSENT_A) — one Desktop Connect with identity + GA4/GSC/GTM
 * read and manage. Never includes adwords, content (MC), or business.manage.
 */
export const CONSENT_A = [
  SCOPE.openid,
  SCOPE.email,
  SCOPE.analytics,
  SCOPE.webmasters,
  SCOPE.tagmanager,
  SCOPE.analyticsEdit,
  SCOPE.tagmanagerEditContainers,
  SCOPE.tagmanagerPublish,
  SCOPE.webmastersWrite,
] as const;

/** Product + manage scopes on plugin.json `consentA` (identity stays in identityScopesSameConsent). */
export const CONSENT_A_PRODUCT = [
  SCOPE.analytics,
  SCOPE.webmasters,
  SCOPE.tagmanager,
  SCOPE.analyticsEdit,
  SCOPE.tagmanagerEditContainers,
  SCOPE.tagmanagerPublish,
  SCOPE.webmastersWrite,
] as const;

/** Scopes that must never land on free Connect. */
export const FREE_GOOGLE_NEVER = [SCOPE.adwords, SCOPE.content, SCOPE.business] as const;

/**
 * GTM/GSC/GA4 write family. Requested on free Connect. Legacy W/G/S stores
 * still accepted. Mutates stay fail-closed without DGTL_WRITES_ENABLED.
 */
export const CONSENT_W = [
  SCOPE.tagmanagerEditContainers,
  SCOPE.tagmanagerPublish,
  SCOPE.webmastersWrite,
  SCOPE.analyticsEdit,
] as const;

/** GTM edit/publish subset used by GoogleWriteHttp. */
export const CONSENT_W_GTM = [SCOPE.tagmanagerEditContainers, SCOPE.tagmanagerPublish] as const;

/**
 * GA4 Admin write family (`analytics.edit` only). On free Connect.
 * Do not request blanket `analytics`.
 */
export const CONSENT_G = [SCOPE.analyticsEdit] as const;

/**
 * Search Console write family (`webmasters`, not `.readonly`). On free Connect.
 */
export const CONSENT_S = [SCOPE.webmastersWrite] as const;

/** Consent C Google Ads — separate client; never merge into CONSENT_A. */
export const CONSENT_C_GOOGLE = [SCOPE.adwords] as const;

/**
 * Consent MC — Merchant API (products / issues / data sources). Separate Desktop
 * client. Never merge into CONSENT_A. Google's `content` scope is read/write;
 * Wave 4 reads stay GET-only on GoogleHttp. Wave 14 ProductInput / API data-source
 * writes use GoogleMcWriteHttp (same Consent MC — never Consent A).
 */
export const CONSENT_MC = [SCOPE.content] as const;

/**
 * Consent B — Google Business Profile. Separate Desktop client.
 * Never merge into CONSENT_A. Google has no readonly GBP scope;
 * Wave 5 tools are GET-only (no posts/replies/location mutate).
 */
export const CONSENT_B = [SCOPE.business] as const;

export const APIS = {
  admin: "analyticsadmin.googleapis.com",
  data: "analyticsdata.googleapis.com",
  searchconsole: "searchconsole.googleapis.com",
  tagmanager: "tagmanager.googleapis.com",
  userinfo: "openidconnect.googleapis.com",
  oauth2: "oauth2.googleapis.com",
  www: "www.googleapis.com",
  accounts: "accounts.google.com",
  /** Merchant API host (products / accounts / datasources sub-APIs). */
  merchant: "merchantapi.googleapis.com",
  gbpAccounts: "mybusinessaccountmanagement.googleapis.com",
  gbpLocations: "mybusinessbusinessinformation.googleapis.com",
  gbpPerformance: "businessprofileperformance.googleapis.com",
} as const;

/** GBP hosts only — used by httpGbp. Never on Consent A GoogleHttp. */
export const GBP_HOSTS = new Set<string>([APIS.gbpAccounts, APIS.gbpLocations, APIS.gbpPerformance]);
