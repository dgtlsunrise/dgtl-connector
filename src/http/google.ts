import { MSG, ToolError, consentMissing } from "../errors.js";
import { headerMap, type HttpCall } from "./calls.js";
import { mapGoogleHttpError } from "./map-error.js";
import type { AccessTokenSource } from "../auth/types.js";

/** Reactive backoff for 429/503 (Magdoub-inspired; no proactive token bucket). */
const MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(res: Response, attempt: number): number {
  const raw = res.headers.get("retry-after");
  if (raw) {
    const sec = Number(raw);
    if (Number.isFinite(sec) && sec >= 0) return Math.min(sec * 1000, 10_000);
  }
  return Math.min(BASE_BACKOFF_MS * 2 ** attempt, 5_000);
}

const ALLOWED_HOSTS = new Set([
  "analyticsadmin.googleapis.com",
  "analyticsdata.googleapis.com",
  "searchconsole.googleapis.com",
  "www.googleapis.com",
  "openidconnect.googleapis.com",
  "tagmanager.googleapis.com",
  "oauth2.googleapis.com",
  "accounts.google.com",
  "mybusinessaccountmanagement.googleapis.com",
  "mybusinessbusinessinformation.googleapis.com",
  "businessprofileperformance.googleapis.com",
]);

export type GoogleRequest = {
  method: "GET" | "POST";
  url: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  api: string;
  requiredScope?: string;
  tool: string;
};

export class GoogleHttp {
  constructor(
    private readonly opts: {
      tokenSource: AccessTokenSource;
      fetchImpl: typeof fetch;
      calls: HttpCall[];
      userAgent?: string;
    },
  ) {}

  get calls(): HttpCall[] {
    return this.opts.calls;
  }

  async request(req: GoogleRequest): Promise<unknown> {
    const token = await this.opts.tokenSource.getAccessToken();
    if (!token?.accessToken) {
      throw new ToolError("UNAUTHENTICATED", MSG.UNAUTHENTICATED);
    }
    if (req.requiredScope && token.scopes && token.scopes.length > 0) {
      if (!token.scopes.includes(req.requiredScope)) {
        throw consentMissing(req.requiredScope);
      }
    }

    const url = new URL(req.url);
    if (!ALLOWED_HOSTS.has(url.hostname)) {
      throw new ToolError("UNSUPPORTED_OPERATION", `Refusing to call non-allowlisted host ${url.hostname}`, {
        api: req.api,
      });
    }
    // Consent A is readonly for Tag Manager — mutates go through GoogleWriteHttp + Consent W.
    if (url.hostname === "tagmanager.googleapis.com" && req.method !== "GET") {
      throw new ToolError(
        "UNSUPPORTED_OPERATION",
        "Consent A GoogleHttp cannot POST/PUT Tag Manager. Use GoogleWriteHttp with Consent W.",
        { api: req.api },
      );
    }
    if (req.query) {
      for (const [k, v] of Object.entries(req.query)) {
        if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
      }
    }

    const headers: Record<string, string> = {
      authorization: `Bearer ${token.accessToken}`,
      accept: "application/json",
      "user-agent": this.opts.userAgent ?? "dgtl-connector/0.1.0",
    };
    let body: string | undefined;
    if (req.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(req.body);
    }

    const headerNames = Object.keys(headers);

    let lastStatus = 0;
    let parsed: unknown = undefined;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      this.opts.calls.push({
        method: req.method,
        host: url.hostname,
        path: url.pathname,
        search: url.search.replace(/access_token=[^&]+/gi, "access_token=REDACTED"),
        headerNames,
        hasAuthorization: true,
        hasDeveloperToken: headerNames.some((n) => n.toLowerCase() === "developer-token"),
      });
      const res = await this.opts.fetchImpl(url.toString(), {
        method: req.method,
        headers,
        body,
      });
      lastStatus = res.status;
      const text = await res.text();
      parsed = undefined;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { raw: text };
        }
      }
      if (res.ok) return parsed;
      const retryable = res.status === 429 || res.status === 503;
      if (retryable && attempt < MAX_RETRIES) {
        await sleep(retryAfterMs(res, attempt));
        continue;
      }
      throw mapGoogleHttpError({ status: res.status, body: parsed, api: req.api });
    }
    throw mapGoogleHttpError({ status: lastStatus || 503, body: parsed, api: req.api });
  }

  get(apiHost: string, path: string, query: Record<string, string | number | undefined> | undefined, meta: { api: string; requiredScope?: string; tool: string }): Promise<unknown> {
    return this.request({
      method: "GET",
      url: `https://${apiHost}${path}`,
      query,
      api: meta.api,
      requiredScope: meta.requiredScope,
      tool: meta.tool,
    });
  }

  post(apiHost: string, path: string, body: unknown, meta: { api: string; requiredScope?: string; tool: string }): Promise<unknown> {
    return this.request({
      method: "POST",
      url: `https://${apiHost}${path}`,
      body,
      api: meta.api,
      requiredScope: meta.requiredScope,
      tool: meta.tool,
    });
  }
}
