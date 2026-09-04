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
}

/** PLUGIN_DATA filenames — one file per consent lane. Never share A with W/C. */
export const STORE_FILE = {
  a: "google-oauth.json",
  w: "google-oauth-write.json",
  ads: "google-oauth-ads.json",
  meta: "meta-oauth.json",
} as const;

export type StoreLane = keyof typeof STORE_FILE;
