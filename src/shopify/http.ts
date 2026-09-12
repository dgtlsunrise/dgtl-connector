import { MSG, ToolError } from "../errors.js";
import type { HttpCall } from "../http/calls.js";
import { headerMap } from "../http/calls.js";
import type { ShopifyCredentials } from "./auth.js";
import { SHOPIFY_API_VERSION } from "./auth.js";
import { ALLOWED_MUTATIONS, ALLOWED_OPERATIONS, DOC_BY_OP, MUTATION_DOC_BY_OP } from "./queries.js";

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

function stripGraphql(document: string): string {
  return document.replace(/#[^\n]*/g, " ").replace(/\s+/g, " ").trim();
}

/** Refuse anything that looks like a GraphQL mutation or non-allowlisted op. */
export function assertReadOnlyDocument(operation: string, document: string): void {
  if (!ALLOWED_OPERATIONS.has(operation)) {
    throw new ToolError("UNSUPPORTED_OPERATION", `Shopify operation ${operation} is not allowlisted`, {
      api: "shopify-admin-graphql",
    });
  }
  const stripped = stripGraphql(document);
  if (/\bmutation\b/i.test(stripped)) {
    throw new ToolError(
      "UNSUPPORTED_OPERATION",
      "Shopify read client refuses mutations; use the write path after DGTL_WRITES_ENABLED + write_inventory + shop-domain confirm",
      { api: "shopify-admin-graphql" },
    );
  }
  if (!new RegExp(`\\bquery\\s+${operation}\\b`, "i").test(stripped) && !stripped.startsWith("{")) {
    // Named query must match operation key.
    if (!stripped.toLowerCase().includes(`query ${operation.toLowerCase()}`)) {
      throw new ToolError("UNSUPPORTED_OPERATION", `Document does not match operation ${operation}`, {
        api: "shopify-admin-graphql",
      });
    }
  }
}

/** Allowlisted named mutations only. Read documents are refused here. */
export function assertMutationDocument(operation: string, document: string): void {
  if (!ALLOWED_MUTATIONS.has(operation)) {
    throw new ToolError("UNSUPPORTED_OPERATION", `Shopify mutation ${operation} is not allowlisted`, {
      api: "shopify-admin-graphql",
    });
  }
  const stripped = stripGraphql(document);
  if (/\bquery\b/i.test(stripped) && !/\bmutation\b/i.test(stripped)) {
    throw new ToolError("UNSUPPORTED_OPERATION", "Write path refuses query documents", {
      api: "shopify-admin-graphql",
    });
  }
  if (!/\bmutation\b/i.test(stripped)) {
    throw new ToolError("UNSUPPORTED_OPERATION", `Document is not a mutation (${operation})`, {
      api: "shopify-admin-graphql",
    });
  }
  if (!stripped.toLowerCase().includes(`mutation ${operation.toLowerCase()}`)) {
    throw new ToolError("UNSUPPORTED_OPERATION", `Document does not match mutation ${operation}`, {
      api: "shopify-admin-graphql",
    });
  }
}

export type ShopifyGraphqlResult = {
  data?: Record<string, unknown>;
  errors?: Array<{ message?: string; extensions?: { code?: string } }>;
};

export class ShopifyHttp {
  constructor(
    private readonly opts: {
      credentials: ShopifyCredentials;
      fetchImpl: typeof fetch;
      calls: HttpCall[];
      userAgent?: string;
    },
  ) {}

  async graphql(opts: {
    operation: string;
    variables?: Record<string, unknown>;
    tool: string;
  }): Promise<Record<string, unknown>> {
    const document = DOC_BY_OP[opts.operation];
    if (!document) {
      throw new ToolError("UNSUPPORTED_OPERATION", `Unknown Shopify operation ${opts.operation}`, {
        api: "shopify-admin-graphql",
      });
    }
    assertReadOnlyDocument(opts.operation, document);
    return this.postGraphql(opts.operation, document, opts.variables);
  }

  async graphqlMutation(opts: {
    operation: string;
    variables?: Record<string, unknown>;
    tool: string;
  }): Promise<Record<string, unknown>> {
    const document = MUTATION_DOC_BY_OP[opts.operation];
    if (!document) {
      throw new ToolError("UNSUPPORTED_OPERATION", `Unknown Shopify mutation ${opts.operation}`, {
        api: "shopify-admin-graphql",
      });
    }
    assertMutationDocument(opts.operation, document);
    return this.postGraphql(opts.operation, document, opts.variables);
  }

  private async postGraphql(
    operation: string,
    document: string,
    variables?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const url = new URL(
      `https://${this.opts.credentials.storeHost}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    );
    if (url.hostname !== this.opts.credentials.storeHost) {
      throw new ToolError("UNSUPPORTED_OPERATION", "Refusing Shopify host mismatch", {
        api: "shopify-admin-graphql",
      });
    }

    const headers: Record<string, string> = {
      "X-Shopify-Access-Token": this.opts.credentials.accessToken,
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": this.opts.userAgent ?? "dgtl-connector/0.1.0",
    };
    const body = JSON.stringify({
      query: document,
      variables: variables ?? {},
      operationName: operation,
    });

    let lastStatus = 0;
    let parsed: ShopifyGraphqlResult | undefined;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      this.opts.calls.push({
        method: "POST",
        host: url.hostname,
        path: url.pathname,
        search: "",
        headerNames: Object.keys(headers).map((h) =>
          h.toLowerCase() === "x-shopify-access-token" ? "x-shopify-access-token" : h,
        ),
        hasAuthorization: false,
        hasDeveloperToken: false,
      });
      const res = await this.opts.fetchImpl(url.toString(), {
        method: "POST",
        headers,
        body,
      });
      lastStatus = res.status;
      const text = await res.text();
      try {
        parsed = JSON.parse(text) as ShopifyGraphqlResult;
      } catch {
        parsed = undefined;
      }

      if (res.status === 429 || res.status === 503) {
        if (attempt < MAX_RETRIES) {
          await sleep(retryAfterMs(res, attempt));
          continue;
        }
      }
      break;
    }

    if (lastStatus === 401) {
      throw new ToolError(
        "REAUTH_REQUIRED",
        "Shopify access token was rejected. Re-set SHOPIFY_ACCESS_TOKEN or refresh PLUGIN_DATA/shopify-oauth.json.",
        {
          google_status: 401,
          api: "shopify-admin-graphql",
          hint: "Support never collects Shopify tokens. This is not a Google Consent A reconnect.",
        },
      );
    }
    if (lastStatus === 403) {
      throw new ToolError("SHOPIFY_SCOPE_MISSING", MSG.SHOPIFY_SCOPE_MISSING, {
        google_status: 403,
        api: "shopify-admin-graphql",
        hint: "Merchant custom app needs the matching Admin scope (read_products / read_orders / read_inventory / read_locations, or write_inventory for writes). write_* is opt-in — not the default install.",
      });
    }
    if (lastStatus === 429) {
      throw new ToolError("RATE_LIMITED", MSG.QUOTA, {
        google_status: 429,
        api: "shopify-admin-graphql",
      });
    }
    if (lastStatus >= 500) {
      throw new ToolError("GOOGLE_UNAVAILABLE", "Shopify Admin API returned a server error. Retry once.", {
        google_status: lastStatus,
        api: "shopify-admin-graphql",
      });
    }
    if (lastStatus >= 400) {
      throw new ToolError("INVALID_ARGUMENT", `Shopify HTTP ${lastStatus}`, {
        google_status: lastStatus,
        api: "shopify-admin-graphql",
      });
    }

    const errors = parsed?.errors;
    if (Array.isArray(errors) && errors.length) {
      const msg = errors.map((e) => e.message).filter(Boolean).join("; ") || "Shopify GraphQL error";
      const code = errors[0]?.extensions?.code ?? "";
      const lower = `${code} ${msg}`.toLowerCase();
      if (/access.?denied|forbidden|scope/.test(lower)) {
        throw new ToolError("SHOPIFY_SCOPE_MISSING", MSG.SHOPIFY_SCOPE_MISSING, {
          api: "shopify-admin-graphql",
          google_reason: code || undefined,
          hint: msg,
        });
      }
      if (/throttl|rate.?limit/.test(lower)) {
        throw new ToolError("RATE_LIMITED", MSG.QUOTA, {
          api: "shopify-admin-graphql",
          google_reason: code || undefined,
        });
      }
      if (/not.?found|does not exist/.test(lower)) {
        throw new ToolError("NOT_FOUND", MSG.NOT_FOUND, {
          api: "shopify-admin-graphql",
          google_reason: code || undefined,
          hint: msg,
        });
      }
      throw new ToolError("INVALID_ARGUMENT", msg, {
        api: "shopify-admin-graphql",
        google_reason: code || undefined,
      });
    }

    if (!parsed?.data || typeof parsed.data !== "object") {
      throw new ToolError("GOOGLE_UNAVAILABLE", "Shopify GraphQL returned no data", {
        api: "shopify-admin-graphql",
      });
    }
    return parsed.data;
  }
}

/** Test helper: ensure fixture/fetch never sees raw token in logged header map values. */
export function redactedShopifyHeaders(initHeaders: Parameters<typeof headerMap>[0]): Record<string, string> {
  const h = headerMap(initHeaders);
  if (h["x-shopify-access-token"]) h["x-shopify-access-token"] = "REDACTED";
  return h;
}
