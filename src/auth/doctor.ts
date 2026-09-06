import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { STORE_FILE } from "./types.js";
import { loadLicenseToken, verifyLicenseJwt } from "../license/verify.js";
import { PLUGIN_VERSION } from "../version.js";

/** Env names we may report as SET/UNSET. Never print values. */
export const DOCTOR_ENV_NAMES = [
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_ACCESS_TOKEN",
  "DGTL_GOOGLE_ACCESS_TOKEN",
  "GOOGLE_GRANTED_SCOPES",
  "GOOGLE_ACCOUNT_EMAIL",
  "GOOGLE_OAUTH_REDIRECT_PORT",
  "GOOGLE_OAUTH_ADS_CLIENT_ID",
  "GOOGLE_OAUTH_ADS_CLIENT_SECRET",
  "GOOGLE_ADS_ACCESS_TOKEN",
  "GOOGLE_WRITE_ACCESS_TOKEN",
  "GOOGLE_OAUTH_WRITE_CLIENT_ID",
  "META_ACCESS_TOKEN",
  "DGTL_LICENSE_JWT",
  "DGTL_GATEWAY_URL",
  "DGTL_HOST",
  "DGTL_MCP_HOST",
  "DGTL_WRITES_ENABLED",
  "DGTL_SKIP_UPDATE_CHECK",
  "DGTL_AUDIT_LOCAL",
  "PLUGIN_ROOT",
  "PLUGIN_DATA",
  "GROK_PLUGIN_ROOT",
  "GROK_PLUGIN_DATA",
] as const;

export type DoctorOpts = {
  pluginRoot: string;
  pluginDataDir: string;
  env?: NodeJS.ProcessEnv;
  nowMs?: number;
};

export type DoctorReport = {
  node: { version: string; ok: boolean };
  package_version: string | null;
  plugin_version: string | null;
  dist_present: boolean;
  env_set: string[];
  env_unset: string[];
  plugin_data: {
    google_oauth_json: boolean;
    license_jwt: boolean;
  };
  license: {
    present: boolean;
    status: "missing" | "valid" | "invalid" | "expired" | "issuer";
    features: string[];
    /** Present only when locally verifiable; never the JWT or payload body. */
    missing_features?: string[];
  };
  auth: {
    host_injected: boolean;
    pkce_store: boolean;
    oauth_client_id: boolean;
    can_auth: boolean;
  };
  critical: string[];
  ok: boolean;
};

const EXPECTED_FEATURES = ["ads", "meta"] as const;

function readJsonVersion(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { version?: unknown };
    return typeof raw.version === "string" ? raw.version : null;
  } catch {
    return null;
  }
}

function envSet(env: NodeJS.ProcessEnv, name: string): boolean {
  const v = env[name];
  return typeof v === "string" && v.trim().length > 0;
}

