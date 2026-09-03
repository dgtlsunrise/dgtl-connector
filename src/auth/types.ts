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
