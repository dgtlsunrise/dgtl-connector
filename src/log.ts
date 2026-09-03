/** Structured logs to stderr. Never auth headers, never tokens. */

export function logTool(entry: {
  tool: string;
  error_code?: string;
  api?: string;
  duration_ms: number;
}): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    tool: entry.tool,
    error_code: entry.error_code ?? null,
    api: entry.api ?? null,
    duration_ms: entry.duration_ms,
  });
  process.stderr.write(`${line}\n`);
}
