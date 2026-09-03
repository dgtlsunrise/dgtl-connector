import { MSG, ToolError, consentMissing } from "../errors.js";

type GoogleErrorBody = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: Array<{
      reason?: string;
      domain?: string;
      metadata?: { service?: string };
      "@type"?: string;
    }>;
    errors?: Array<{ reason?: string; message?: string }>;
  };
};

function reasonFrom(body: GoogleErrorBody | undefined): string | undefined {
  const details = body?.error?.details;
  if (Array.isArray(details)) {
    for (const d of details) {
      if (d.reason) return d.reason;
    }
  }
  const errors = body?.error?.errors;
  if (Array.isArray(errors) && errors[0]?.reason) return errors[0].reason;
  return body?.error?.status;
}

export function mapGoogleHttpError(opts: {
  status: number;
  body: unknown;
  api: string;
}): ToolError {
  const body = opts.body as GoogleErrorBody | undefined;
  const reason = reasonFrom(body) ?? "";
  const message = body?.error?.message ?? `Google HTTP ${opts.status}`;
  const extra = {
    google_status: opts.status,
    google_reason: reason || undefined,
    api: opts.api,
  };

  const lower = `${reason} ${message}`.toLowerCase();

  if (opts.status === 401 || /invalid.?token|unauthenticated|invalid_grant/.test(lower)) {
    return new ToolError("REAUTH_REQUIRED", MSG.REAUTH_REQUIRED, extra);
  }
  if (/accessnotconfigured|has not been used in project|api has not been used/.test(lower)) {
    return new ToolError("ACCESS_NOT_CONFIGURED", MSG.ACCESS_NOT_CONFIGURED, {
      ...extra,
      hint: "If you are using the published plugin, this is a publisher defect. Email noel@dgtlsunrise.com with plugin version, api, and error_code — not tokens. Local harness: enable Analytics Admin, Analytics Data, Search Console, and Tag Manager APIs.",
    });
  }
  if (/access_token_scope_insufficient|insufficient.?scope|insufficientauthentication/.test(lower)) {
    return consentMissing(guessScope(opts.api));
  }
  if (opts.status === 403) {
    return new ToolError("PERMISSION_DENIED", MSG.PERMISSION_DENIED, extra);
  }
  if (opts.status === 404) {
    return new ToolError("NOT_FOUND", MSG.NOT_FOUND, extra);
  }
  if (opts.status === 400) {
    return new ToolError("INVALID_ARGUMENT", message || MSG.INVALID_ARGUMENT, extra);
  }
  if (opts.status === 429 || /quota|rate.?limit|resource.?exhausted/.test(lower)) {
    const code = /quota/.test(lower) ? "QUOTA_EXCEEDED" : "RATE_LIMITED";
    return new ToolError(code, MSG.QUOTA, extra);
  }
  if (opts.status >= 500) {
    return new ToolError("GOOGLE_UNAVAILABLE", MSG.GOOGLE_UNAVAILABLE, extra);
  }
  return new ToolError("PERMISSION_DENIED", message, extra);
}

function guessScope(api: string): string {
  if (api.includes("tagmanager")) return "https://www.googleapis.com/auth/tagmanager.readonly";
  if (api.includes("searchconsole") || api.includes("webmasters")) {
    return "https://www.googleapis.com/auth/webmasters.readonly";
  }
  if (api.includes("analytics")) return "https://www.googleapis.com/auth/analytics.readonly";
  return api;
}
