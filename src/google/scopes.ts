export const SCOPE = {
  analytics: "https://www.googleapis.com/auth/analytics.readonly",
  webmasters: "https://www.googleapis.com/auth/webmasters.readonly",
  tagmanager: "https://www.googleapis.com/auth/tagmanager.readonly",
  email: "https://www.googleapis.com/auth/userinfo.email",
  openid: "openid",
  business: "https://www.googleapis.com/auth/business.manage",
  adwords: "https://www.googleapis.com/auth/adwords",
} as const;

export const CONSENT_A = [
  SCOPE.analytics,
  SCOPE.webmasters,
  SCOPE.tagmanager,
  SCOPE.openid,
  SCOPE.email,
] as const;

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
