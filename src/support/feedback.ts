import { createHash } from "node:crypto";
import type { AppContext } from "../context.js";
import { failEnvelope, okEnvelope, type Envelope } from "../envelope.js";
import { MSG } from "../errors.js";
import { gatewayUrlFromEnv } from "../gateway/client.js";
import { newRequestId } from "../log.js";
import { collectSupportFields, safeField, TOKENISH } from "./packet.js";

export const FEEDBACK_MAILBOX = "support@dgtlsunrise.com";
export const FEEDBACK_PATH = "/v1/feedback";
const FEEDBACK_TIMEOUT_MS = 15_000;

export type FeedbackKind = "bug" | "feature" | "other";

export type FeedbackDraftFields = {
  to: typeof FEEDBACK_MAILBOX;
  reply_to: string;
  kind: FeedbackKind;
  message: string;
  plugin_version: string;
  host: string | null;
  last_tool: string | null;
  error_code: string | null;
  resource_id: string | null;
};

type CachedDraft = {
  fields: FeedbackDraftFields;
  draft_text: string;
};

const DRAFTS = new Map<string, CachedDraft>();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Test helper — isolate draft cache between cases. */
export function clearFeedbackDrafts(): void {
  DRAFTS.clear();
}

/**
 * Redact token-shaped / credential-shaped substrings. Never leave secrets in a draft.
 */
export function stripTokenShapes(text: string): string {
  return text
    .replace(/ya29\.[0-9A-Za-z._-]+/g, "[REDACTED]")
    .replace(/1\/\/[0-9A-Za-z_-]{4,}/g, "[REDACTED]")
    .replace(/GOCSPX-[0-9A-Za-z_-]+/g, "[REDACTED]")
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, "[REDACTED]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/gi, "[REDACTED]")
    .replace(/developer-token/gi, "[REDACTED]")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED]");
}

export function containsTokenShape(text: string): boolean {
  return TOKENISH.test(text);
}

function parseKind(value: unknown): FeedbackKind {
  if (value === "bug" || value === "feature" || value === "other") return value;
  return "other";
}

function parseEmail(value: unknown): string | null {
  const raw = safeField(value, 254);
  if (!raw) return null;
  if (!EMAIL_RE.test(raw)) return null;
  if (containsTokenShape(raw)) return null;
  return raw;
}

function canonicalDraft(fields: FeedbackDraftFields): string {
  const keys: (keyof FeedbackDraftFields)[] = [
    "to",
    "reply_to",
    "kind",
    "message",
    "plugin_version",
    "host",
    "last_tool",
    "error_code",
    "resource_id",
  ];
  const obj: Record<string, unknown> = {};
  for (const k of keys) obj[k] = fields[k] ?? null;
  return JSON.stringify(obj);
}

export function draftIdFor(fields: FeedbackDraftFields): string {
  return createHash("sha256").update(canonicalDraft(fields)).digest("hex").slice(0, 16);
}

function formatDraftText(fields: FeedbackDraftFields, draftId: string): string {
  const host = fields.host ?? "(unknown)";
  const last = fields.last_tool ?? "(none)";
  const code = fields.error_code ?? "(none)";
  const rid = fields.resource_id ?? "(none)";
  return [
    `To: ${fields.to}`,
    `Reply-To: ${fields.reply_to}`,
    `Kind: ${fields.kind}`,
    `draft_id: ${draftId}`,
    "",
    `Plugin version: ${fields.plugin_version}`,
    `Host: ${host}`,
    `Last tool: ${last}`,
    `error_code: ${code}`,
    `resource_id: ${rid}`,
    "",
    "Message:",
    fields.message,
    "",
    "This draft has not been sent. Approve it, then call feedback_send with confirm: true and this draft_id.",
    "Do not paste tokens.",
  ].join("\n");
}

export function feedbackUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const explicit = (env.DGTL_FEEDBACK_URL || "").trim();
  if (explicit) return normalizeFeedbackUrl(explicit);
  const gw = gatewayUrlFromEnv(env);
  if (gw) return normalizeFeedbackUrl(gw);
  return undefined;
}

function normalizeFeedbackUrl(raw: string): string {
  const base = raw.replace(/\/+$/, "");
  if (base.endsWith(FEEDBACK_PATH)) return base;
  return `${base}${FEEDBACK_PATH}`;
}

