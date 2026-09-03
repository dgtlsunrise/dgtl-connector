import type { ErrorCode, ErrorExtra } from "./errors.js";

export type ResourceRef = {
  type: string;
  id: string;
  display_name: string;
};

export type PageInfo = {
  next_page_token?: string;
  truncated: boolean;
  row_count: number;
};

export type Envelope = {
  ok: boolean;
  tool: string;
  resource?: ResourceRef;
  data?: unknown;
  page?: PageInfo;
  quota?: unknown;
  error_code?: ErrorCode;
  message?: string;
  hint?: string;
  google_status?: number;
  google_reason?: string;
  api?: string;
  resource_id?: string;
  missing_scope?: string;
};

export function okEnvelope(
  tool: string,
  opts: {
    data?: unknown;
    resource?: ResourceRef;
    page?: PageInfo;
    quota?: unknown;
  } = {},
): Envelope {
  const env: Envelope = { ok: true, tool };
  if (opts.resource) env.resource = opts.resource;
  if (opts.data !== undefined) env.data = opts.data;
  if (opts.page) env.page = opts.page;
  if (opts.quota !== undefined) env.quota = opts.quota;
  return env;
}

export function failEnvelope(
  tool: string,
  code: ErrorCode,
  message: string,
  extra: ErrorExtra = {},
): Envelope {
  const env: Envelope = { ok: false, tool, error_code: code, message };
  if (extra.hint) env.hint = extra.hint;
  if (extra.google_status !== undefined) env.google_status = extra.google_status;
  if (extra.google_reason) env.google_reason = extra.google_reason;
  if (extra.api) env.api = extra.api;
  if (extra.resource_id) env.resource_id = extra.resource_id;
  if (extra.missing_scope) env.missing_scope = extra.missing_scope;
  return env;
}

export function pageFromList(
  items: unknown[],
  total: number,
  next?: string,
): PageInfo {
  return {
    row_count: total,
    truncated: Boolean(next) || items.length < total,
    ...(next ? { next_page_token: next } : {}),
  };
}
