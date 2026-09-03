import { createServer } from "node:http";
import { buildGoogleAuthUrl, exchangeAuthorizationCode, generatePkce } from "./pkce.js";
import { writeStore } from "./store.js";
import { CONSENT_A } from "../google/scopes.js";

/**
 * Installed-app PKCE fallback. Documented advanced path — not a Connect card.
 * Tokens land in PLUGIN_DATA. Refresh token is never printed.
 */
export async function runAuthLogin(opts: {
  clientId: string;
  pluginDataDir: string;
  fetchImpl: typeof fetch;
}): Promise<number> {
  const pkce = generatePkce();
  let redirectUri = "";
  const server = createServer();
  const done = new Promise<number>((resolve, reject) => {
    server.on("error", reject);
    server.on("request", async (req, res) => {
      try {
        const u = new URL(req.url ?? "/", "http://127.0.0.1");
        if (u.pathname !== "/callback") {
          res.statusCode = 404;
          res.end("not found");
          return;
        }
        const err = u.searchParams.get("error");
        const code = u.searchParams.get("code");
        const state = u.searchParams.get("state");
        if (err) {
          res.end("Authorization failed. You can close this tab.");
          process.stderr.write(`auth error: ${err}\n`);
          server.close(() => resolve(1));
          return;
        }
        if (!code || state !== pkce.state) {
          res.statusCode = 400;
          res.end("state mismatch");
          server.close(() => resolve(1));
          return;
        }
        const tokens = await exchangeAuthorizationCode(
          {
            clientId: opts.clientId,
            code,
            verifier: pkce.verifier,
            redirectUri,
          },
          opts.fetchImpl,
        );
        writeStore(opts.pluginDataDir, {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expiry: Date.now() + (tokens.expires_in ?? 3600) * 1000,
          scopes: tokens.scope?.split(/\s+/).filter(Boolean),
          token_type: tokens.token_type,
        });
        res.end("DGTL marketing: Google authorization saved on this computer. You can close this tab.");
        process.stderr.write("Authorization saved to PLUGIN_DATA (refresh token not logged).\n");
        server.close(() => resolve(0));
      } catch (e) {
        res.statusCode = 500;
        res.end("token exchange failed");
        process.stderr.write(`token exchange failed: ${e instanceof Error ? e.message : String(e)}\n`);
        server.close(() => resolve(1));
      }
    });
    const redirectPortRaw = process.env.GOOGLE_OAUTH_REDIRECT_PORT;
    const redirectPort =
      redirectPortRaw !== undefined && redirectPortRaw !== ""
        ? Number.parseInt(redirectPortRaw, 10)
        : 0;
    const listenPort = Number.isInteger(redirectPort) && redirectPort >= 0 ? redirectPort : 0;
    server.listen(listenPort, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("failed to bind loopback"));
        return;
      }
      redirectUri = `http://127.0.0.1:${addr.port}/callback`;
      const url = buildGoogleAuthUrl({
        clientId: opts.clientId,
        redirectUri,
        challenge: pkce.challenge,
        state: pkce.state,
        scopes: CONSENT_A,
      });
      process.stderr.write("Open this URL in a browser (installed-app PKCE; not a Gmail Connect card):\n");
      process.stderr.write(`${url}\n`);
    });
  });
  return await done;
}

export function helpText(): string {
  return `dgtl-marketing-mcp — local stdio MCP for GA4, Search Console, Tag Manager

USAGE
  dgtl-marketing-mcp              Start MCP on stdio (hosts spawn this)
  dgtl-marketing-mcp --help       Show this help and exit 0
  dgtl-marketing-mcp --version    Print version
  dgtl-marketing-mcp auth login   Installed-app PKCE fallback (loopback)
  dgtl-marketing-mcp auth status  Show whether a token source is configured
  dgtl-marketing-mcp auth logout  Delete PLUGIN_DATA/google-oauth.json

AUTH (stdio is Manual — there is no Gmail-style Connect card)
  1. Host-injected: set GOOGLE_ACCESS_TOKEN (and optional GOOGLE_GRANTED_SCOPES)
  2. PKCE fallback: set GOOGLE_OAUTH_CLIENT_ID (public Desktop client, no secret)
     then run auth login. Tokens stay in PLUGIN_DATA on this computer.

Paid Google Ads / Meta tools are listed and return LICENSE_REQUIRED until a
DGTL license JWT is present. This binary never ships a developer-token.
`;
}
