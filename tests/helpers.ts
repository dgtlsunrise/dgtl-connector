import { createPrivateKey, sign as nodeSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAppContext, type AppContext } from "../src/context.js";
import { headerMap, type HttpCall } from "../src/http/calls.js";
import { LICENSE_ISSUER } from "../src/license/embedded-public-key.js";
import { SCOPE } from "../src/google/scopes.js";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const FIXTURES = join(ROOT, "fixtures/google");

/** PKCS8 DER (no PEM) matching src/license/embedded-public-key.ts. Test issuer only. */
export const TEST_LICENSE_PKCS8_B64 =
  "MC4CAQAwBQYDK2VwBCIEIF6OAvhiTwaARYQC9GZeyvmcax/9qL0k6ghbL33hN8Hy";

export const TEST_TOKEN = "test-access-token-not-a-google-token";

export const ALL_SCOPES = [
  SCOPE.openid,
  SCOPE.email,
  SCOPE.analytics,
  SCOPE.webmasters,
  SCOPE.tagmanager,
].join(" ");

export function loadFixture(rel: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, rel), "utf8"));
}

export type FixtureOpts = {
  gtmForbidden?: boolean;
  emptyReport?: boolean;
  emptyList?: boolean;
  emptyGscQuery?: boolean;
  oversizeTags?: boolean;
  agencySummaries?: boolean;
};

export function installNetworkGuard(): () => void {
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    throw new Error(`NETWORK_FORBIDDEN global fetch: ${url}`);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = orig;
  };
}

export function createFixtureFetch(opts: FixtureOpts = {}): {
  fetchImpl: typeof fetch;
  calls: HttpCall[];
} {
  const calls: HttpCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const method = (init?.method ?? "GET").toUpperCase();
    if (
      !url.hostname.endsWith("googleapis.com") &&
      url.hostname !== "accounts.google.com" &&
      url.hostname !== "openidconnect.googleapis.com"
    ) {
      throw new Error(`NETWORK_FORBIDDEN ${url.href}`);
    }
    const headers = headerMap(init?.headers);
    if (Object.keys(headers).some((k) => k === "developer-token" || headers[k]?.length && k === "developer-token")) {
      throw new Error("developer-token must not appear on the client");
    }
    if (headers["developer-token"]) {
      throw new Error("developer-token must not appear on the client");
    }
    calls.push({
      method,
      host: url.hostname,
      path: url.pathname,
      search: url.search,
      headerNames: Object.keys(headers),
      hasAuthorization: Boolean(headers.authorization),
      hasDeveloperToken: false,
    });

    const body = route(method, url, opts);
    const status = (body as { __status?: number }).__status ?? 200;
    if (body && typeof body === "object" && "__status" in body) {
      delete (body as { __status?: number }).__status;
    }
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetchImpl, calls };
}