function isEnvelope(v: FeedbackDraftFields | Envelope): v is Envelope {
  return "ok" in v;
}

function buildFields(ctx: AppContext, args: Record<string, unknown>): FeedbackDraftFields | Envelope {
  const replyTo = parseEmail(args.reply_to);
  if (!replyTo) {
    return failEnvelope("feedback_prepare", "INVALID_ARGUMENT", MSG.INVALID_ARGUMENT, {
      hint: "reply_to must be a normal email (the address we can reply to). Never a token or JWT.",
    });
  }

  if (typeof args.message !== "string" || !args.message.trim()) {
    return failEnvelope("feedback_prepare", "INVALID_ARGUMENT", MSG.INVALID_ARGUMENT, {
      hint: "message is required.",
    });
  }

  const stripped = stripTokenShapes(args.message).trim();
  if (!stripped || /^\[REDACTED\]$/.test(stripped)) {
    return failEnvelope("feedback_prepare", "INVALID_ARGUMENT", MSG.INVALID_ARGUMENT, {
      hint: "Message looked like a token or was empty after stripping secrets. Describe the failure in words — never paste tokens.",
    });
  }

  const packet = collectSupportFields(ctx, args);
  return {
    to: FEEDBACK_MAILBOX,
    reply_to: replyTo,
    kind: parseKind(args.kind),
    message: stripped,
    plugin_version: packet.plugin_version,
    host: packet.host,
    last_tool: packet.last_tool,
    error_code: packet.error_code,
    resource_id: packet.resource_id,
  };
}

/**
 * Build a reviewable draft. Does not send. Strips token-shaped strings.
 */
export async function feedbackPrepare(ctx: AppContext, args: Record<string, unknown>): Promise<Envelope> {
  const built = buildFields(ctx, args);
  if (isEnvelope(built)) return built;
  const fields = built;
  const draft_id = draftIdFor(fields);
  const draft_text = formatDraftText(fields, draft_id);
  DRAFTS.set(draft_id, { fields, draft_text });
  return okEnvelope("feedback_prepare", {
    data: {
      draft_id,
      draft_text,
      to: fields.to,
      reply_to: fields.reply_to,
      kind: fields.kind,
      sent: false,
      confirm_required: true,
      ...collectSupportFields(ctx, args),
    },
  });
}

function resolveDraft(ctx: AppContext, args: Record<string, unknown>): CachedDraft | Envelope {
  const cachedId = typeof args.draft_id === "string" ? args.draft_id.trim() : "";
  if (cachedId && DRAFTS.has(cachedId)) {
    const hit = DRAFTS.get(cachedId)!;
    if (typeof args.reply_to === "string" || typeof args.message === "string") {
      const rebuilt = buildFields(ctx, { ...hit.fields, ...args, last_tool: args.last_tool ?? hit.fields.last_tool });
      if (isEnvelope(rebuilt)) return rebuilt;
      const fields = rebuilt;
      const id = draftIdFor(fields);
      if (id !== cachedId) {
        return failEnvelope("feedback_send", "INVALID_ARGUMENT", MSG.INVALID_ARGUMENT, {
          hint: "draft_id does not match the supplied fields. Re-run feedback_prepare and echo the new draft_id.",
        });
      }
      return { fields, draft_text: formatDraftText(fields, id) };
    }
    return hit;
  }

  if (typeof args.message === "string" && typeof args.reply_to === "string") {
    const rebuilt = buildFields(ctx, args);
    if (isEnvelope(rebuilt)) {
      return failEnvelope("feedback_send", rebuilt.error_code ?? "INVALID_ARGUMENT", rebuilt.message ?? MSG.INVALID_ARGUMENT, {
        hint: rebuilt.hint,
      });
    }
    const fields = rebuilt;
    const id = draftIdFor(fields);
    if (cachedId && cachedId !== id) {
      return failEnvelope("feedback_send", "INVALID_ARGUMENT", MSG.INVALID_ARGUMENT, {
        hint: "draft_id does not match the supplied fields. Re-run feedback_prepare and echo the new draft_id.",
      });
    }
    return { fields, draft_text: formatDraftText(fields, id) };
  }

  return failEnvelope("feedback_send", "INVALID_ARGUMENT", MSG.INVALID_ARGUMENT, {
    hint: "feedback_send needs the draft_id from feedback_prepare (or the full draft fields) plus confirm: true.",
  });
}

