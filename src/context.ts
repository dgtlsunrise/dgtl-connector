import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AuthPort } from "./auth/port.js";
import type { AccessTokenSource } from "./auth/types.js";
import { loadFlags, type Flags } from "./flags.js";
import { GoogleHttp } from "./http/google.js";
import type { HttpCall } from "./http/calls.js";
import { loadLicenseToken, verifyLicenseJwt, type LicenseStatus } from "./license/verify.js";

export type AppContext = {
  pluginRoot: string;
  pluginDataDir: string;
  auth: AccessTokenSource;
  http: GoogleHttp;
  fetchImpl: typeof fetch;
  flags: Flags;
  license: LicenseStatus;
  calls: HttpCall[];
  now: () => Date;
  env: NodeJS.ProcessEnv;
};

export function detectPluginRoot(fromMetaUrl: string): string {
  // dist/index.js or src/index.ts → parent is plugin root
  const here = dirname(fileURLToPath(fromMetaUrl));
  return process.env.PLUGIN_ROOT || process.env.GROK_PLUGIN_ROOT || join(here, "..");
}

export function detectPluginData(pluginRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.PLUGIN_DATA ||
    env.GROK_PLUGIN_DATA ||
    env.CLAUDE_PLUGIN_DATA ||
    join(homedir(), ".dgtl-marketing")
  );
}

export function createAppContext(opts: {
  pluginRoot: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  auth?: AccessTokenSource;
}): AppContext {
  const env = opts.env ?? process.env;
  const pluginDataDir = detectPluginData(opts.pluginRoot, env);
  const calls: HttpCall[] = [];
  const fetchImpl = opts.fetchImpl ?? fetch;
  const auth = opts.auth ?? AuthPort.fromEnv({ env, pluginDataDir, fetchImpl });
  const http = new GoogleHttp({ tokenSource: auth, fetchImpl, calls });
  const license = verifyLicenseJwt(loadLicenseToken(env, pluginDataDir));
  return {
    pluginRoot: opts.pluginRoot,
    pluginDataDir,
    auth,
    http,
    fetchImpl,
    flags: loadFlags(env),
    license,
    calls,
    now: opts.now ?? (() => new Date()),
    env,
  };
}
