export type AccessToken = {
  accessToken: string;
  expiresIn?: number;
  scopes?: string[];
  email?: string;
  source: "host-injected" | "pkce";
};

export interface AccessTokenSource {
  readonly name: string;
  getAccessToken(): Promise<AccessToken | null>;
  /**
   * Drop a cached access token so the next getAccessToken() refreshes when a
   * refresh_token is present (PKCE stores). Used for one-shot 401 retry.
   * Host-injected sources typically no-op.
   */
  invalidateAccessToken?(): void;
}

/**
 * PLUGIN_DATA filenames. Free Google writes `a`. Legacy W/G/S files are still
 * accepted when present. Ads/MC/GBP/Meta/TikTok stay off the free store.
 */
export const STORE_FILE = {
  a: "google-oauth.json",
  w: "google-oauth-write.json",
  ads: "google-oauth-ads.json",
  meta: "meta-oauth.json",
  tiktok: "tiktok-oauth.json",
  mc: "google-oauth-mc.json",
  gbp: "google-oauth-gbp.json",
  ga4Admin: "google-oauth-ga4-admin.json",
  gscWrite: "google-oauth-gsc-write.json",
} as const;

export type StoreLane = keyof typeof STORE_FILE;
