/** Structured logs to stderr (+ optional local audit.jsonl). Never auth headers, tokens, JWT, or report rows. */

import { appendFileSync, chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export type AuditLogEntry = {
  request_id: string;
  tool: string;
  resource_type?: string | null;
  resource_id?: string | null;
  error_code?: string | null;
  api?: string | null;
  duration_ms: number;
};

export type AuditLogOpts = {
  pluginDataDir?: string;
  auditLocal?: boolean;
};

/** Per-dispatch correlator. Log-only — never placed on the closed envelope. */
export function newRequestId(): string {
  return randomUUID();
}

/**
 * Write one redacted tool audit line to stderr.
 * When `auditLocal` is true, also append the same line to `PLUGIN_DATA/audit.jsonl`.
 */
export function logTool(entry: AuditLogEntry, opts: AuditLogOpts = {}): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    request_id: entry.request_id,
    tool: entry.tool,
    resource_type: entry.resource_type ?? null,
    resource_id: entry.resource_id ?? null,
    error_code: entry.error_code ?? null,
    api: entry.api ?? null,
    duration_ms: entry.duration_ms,
  });
  process.stderr.write(`${line}\n`);

  if (!opts.auditLocal || !opts.pluginDataDir) return;
  try {
    mkdirSync(opts.pluginDataDir, { recursive: true });
    const path = join(opts.pluginDataDir, "audit.jsonl");
    appendFileSync(path, `${line}\n`, { encoding: "utf8" });
    try {
      chmodSync(path, 0o600);
    } catch {
      /* best-effort mode */
    }
  } catch {
    /* Never fail a tool because local audit could not be written. */
  }
}