function payloadHasSecrets(body: unknown): boolean {
  return containsTokenShape(JSON.stringify(body));
}

/**
 * Send an approved draft. Requires confirm: true and draft_id (or full fields).
 * POST ${DGTL_FEEDBACK_URL || DGTL_GATEWAY_URL}/v1/feedback. Never emails tokens.
 */
export async function feedbackSend(ctx: AppContext, args: Record<string, unknown>): Promise<Envelope> {
  if (args.confirm !== true) {
    return failEnvelope("feedback_send", "INVALID_ARGUMENT", MSG.FEEDBACK_CONFIRM_REQUIRED, {
      hint: "Show the draft from feedback_prepare. Only call feedback_send after the user approves, with confirm: true and the draft_id.",
    });
  }

  const resolved = resolveDraft(ctx, args);
  if ("ok" in resolved) return resolved;
  const { fields, draft_text } = resolved;
  const draft_id = draftIdFor(fields);

  const url = ctx.flags.feedbackUrl
    ? normalizeFeedbackUrl(ctx.flags.feedbackUrl)
    : feedbackUrlFromEnv(ctx.env);
  if (!url) {
    return failEnvelope("feedback_send", "GATEWAY_UNAVAILABLE", MSG.FEEDBACK_GATEWAY_UNAVAILABLE, {
      hint: "Set DGTL_FEEDBACK_URL or DGTL_GATEWAY_URL to the hosted stamp gateway. Path is /v1/feedback. Destination mailbox is support@dgtlsunrise.com. Do not email tokens.",
    });
  }

  const body = {
    to: fields.to,
    reply_to: fields.reply_to,
    kind: fields.kind,
    message: fields.message,
    draft_id,
    draft_text,
    plugin_version: fields.plugin_version,
    host: fields.host,
    last_tool: fields.last_tool,
    error_code: fields.error_code,
    resource_id: fields.resource_id,
    confirm: true as const,
  };

  if (payloadHasSecrets(body)) {
    return failEnvelope("feedback_send", "INVALID_ARGUMENT", MSG.INVALID_ARGUMENT, {
      hint: "Draft still contained a token-shaped string after stripping. Refuse send. Never email tokens.",
    });
  }

  const requestId = newRequestId();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FEEDBACK_TIMEOUT_MS);
  try {
    const res = await ctx.fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-DGTL-Request-Id": requestId,
        // Never Authorization / Google tokens / license JWT on this hop.
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });

    let parsed: Record<string, unknown> = {};
    try {
      parsed = (await res.json()) as Record<string, unknown>;
    } catch {
      if (!res.ok) {
        return failEnvelope("feedback_send", "GATEWAY_UNAVAILABLE", MSG.FEEDBACK_GATEWAY_UNAVAILABLE, {
          hint: `Feedback endpoint returned HTTP ${res.status} with non-JSON body. Check DGTL_FEEDBACK_URL / DGTL_GATEWAY_URL.`,
        });
      }
    }

    if (!res.ok) {
      return failEnvelope("feedback_send", "GATEWAY_UNAVAILABLE", MSG.FEEDBACK_GATEWAY_UNAVAILABLE, {
        hint:
          typeof parsed.message === "string"
            ? parsed.message
            : `Feedback endpoint returned HTTP ${res.status}. Check DGTL_FEEDBACK_URL / DGTL_GATEWAY_URL.`,
      });
    }

    DRAFTS.delete(draft_id);
    return okEnvelope("feedback_send", {
      data: {
        sent: true,
        draft_id,
        to: FEEDBACK_MAILBOX,
        reply_to: fields.reply_to,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return failEnvelope("feedback_send", "GATEWAY_UNAVAILABLE", MSG.FEEDBACK_GATEWAY_UNAVAILABLE, {
      hint: `Feedback POST failed (${msg}). Check DGTL_FEEDBACK_URL or DGTL_GATEWAY_URL. Do not email tokens.`,
    });
  } finally {
    clearTimeout(timer);
  }
}
