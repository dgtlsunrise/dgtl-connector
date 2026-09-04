import type { AppContext } from "../context.js";
import { failEnvelope, type Envelope } from "../envelope.js";
import { ToolError } from "../errors.js";
import { logTool, newRequestId } from "../log.js";
import { TOOL_BY_NAME } from "./registry.js";

function resourceFields(env: Envelope): { resource_type: string | null; resource_id: string | null } {
  return {
    resource_type: env.resource?.type ?? null,
    resource_id: env.resource?.id ?? env.resource_id ?? null,
  };
}

function emitAudit(ctx: AppContext, requestId: string, name: string, env: Envelope, started: number): void {
  const { resource_type, resource_id } = resourceFields(env);
  logTool(
    {
      request_id: requestId,
      tool: name,
      resource_type,
      resource_id,
      error_code: env.ok ? undefined : env.error_code,
      api: env.api,
      duration_ms: Date.now() - started,
    },
    { pluginDataDir: ctx.pluginDataDir, auditLocal: ctx.flags.auditLocal },
  );
}

export async function dispatch(ctx: AppContext, name: string, args: unknown): Promise<Envelope> {
  const started = Date.now();
  const requestId = newRequestId();
  const spec = TOOL_BY_NAME.get(name);
  if (!spec) {
    const env = failEnvelope(name, "UNSUPPORTED_OPERATION", `Unknown tool ${name}`);
    emitAudit(ctx, requestId, name, env, started);
    return env;
  }
  const raw = args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
  try {
    const env = await spec.handler(ctx, raw);
    emitAudit(ctx, requestId, name, env, started);
    return env;
  } catch (err) {
    if (err instanceof ToolError) {
      const env = failEnvelope(name, err.error_code, err.message, err.extra);
      emitAudit(ctx, requestId, name, env, started);
      return env;
    }
    const message = err instanceof Error ? err.message : String(err);
    const env = failEnvelope(name, "GOOGLE_UNAVAILABLE", message);
    emitAudit(ctx, requestId, name, env, started);
    return env;
  }
}
