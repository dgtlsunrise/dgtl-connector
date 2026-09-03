import type { AppContext } from "../context.js";
import { failEnvelope, type Envelope } from "../envelope.js";
import { ToolError } from "../errors.js";
import { logTool } from "../log.js";
import { TOOL_BY_NAME } from "./registry.js";

export async function dispatch(ctx: AppContext, name: string, args: unknown): Promise<Envelope> {
  const started = Date.now();
  const spec = TOOL_BY_NAME.get(name);
  if (!spec) {
    const env = failEnvelope(name, "UNSUPPORTED_OPERATION", `Unknown tool ${name}`);
    logTool({ tool: name, error_code: env.error_code, duration_ms: Date.now() - started });
    return env;
  }
  const raw = args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
  try {
    const env = await spec.handler(ctx, raw);
    logTool({
      tool: name,
      error_code: env.ok ? undefined : env.error_code,
      api: env.api,
      duration_ms: Date.now() - started,
    });
    return env;
  } catch (err) {
    if (err instanceof ToolError) {
      const env = failEnvelope(name, err.error_code, err.message, err.extra);
      logTool({
        tool: name,
        error_code: env.error_code,
        api: env.api,
        duration_ms: Date.now() - started,
      });
      return env;
    }
    const message = err instanceof Error ? err.message : String(err);
    const env = failEnvelope(name, "GOOGLE_UNAVAILABLE", message);
    logTool({ tool: name, error_code: env.error_code, duration_ms: Date.now() - started });
    return env;
  }
}
