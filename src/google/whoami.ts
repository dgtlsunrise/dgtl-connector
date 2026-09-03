import type { AppContext } from "../context.js";
import { okEnvelope, type Envelope } from "../envelope.js";
import { APIS } from "./scopes.js";
import { MSG, ToolError } from "../errors.js";

type UserInfo = {
  email?: string;
  sub?: string;
  email_verified?: boolean;
};

export async function googleWhoami(ctx: AppContext): Promise<Envelope> {
  const token = await ctx.auth.getAccessToken();
  if (!token?.accessToken) {
    throw new ToolError("UNAUTHENTICATED", MSG.UNAUTHENTICATED);
  }
  const info = (await ctx.http.get(
    APIS.userinfo,
    "/v1/userinfo",
    undefined,
    { api: APIS.userinfo, tool: "google_whoami" },
  )) as UserInfo;

  let scopes = token.scopes;
  if (!scopes || scopes.length === 0) {
    try {
      const ti = (await ctx.http.get(
        APIS.www,
        "/oauth2/v3/tokeninfo",
        { access_token: token.accessToken },
        { api: APIS.www, tool: "google_whoami" },
      )) as { scope?: string };
      scopes = ti.scope ? ti.scope.split(/\s+/).filter(Boolean) : [];
    } catch {
      scopes = [];
    }
  }

  return okEnvelope("google_whoami", {
    data: {
      email: info.email ?? token.email ?? null,
      sub: info.sub ?? null,
      granted_scopes: scopes,
      expires_in: token.expiresIn ?? null,
      token_source: token.source,
      connections: [
        {
          provider: "google",
          email_or_id: info.email ?? token.email ?? info.sub ?? null,
          scopes,
          expires_in: token.expiresIn ?? null,
        },
      ],
      license: {
        ok: ctx.license.ok,
        features: ctx.license.features,
        exp: ctx.license.exp ?? null,
      },
    },
  });
}