export function collectDoctor(opts: DoctorOpts): DoctorReport {
  const env = opts.env ?? process.env;
  const nodeVersion = process.version;
  const nodeMajor = Number.parseInt(nodeVersion.replace(/^v/, "").split(".")[0] ?? "0", 10);
  const nodeOk = Number.isFinite(nodeMajor) && nodeMajor >= 20;

  const packageVersion = readJsonVersion(join(opts.pluginRoot, "package.json"));
  const pluginVersion = readJsonVersion(join(opts.pluginRoot, "plugin.json"));
  const distPresent = existsSync(join(opts.pluginRoot, "dist", "index.js"));

  const env_set: string[] = [];
  const env_unset: string[] = [];
  for (const name of DOCTOR_ENV_NAMES) {
    if (envSet(env, name)) env_set.push(name);
    else env_unset.push(name);
  }

  const googleOauthJson = existsSync(join(opts.pluginDataDir, STORE_FILE.a));
  const licenseJwtFile = existsSync(join(opts.pluginDataDir, "license.jwt"));

  const token = loadLicenseToken(env, opts.pluginDataDir);
  const present = Boolean(token);
  const verified = verifyLicenseJwt(token, { nowMs: opts.nowMs });
  let status: DoctorReport["license"]["status"] = "missing";
  if (!present) status = "missing";
  else if (verified.ok) status = "valid";
  else if (verified.reason === "expired") status = "expired";
  else if (verified.reason === "issuer") status = "issuer";
  else status = "invalid";

  const features = verified.features;
  const missing_features = EXPECTED_FEATURES.filter((f) => !features.includes(f));

  const hostInjected = envSet(env, "GOOGLE_ACCESS_TOKEN") || envSet(env, "DGTL_GOOGLE_ACCESS_TOKEN");
  const oauthClientId = envSet(env, "GOOGLE_OAUTH_CLIENT_ID");
  const canAuth = hostInjected || googleOauthJson || oauthClientId;

  const critical: string[] = [];
  if (!distPresent) critical.push("no_build");
  if (!canAuth) critical.push("no_auth");
  if (!nodeOk) critical.push("node_version");

  return {
    node: { version: nodeVersion, ok: nodeOk },
    package_version: packageVersion,
    plugin_version: pluginVersion ?? PLUGIN_VERSION,
    dist_present: distPresent,
    env_set,
    env_unset,
    plugin_data: {
      google_oauth_json: googleOauthJson,
      license_jwt: licenseJwtFile,
    },
    license: {
      present,
      status,
      features,
      ...(present && status === "valid" && missing_features.length > 0 ? { missing_features } : {}),
    },
    auth: {
      host_injected: hostInjected,
      pkce_store: googleOauthJson,
      oauth_client_id: oauthClientId,
      can_auth: canAuth,
    },
    critical,
    ok: critical.length === 0,
  };
}

/** Human checklist. Never includes env values, JWT, or token bytes. */
export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [
    "dgtl-connector doctor",
    "=====================",
    `node: ${report.node.version}${report.node.ok ? " (>=20 ok)" : " (need >=20)"}`,
    `package.json version: ${report.package_version ?? "missing"}`,
    `plugin.json version: ${report.plugin_version ?? "missing"}`,
    `dist/index.js: ${report.dist_present ? "present" : "MISSING — run npm run build"}`,
    "",
    "env SET (names only):",
    report.env_set.length ? `  ${report.env_set.join(", ")}` : "  (none of the known names)",
    "env UNSET:",
    report.env_unset.length ? `  ${report.env_unset.join(", ")}` : "  (all known names are set)",
    "",
    "PLUGIN_DATA files (existence only):",
    `  google-oauth.json: ${report.plugin_data.google_oauth_json ? "present" : "absent"}`,
    `  license.jwt: ${report.plugin_data.license_jwt ? "present" : "absent"}`,
    "",
    `license: ${licenseLine(report)}`,
    `auth: host_injected=${report.auth.host_injected} pkce_store=${report.auth.pkce_store} GOOGLE_OAUTH_CLIENT_ID=${report.auth.oauth_client_id}`,
    `can_auth: ${report.auth.can_auth}`,
    "",
  ];
  if (report.critical.length) {
    lines.push(`critical: ${report.critical.join(", ")}`);
    lines.push("exit: 1");
  } else {
    lines.push("critical: none");
    lines.push("exit: 0");
  }
  lines.push("");
  return lines.join("\n");
}

function licenseLine(report: DoctorReport): string {
  const { license } = report;
  if (license.status === "missing") {
    return "missing (free GA4/GSC/GTM still work; not a critical)";
  }
  const feat = license.features.length ? license.features.join(",") : "(none)";
  if (license.status === "valid") {
    const miss = license.missing_features?.length
      ? `; missing features: ${license.missing_features.join(",")}`
      : "";
    return `valid; features=${feat}${miss}`;
  }
  if (license.status === "expired") return `expired; features=${feat}`;
  if (license.status === "issuer") return "invalid (issuer)";
  return "invalid";
}

export function doctorExitCode(report: DoctorReport): number {
  return report.ok ? 0 : 1;
}

export function runDoctorCli(opts: DoctorOpts, write: (s: string) => void = (s) => process.stdout.write(s)): number {
  const report = collectDoctor(opts);
  write(formatDoctorReport(report));
  return doctorExitCode(report);
}
