import { MSG, ToolError, consentMissing } from "../errors.js";
import type { HttpCall } from "./calls.js";
import { mapGoogleHttpError } from "./map-error.js";
import { requestWithRetry } from "./retry.js";
import type { AccessTokenSource } from "../auth/types.js";
import { APIS } from "../google/scopes.js";

const HOST = APIS.searchconsole;

export type GscWriteMethod = "PUT" | "DELETE";

export type GscWriteRequest = {
  method: GscWriteMethod;
  path: string;
  requiredScope?: string;
  tool: string;
};

/**
 * GSC write HTTP client — searchconsole.googleapis.com only.
 * Closed allowlist: sitemaps.submit (PUT) and sitemaps.delete (DELETE).
 * Uses authGscWrite (legacy S store, then Free Google when webmasters write is present).
 * No Indexing API. No sites.add/delete.
 */
const ALLOWED: Array<{ method: GscWriteMethod; pattern: RegExp }> = [
  { method: "PUT", pattern: /^\/webmasters\/v3\/sites\/[^/]+\/sitemaps\/[^/]+$/ },
  { method: "DELETE", pattern: /^\/webmasters\/v3\/sites\/[^/]+\/sitemaps\/[^/]+$/ },
];

function pathAllowed(method: GscWriteMethod, path: string): boolean {
  return ALLOWED.some((a) => a.method === method && a.pattern.test(path));
}

export class GoogleGscWriteHttp {
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

  async request(req: GscWriteRequest): Promise<unknown> {
    const token = await this.opts.tokenSource.getAccessToken();
    if (!token?.accessToken) {
      throw new ToolError("CONSENT_S_REQUIRED", MSG.CONSENT_S_REQUIRED, {
        api: HOST,
      });
    }
    if (req.requiredScope && token.scopes && token.scopes.length > 0) {
      if (!token.scopes.includes(req.requiredScope)) {
        throw consentMissing(req.requiredScope);
      }
    }

    const path = req.path.startsWith("/") ? req.path : `/${req.path}`;
    if (!pathAllowed(req.method, path)) {
      throw new ToolError(
        "UNSUPPORTED_OPERATION",
        `GoogleGscWriteHttp refuses ${req.method} ${path} (not on the Consent S sitemap path allowlist).`,
        { api: HOST },
      );
    }

    const url = new URL(`https://${HOST}${path}`);
    const headers: Record<string, string> = {
      authorization: `Bearer ${token.accessToken}`,
      accept: "application/json",
      "user-agent": this.opts.userAgent ?? "dgtl-connector/0.1.0",
    };

    const headerNames = Object.keys(headers);
    const { res, parsed } = await requestWithRetry({
      fetchImpl: this.opts.fetchImpl,
      url: url.toString(),
      init: { method: req.method, headers },
      onAttempt: () => {
        this.opts.calls.push({
          method: req.method,
          host: url.hostname,
          path: url.pathname,
          search: url.search.replace(/access_token=[^&]+/gi, "access_token=REDACTED"),
          headerNames,
          hasAuthorization: true,
          hasDeveloperToken: headerNames.some((n) => n.toLowerCase() === "developer-token"),
        });
      },
    });
    if (!res.ok) {
      throw mapGoogleHttpError({
        status: res.status,
        body: parsed,
        api: HOST,
      });
    }
    return parsed ?? {};
  }

  put(path: string, meta: { requiredScope?: string; tool: string }): Promise<unknown> {
    return this.request({
      method: "PUT",
      path,
      requiredScope: meta.requiredScope,
      tool: meta.tool,
    });
  }

  delete(path: string, meta: { requiredScope?: string; tool: string }): Promise<unknown> {
    return this.request({
      method: "DELETE",
      path,
      requiredScope: meta.requiredScope,
      tool: meta.tool,
    });
  }
}

/** Exported for unit tests of the allowlist. */
export function googleGscWritePathAllowed(method: GscWriteMethod, path: string): boolean {
  return pathAllowed(method, path);
}
