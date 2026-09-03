import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { AppContext } from "./context.js";
import { dispatch } from "./tools/dispatch.js";
import { TOOLS } from "./tools/registry.js";
import { PLUGIN_NAME, PLUGIN_VERSION } from "./version.js";

const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export function createMcpServer(ctx: AppContext): McpServer {
  const server = new McpServer({ name: PLUGIN_NAME, version: PLUGIN_VERSION });
  for (const spec of TOOLS) {
    server.registerTool(
      spec.name,
      {
        title: spec.title,
        description: spec.description,
        inputSchema: spec.inputSchema,
        annotations,
      },
      async (args) => {
        const envelope = await dispatch(ctx, spec.name, args ?? {});
        return {
          content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
        };
      },
    );
  }
  return server;
}

export async function serveStdio(ctx: AppContext): Promise<void> {
  const server = createMcpServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
