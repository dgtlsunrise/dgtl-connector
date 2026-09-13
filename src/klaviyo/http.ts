import { MSG, ToolError } from "../errors.js";
import type { HttpCall } from "../http/calls.js";
import { headerMap } from "../http/calls.js";
import {
  KLAVIYO_API_HOST,
  KLAVIYO_API_REVISION,
  type KlaviyoCredentials,
} from "./auth.js";

const MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 400;

const READ_PATHS = new Set([
  "/api/accounts",
  "/api/profiles",
  "/api/lists",
  "/api/segments",
  "/api/flows",
  "/api/campaigns",
  "/api/metrics",
]);

const WRITE_PATHS = new Set(["/api/campaigns", "/api/profile-import", "/api/events"]);

const ID_PATH = /^\/api\/(profiles|flows)\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

const FORBIDDEN_PATH_NEEDLES = [
  "campaign-send-jobs",
  "campaign-recipient-estimation",
  "catalog",
  "reviews",
  "coupons",
  "oauth",
];

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

export function assertKlaviyoPath(path: string, method: "GET" | "POST"): void {
  const lower = path.toLowerCase();
  for (const needle of FORBIDDEN_PATH_NEEDLES) {
    if (lower.includes(needle)) {
      throw new ToolError(
        "UNSUPPORTED_OPERATION",
        "Klaviyo catalog, reviews, OAuth, and campaign send jobs are out of Wave 18",
        { api: "klaviyo" },
      );
    }
  }
  if (method === "GET") {
    if (READ_PATHS.has(path) || ID_PATH.test(path)) return;
    throw new ToolError("UNSUPPORTED_OPERATION", `Klaviyo GET path ${path} is not allowlisted`, {
      api: "klaviyo",
    });
  }
  if (WRITE_PATHS.has(path)) return;
  throw new ToolError("UNSUPPORTED_OPERATION", `Klaviyo POST path ${path} is not allowlisted`, {
    api: "klaviyo",
  });
}

function mapStatus(status: number, detail: string): ToolError {
  if (status === 401) {
    return new ToolError(
      "REAUTH_REQUIRED",
      "Klaviyo private key was rejected. Re-set KLAVIYO_API_KEY or PLUGIN_DATA/klaviyo.json.",
      {
        google_status: 401,
        api: "klaviyo",
        hint: "Support never collects Klaviyo keys. This is not a Google Consent A reconnect. No Polar OAuth in Wave 18.",
      },
    );
  }
  if (status === 403) {
    return new ToolError("KLAVIYO_SCOPE_MISSING", MSG.KLAVIYO_SCOPE_MISSING, {
      google_status: 403,
      api: "klaviyo",
      hint: detail || "Private key needs the matching accounts/profiles/lists/flows/campaigns/metrics/events scope.",
    });
  }
  if (status === 404) {
    return new ToolError("NOT_FOUND", MSG.NOT_FOUND, {
      google_status: 404,
      api: "klaviyo",
      hint: detail || "Copy the id from a Klaviyo list tool.",
    });
  }
  if (status === 429) {
    return new ToolError("RATE_LIMITED", MSG.QUOTA, { google_status: 429, api: "klaviyo" });
  }
  if (status >= 500) {
    return new ToolError("GOOGLE_UNAVAILABLE", "Klaviyo API returned a server error. Retry once.", {
      google_status: status,
      api: "klaviyo",
    });
  }
  return new ToolError("INVALID_ARGUMENT", detail || `Klaviyo HTTP ${status}`, {
    google_status: status,
    api: "klaviyo",
  });
}

function errorDetail(parsed: unknown): string {
  if (!parsed || typeof parsed !== "object") return "";
  const errors = (parsed as { errors?: Array<{ detail?: string; title?: string; code?: string }> }).errors;
  if (!Array.isArray(errors) || !errors.length) return "";
  return errors
    .map((e) => e.detail || e.title || e.code)
    .filter(Boolean)
    .join("; ");
}

export type KlaviyoJson = {
  data?: unknown;
  links?: { next?: string | null; prev?: string | null; self?: string | null };
  errors?: Array<{ detail?: string; title?: string; code?: string }>;
};

export class KlaviyoHttp {
  constructor(
    private readonly opts: {
      credentials: KlaviyoCredentials;
      fetchImpl: typeof fetch;
      calls: HttpCall[];
      userAgent?: string;
    },
  ) {}

  async get(path: string, query?: Record<string, string | undefined>): Promise<KlaviyoJson> {
    return this.request("GET", path, query);
  }

  async post(path: string, body: Record<string, unknown>): Promise<KlaviyoJson> {
    return this.request("POST", path, undefined, body);
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    query?: Record<string, string | undefined>,
    body?: Record<string, unknown>,
  ): Promise<KlaviyoJson> {
    assertKlaviyoPath(path, method);
    const url = new URL(`https://${KLAVIYO_API_HOST}${path}`);
    if (url.hostname !== KLAVIYO_API_HOST) {
      throw new ToolError("UNSUPPORTED_OPERATION", "Refusing Klaviyo host mismatch", { api: "klaviyo" });
    }
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== "") url.searchParams.set(k, v);
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Klaviyo-API-Key ${this.opts.credentials.apiKey}`,
      accept: "application/vnd.api+json",
      revision: KLAVIYO_API_REVISION,
      "user-agent": this.opts.userAgent ?? "dgtl-connector/0.1.0",
    };
    if (method === "POST") {
      headers["content-type"] = "application/vnd.api+json";
    }

    let lastStatus = 0;
    let parsed: KlaviyoJson | undefined;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      this.opts.calls.push({
        method,
        host: url.hostname,
        path: url.pathname,
        search: url.search,
        headerNames: Object.keys(headers).map((h) => h.toLowerCase()),
        hasAuthorization: true,
        hasDeveloperToken: false,
      });
      const res = await this.opts.fetchImpl(url.toString(), {
        method,
        headers,
        body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      });
      lastStatus = res.status;
      const text = await res.text();
      try {
        parsed = text ? (JSON.parse(text) as KlaviyoJson) : {};
      } catch {
        parsed = undefined;
      }

      if ((res.status === 429 || res.status === 503) && attempt < MAX_RETRIES) {
        await sleep(retryAfterMs(res, attempt));
        continue;
      }
      break;
    }

    if (lastStatus === 202 && method === "POST") {
      return parsed ?? { data: { accepted: true } };
    }
    if (lastStatus >= 400) {
      throw mapStatus(lastStatus, errorDetail(parsed));
    }
    if (parsed?.errors?.length) {
      throw mapStatus(lastStatus || 400, errorDetail(parsed));
    }
    return parsed ?? {};
  }
}

/** Test helper: never leak the private key from logged header maps. */
export function redactedKlaviyoHeaders(initHeaders: Parameters<typeof headerMap>[0]): Record<string, string> {
  const h = headerMap(initHeaders);
  if (h.authorization) h.authorization = "REDACTED";
  return h;
}

export function pageCursorFromNext(next: string | null | undefined): string | undefined {
  if (!next || typeof next !== "string") return undefined;
  try {
    const u = new URL(next);
    return u.searchParams.get("page[cursor]") ?? undefined;
  } catch {
    return undefined;
  }
}
