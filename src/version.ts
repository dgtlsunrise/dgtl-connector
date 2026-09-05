export const PLUGIN_NAME = "dgtl-connector";
export const PLUGIN_VERSION = "0.1.0";
export const PLUGIN_DISPLAY = "DGTL connector";

/**
 * Host label for support intake when known (Grok Bot / Cursor / Grok Build / other).
 * Prefer explicit DGTL_HOST; else soft heuristics; else null.
 */
export function detectHost(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = (env.DGTL_HOST || env.DGTL_MCP_HOST || "").trim();
  if (explicit) return explicit;
  if (env.GROK_BUILD === "1" || env.GROK_BUILD === "true") return "Grok Build";
  if (env.GROK_PLUGIN_ROOT || env.GROK_PLUGIN_DATA || env.GROK_BOT) return "Grok Bot";
  if (env.CURSOR_AGENT || env.CURSOR_TRACE_ID || env.CURSOR_PLUGIN) return "Cursor";
  return null;
}
