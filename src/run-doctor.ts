import { createAppContext, detectPluginRoot } from "./context.js";
import { runDoctorCli } from "./auth/doctor.js";

const pluginRoot = detectPluginRoot(import.meta.url);
const ctx = createAppContext({ pluginRoot });
process.exitCode = runDoctorCli({
  pluginRoot: ctx.pluginRoot,
  pluginDataDir: ctx.pluginDataDir,
  env: ctx.env,
});