function route(method: string, url: URL, opts: FixtureOpts): unknown {
  const p = url.pathname;
  const host = url.hostname;

  if (host.includes("openidconnect") && p.endsWith("/userinfo")) {
    return { email: "user@example.com", sub: "000000000000000000000" };
  }
  if (p.includes("/oauth2/v3/tokeninfo") || p.includes("/tokeninfo")) {
    return { scope: ALL_SCOPES, email: "user@example.com" };
  }
  if (host === "oauth2.googleapis.com" && p.endsWith("/token")) {
    return {
      access_token: "test-refreshed-access-token",
      expires_in: 3600,
      token_type: "Bearer",
      scope: ALL_SCOPES,
    };
  }

  if (opts.gtmForbidden && host.includes("tagmanager")) {
    const err = loadFixture("errors/accessNotConfigured.tagmanager.json") as { error: unknown };
    return { ...err, __status: 403 };
  }

  if (host.includes("analyticsadmin")) {
    if (p.endsWith("/accounts") && method === "GET") {
      return opts.emptyList ? { accounts: [] } : loadFixture("ga4/accounts.list.json");
    }
    if (p.endsWith("/accountSummaries")) {
      return opts.emptyList ? { accountSummaries: [] } : loadFixture("ga4/accountSummaries.list.json");
    }
    if (/\/properties\/\d+$/.test(p) && method === "GET") {
      const id = p.split("/").pop();
      const base = loadFixture("ga4/properties.get.json") as Record<string, unknown>;
      return { ...base, name: `properties/${id}` };
    }
    if (p.endsWith("/dataStreams")) {
      return opts.emptyList ? { dataStreams: [] } : loadFixture("ga4/dataStreams.list.json");
    }
    if (p.endsWith("/keyEvents")) {
      return opts.emptyList ? { keyEvents: [] } : loadFixture("ga4/keyEvents.list.json");
    }
    if (p.endsWith("/properties") && method === "GET") {
      return opts.emptyList ? { properties: [] } : loadFixture("ga4/properties.list.json");
    }
  }

  if (host.includes("analyticsdata")) {
    if (p.endsWith("/metadata")) return loadFixture("ga4/metadata.json");
    if (p.includes(":runReport")) {
      return opts.emptyReport ? loadFixture("ga4/runReport.empty.json") : loadFixture("ga4/runReport.json");
    }
  }

  if (host.includes("searchconsole") || p.startsWith("/webmasters/")) {
    if (p.endsWith("/sites") && method === "GET") {
      return opts.emptyList ? { siteEntry: [] } : loadFixture("gsc/sites.list.json");
    }
    if (p.includes("/searchAnalytics/query")) {
      return opts.emptyGscQuery ? { rows: [] } : loadFixture("gsc/searchanalytics.query.json");
    }
    if (p.includes("urlInspection")) return loadFixture("gsc/urlInspection.inspect.json");
    if (/\/sitemaps\/.+/.test(p)) return loadFixture("gsc/sitemaps.get.json");
    if (p.endsWith("/sitemaps")) return loadFixture("gsc/sitemaps.list.json");
    if (p.includes("/sites/") && method === "GET") return loadFixture("gsc/sites.get.json");
  }

  if (host.includes("tagmanager")) {
    if (p.endsWith("/accounts")) {
      return opts.emptyList ? { account: [] } : loadFixture("gtm/accounts.list.json");
    }
    if (/\/containers\/[^/]+$/.test(p) && method === "GET") return loadFixture("gtm/containers.get.json");
    if (p.endsWith("/containers")) {
      return opts.emptyList ? { container: [] } : loadFixture("gtm/containers.list.json");
    }
    if (/\/workspaces\/[^/]+$/.test(p) && method === "GET") return loadFixture("gtm/workspaces.get.json");
    if (p.endsWith("/workspaces")) {
      return opts.emptyList ? { workspace: [] } : loadFixture("gtm/workspaces.list.json");
    }
    if (p.endsWith("/tags") && method === "POST") return loadFixture("gtm/tags.create.json");
    if (/\/tags\/[^/]+$/.test(p) && method === "PUT") return loadFixture("gtm/tags.update.json");
    if (p.endsWith("/tags")) {
      return opts.oversizeTags ? loadFixture("gtm/tags.oversize.json") : loadFixture("gtm/tags.list.json");
    }
    if (p.endsWith("/triggers")) return loadFixture("gtm/triggers.list.json");
    if (p.endsWith("/variables")) return loadFixture("gtm/variables.list.json");
    if (p.endsWith("/versions:live") || p.endsWith("/versions/live")) return loadFixture("gtm/liveVersion.json");
    if (p.includes(":create_version") && method === "POST") return loadFixture("gtm/create_version.json");
    if (p.includes(":publish") && method === "POST") return loadFixture("gtm/versions.publish.json");
  }

  throw new Error(`UNMAPPED_FIXTURE ${method} ${host}${p}${url.search}`);
}

export function testEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GOOGLE_ACCESS_TOKEN: TEST_TOKEN,
    GOOGLE_GRANTED_SCOPES: ALL_SCOPES,
    PLUGIN_ROOT: ROOT,
    PLUGIN_DATA: join(ROOT, ".dgtl-plugin-data-test"),
    DGTL_LICENSE_JWT: "",
    ...extra,
  };
}

export function makeCtx(opts: FixtureOpts = {}, env: NodeJS.ProcessEnv = testEnv()): AppContext {
  const { fetchImpl } = createFixtureFetch(opts);
  return createAppContext({
    pluginRoot: ROOT,
    env,
    fetchImpl,
    now: () => new Date("2026-09-02T12:00:00Z"),
  });
}

export function signLicense(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "JWT", kid: "dev-1" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: LICENSE_ISSUER, ...claims })).toString("base64url");
  const key = createPrivateKey({
    key: Buffer.from(TEST_LICENSE_PKCS8_B64, "base64"),
    format: "der",
    type: "pkcs8",
  });
  const sig = nodeSign(null, Buffer.from(`${header}.${payload}`), key);
  return `${header}.${payload}.${sig.toString("base64url")}`;
}

export function reportArgs(propertyId = "properties/111111111"): Record<string, unknown> {
  return {
    property_id: propertyId,
    date_ranges: [{ start_date: "2026-08-01", end_date: "2026-08-31" }],
    metrics: ["sessions"],
    dimensions: ["sessionDefaultChannelGroup"],
  };
}
