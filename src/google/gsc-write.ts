import type { AppContext } from "../context.js";
import { failEnvelope, okEnvelope, type Envelope } from "../envelope.js";
import { MSG, ToolError } from "../errors.js";
import { encodeSiteUrl, requireId } from "../ids.js";
import { APIS, SCOPE } from "./scopes.js";
import { siteUrlHint } from "./gsc.js";

const HINT_FLAG =
  "Set DGTL_WRITES_ENABLED=true to allow local Search Console sitemap mutates. Free Google can already hold webmasters write. Ads/Meta/TikTok stay Pro.";

const HINT_CONSENT =
  "Use Free Google (`auth login` / GOOGLE_ACCESS_TOKEN with webmasters write) or a legacy GOOGLE_GSC_WRITE_ACCESS_TOKEN / google-oauth-gsc-write.json. Do not add adwords, content, or business.manage to Free Google.";

const HOST = APIS.searchconsole;
type Rec = Record<string, unknown>;

function dryRunDefault(args: Rec): boolean {
  return args.dry_run !== false;
}

function sMeta(tool: string) {
  return { requiredScope: SCOPE.webmastersWrite, tool };
}

function siteResource(siteUrl: string) {
  return { type: "gsc_site", id: siteUrl, display_name: siteUrl };
}

export function gscSitemapWritePath(siteUrl: string, feedpath: string): string {
  return `/webmasters/v3/sites/${encodeSiteUrl(siteUrl)}/sitemaps/${encodeURIComponent(feedpath)}`;
}

function confirmPhrase(args: Rec): unknown {
  if (typeof args.confirm_phrase === "string") return args.confirm_phrase;
  return args.confirm;
}

function assertConfirmContains(confirm: unknown, siteUrl: string): void {
  const phrase = typeof confirm === "string" ? confirm : "";
  if (!phrase.includes(siteUrl)) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      `Live Search Console sitemap mutate requires confirm_phrase that includes the exact site_url ${JSON.stringify(siteUrl)}. Constant phrases without that site_url are not accepted.`,
      {
        api: HOST,
        hint: "Prefer dry_run first. Copy site_url exactly from gsc_list_sites — trailing slash and sc-domain: vs URL-prefix are different properties.",
        resource_id: siteUrl,
      },
    );
  }
}

async function gateWrites(tool: string, ctx: AppContext): Promise<Envelope | null> {
  if (!ctx.flags.writesEnabled) {
    return failEnvelope(tool, "WRITE_NOT_ENABLED", MSG.WRITE_NOT_ENABLED, {
      hint: HINT_FLAG,
      api: HOST,
    });
  }
  const tok = await ctx.authGscWrite.getAccessToken();
  if (!tok?.accessToken) {
    return failEnvelope(tool, "CONSENT_S_REQUIRED", MSG.CONSENT_S_REQUIRED, {
      hint: HINT_CONSENT,
      api: HOST,
      missing_scope: SCOPE.webmastersWrite,
    });
  }
  return null;
}

function dryRunOk(tool: string, siteUrl: string, feedpath: string, method: "PUT" | "DELETE"): Envelope {
  return okEnvelope(tool, {
    resource: siteResource(siteUrl),
    data: {
      dry_run: true,
      site_url: siteUrl,
      feedpath,
      method,
      path: gscSitemapWritePath(siteUrl, feedpath),
      note: `No Google mutate. Pass dry_run=false with confirm_phrase containing ${JSON.stringify(siteUrl)} only after a user message this turn that includes it.`,
    },
  });
}

async function mutateSitemap(
  ctx: AppContext,
  tool: string,
  args: Rec,
  method: "PUT" | "DELETE",
): Promise<Envelope> {
  const gated = await gateWrites(tool, ctx);
  if (gated) return gated;
  const siteUrl = requireId(args.site_url, "site_url");
  const feedpath = requireId(args.feedpath, "feedpath");
  if (dryRunDefault(args)) return dryRunOk(tool, siteUrl, feedpath, method);
  assertConfirmContains(confirmPhrase(args), siteUrl);
  const path = gscSitemapWritePath(siteUrl, feedpath);
  try {
    const raw =
      method === "PUT"
        ? await ctx.httpGscWrite.put(path, sMeta(tool))
        : await ctx.httpGscWrite.delete(path, sMeta(tool));
    return okEnvelope(tool, {
      resource: siteResource(siteUrl),
      data: {
        dry_run: false,
        site_url: siteUrl,
        feedpath,
        method,
        ...(method === "PUT" ? { sitemap: raw } : { deleted: true, path }),
      },
    });
  } catch (err) {
    if (err instanceof ToolError && err.error_code === "NOT_FOUND") {
      throw new ToolError("NOT_FOUND", MSG.NOT_FOUND, {
        ...err.extra,
        resource_id: siteUrl,
        hint: siteUrlHint(siteUrl),
      });
    }
    throw err;
  }
}

export async function gscSubmitSitemap(ctx: AppContext, args: Rec): Promise<Envelope> {
  return mutateSitemap(ctx, "gsc_submit_sitemap", args, "PUT");
}

export async function gscDeleteSitemap(ctx: AppContext, args: Rec): Promise<Envelope> {
  return mutateSitemap(ctx, "gsc_delete_sitemap", args, "DELETE");
}
