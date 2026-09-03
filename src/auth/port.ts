import type { AccessToken, AccessTokenSource } from "./types.js";
import { HostInjectedTokenSource } from "./host-injected.js";
import { PkceTokenSource } from "./store.js";

/**
 * AuthPort: host-injected token first, installed-app PKCE fallback.
 * Never a confidential client secret.
 */
export class AuthPort implements AccessTokenSource {
  readonly name = "authport";
  private readonly sources: AccessTokenSource[];

  constructor(sources: AccessTokenSource[]) {
    this.sources = sources;
  }

  static fromEnv(opts: {
    env?: NodeJS.ProcessEnv;
    pluginDataDir: string;
    fetchImpl: typeof fetch;
  }): AuthPort {
    const env = opts.env ?? process.env;
    return new AuthPort([
      new HostInjectedTokenSource(env),
      new PkceTokenSource(opts.pluginDataDir, env.GOOGLE_OAUTH_CLIENT_ID, opts.fetchImpl),
    ]);
  }

  async getAccessToken(): Promise<AccessToken | null> {
    for (const src of this.sources) {
      const tok = await src.getAccessToken();
      if (tok?.accessToken) return tok;
    }
    return null;
  }
}
