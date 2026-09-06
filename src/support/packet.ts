import type { AppContext } from "../context.js";
import { okEnvelope, type Envelope } from "../envelope.js";
import { ERROR_CODES, type ErrorCode } from "../errors.js";
import { PLUGIN_VERSION, detectHost } from "../version.js";

/** Token-shaped / credential-shaped substrings. Never echo these. */
export const TOKENISH = /ya29\.|1\/\/|GOCSPX-|eyJ[A-Za-z0-9_-]+\.|Bearer\s|developer-token|AIza[0-9A-Za-z_-]{10,}/i;

export type SupportFields = {
  plugin_version: string;
  host: string | null;
  last_tool: string | null;
  error_code: ErrorCode | string | null;
  resource_id: string | null;
};

export function safeField(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  if (TOKENISH.test(trimmed)) return null;
  return trimmed;
}

export function safeErrorCode(value: unknown): ErrorCode | string | null {
  const s = safeField(value, 64);
  if (!s) return null;
  if ((ERROR_CODES as readonly string[]).includes(s)) return s as ErrorCode;
  // Allow unknown codes for intake, but never secret-shaped strings.
  if (/^[A-Z][A-Z0-9_]{1,48}$/.test(s)) return s;
  return null;
}

/**
 * Local support intake fields. No Google calls. Never returns tokens or JWT body.
 */
export function collectSupportFields(ctx: AppContext, args: Record<string, unknown>): SupportFields {
  return {
    plugin_version: PLUGIN_VERSION,
    host: detectHost(ctx.env),
    last_tool: safeField(args.last_tool, 80),
    error_code: safeErrorCode(args.error_code),
    resource_id: safeField(args.resource_id, 256),
  };
}

/**
 * Local support intake. No Google calls. Never returns tokens or JWT body.
 */
export async function supportPacket(ctx: AppContext, args: Record<string, unknown>): Promise<Envelope> {
  return okEnvelope("support_packet", {
    data: collectSupportFields(ctx, args),
  });
}
