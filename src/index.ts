import { createAppContext, detectPluginRoot } from "./context.js";
import { helpText, runAuthLogin } from "./auth/login-cli.js";
import { clearStore, readStore } from "./auth/store.js";
import { serveStdio } from "./server.js";
import { PLUGIN_VERSION } from "./version.js";

const pluginRoot = detectPluginRoot(import.meta.url);

async function main(argv: string[]): Promise<void> {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(helpText());
    return;
  }
  if (args.includes("--version") || args.includes("-v")) {
    process.stdout.write(`${PLUGIN_VERSION}\n`);
    return;
  }

  const ctx = createAppContext({ pluginRoot });

  if (args[0] === "auth") {
    const sub = args[1];
    if (sub === "login") {
      const clientId = ctx.env.GOOGLE_OAUTH_CLIENT_ID;
      if (!clientId) {
        process.stderr.write("Set GOOGLE_OAUTH_CLIENT_ID (public Desktop OAuth client). Do not set a client secret.\n");
        process.exitCode = 1;
        return;
      }
      process.exitCode = await runAuthLogin({
        clientId,
        pluginDataDir: ctx.pluginDataDir,
        fetchImpl: ctx.fetchImpl,
      });
      return;
    }
    if (sub === "logout") {
      clearStore(ctx.pluginDataDir);
      process.stderr.write("Cleared PLUGIN_DATA/google-oauth.json\n");
      return;
    }
    if (sub === "status") {
      const tok = await ctx.auth.getAccessToken();
      const stored = readStore(ctx.pluginDataDir);
      process.stdout.write(
        JSON.stringify(
          {
            host_injected: Boolean(ctx.env.GOOGLE_ACCESS_TOKEN || ctx.env.DGTL_GOOGLE_ACCESS_TOKEN),
            pkce_store: Boolean(stored?.access_token || stored?.refresh_token),
            token_source: tok?.source ?? null,
            email: tok?.email ?? null,
            expires_in: tok?.expiresIn ?? null,
            scopes: tok?.scopes ?? null,
            license_ok: ctx.license.ok,
            license_features: ctx.license.features,
          },
          null,
          2,
        ) + "\n",
      );
      return;
    }
    process.stderr.write("Unknown auth subcommand. Try --help.\n");
    process.exitCode = 1;
    return;
  }

  if (args.length > 0 && !args[0]?.startsWith("-")) {
    process.stderr.write(`Unknown command ${args[0]}. Try --help.\n`);
    process.exitCode = 1;
    return;
  }

  await serveStdio(ctx);
}

main(process.argv).catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exitCode = 1;
});
