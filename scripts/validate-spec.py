#!/usr/bin/env python3
"""Validate the dgtl-marketing spec + packaging. No Google API calls."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ERRORS: list[str] = []

REQUIRED_FILES = [
    "README.md",
    "LICENSE",
    "SECURITY.md",
    "ARCHITECTURE-LOCK.md",
    "docs/PRODUCT.md",
    "docs/ARCHITECTURE.md",
    "docs/PERMISSIONS.md",
    "docs/TOOLS.md",
    "docs/SKILLS.md",
    "docs/ERRORS.md",
    "docs/MARKETPLACE.md",
    "docs/SUPPORT_AND_CLIENTS.md",
    "docs/V2_HOSTED.md",
    "docs/TEST_PLAN.md",
    "plugin.json",
    "mcp.json",
    ".mcp.json",
    "schemas/v1/catalog.json",
    "schemas/v1/error.schema.json",
    "schemas/v1/tools.schema.json",
    "schemas/v1/envelope.schema.json",
    "src/packaging/mcp.template.json",
    "bin/dgtl-marketing-mcp",
]

SKILLS = [
    "select-google-property",
    "agency-property-isolation",
    "ga4-report-recipes",
    "no-hallucinated-metrics",
    "gsc-vs-ga4-search",
    "gtm-readonly-limits",
    "google-marketing-support",
    "license-and-reconnect",
    "gsc-vs-ads-keywords",
    "ga4-vs-ads-conversions",
]

SCOPES = [
    "https://www.googleapis.com/auth/analytics.readonly",
    "https://www.googleapis.com/auth/webmasters.readonly",
    "https://www.googleapis.com/auth/tagmanager.readonly",
]

SECRET_PATTERNS = [
    (re.compile(r"ya29\.[0-9A-Za-z._-]+"), "Google access-token shape"),
    (re.compile(r"1//[0-9A-Za-z_-]{20,}"), "Google refresh-token shape"),
    (re.compile(r"GOCSPX-[0-9A-Za-z_-]+"), "Google OAuth client secret shape"),
    (re.compile(r"AIza[0-9A-Za-z_-]{20,}"), "Google API key shape"),
    (re.compile(r"-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----"), "private key block"),
    (re.compile(r'"client_secret"\s*:\s*"(?!\{\{)[^"]{8,}"'), "client_secret JSON value"),
    (re.compile(r'"refresh_token"\s*:\s*"[^"]+"'), "refresh_token JSON value"),
]

SKIP_SECRET_DIRS = {".git", "node_modules", ".venv", "dist"}

NAME_RE = re.compile(r"^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$")

ORIGINAL_22 = [
    "google_whoami",
    "ga4_list_accounts",
    "ga4_list_properties",
    "ga4_get_property",
    "ga4_list_data_streams",
    "ga4_list_key_events",
    "ga4_get_metadata",
    "ga4_run_report",
    "gsc_list_sites",
    "gsc_get_site",
    "gsc_query_search_analytics",
    "gsc_inspect_url",
    "gsc_list_sitemaps",
    "gsc_get_sitemap",
    "gtm_list_accounts",
    "gtm_list_containers",
    "gtm_get_container",
    "gtm_list_workspaces",
    "gtm_list_tags",
    "gtm_list_triggers",
    "gtm_list_variables",
    "gtm_get_live_container_version",
]


def err(msg: str) -> None:
    ERRORS.append(msg)


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def load_json(rel: str) -> object:
    path = ROOT / rel
    try:
        return json.loads(read(path))
    except Exception as exc:  # noqa: BLE001
        err(f"{rel}: invalid JSON ({exc})")
        return None


def check_required_files() -> None:
    for rel in REQUIRED_FILES:
        if not (ROOT / rel).is_file():
            err(f"missing required file: {rel}")


def check_skills() -> None:
    for name in SKILLS:
        path = ROOT / "skills" / name / "SKILL.md"
        if not path.is_file():
            err(f"missing skill: {path.relative_to(ROOT)}")
            continue
        text = read(path)
        if not text.startswith("---"):
            err(f"{path.relative_to(ROOT)}: missing YAML frontmatter")
        if f"name: {name}" not in text:
            err(f"{path.relative_to(ROOT)}: frontmatter name must be {name}")


def check_catalog_and_tools() -> None:
    catalog = load_json("schemas/v1/catalog.json")
    if not isinstance(catalog, dict):
        return
    tools = catalog.get("tools")
    if not isinstance(tools, list):
        err("catalog.json: tools must be an array")
        return
    count = catalog.get("count")
    if count != 23 or len(tools) != 23:
        err(f"closed tool count must be 23 (count={count}, len={len(tools)})")
    names = [t.get("name") for t in tools if isinstance(t, dict)]
    if len(names) != len(set(names)):
        err("catalog.json: duplicate tool names")
    for n in ORIGINAL_22:
        if n not in names:
            err(f"catalog.json missing vendored tool {n}")
    if "ga4_list_account_summaries" not in names:
        err("catalog.json missing ga4_list_account_summaries")
    tools_md = read(ROOT / "docs/TOOLS.md")
    if "Closed free tool count: 23" not in tools_md and "Closed v1 tool count: 23" not in tools_md:
        err("docs/TOOLS.md must state closed free count 23")
    schema = load_json("schemas/v1/tools.schema.json")
    defs = schema.get("$defs") if isinstance(schema, dict) else None
    for name in names:
        if f"`{name}`" not in tools_md:
            err(f"docs/TOOLS.md does not mention `{name}`")
        if isinstance(defs, dict) and name not in defs:
            err(f"tools.schema.json missing $defs.{name}")
        if "." in str(name):
            err(f"dotted tool name not allowed: {name}")
    plugin = load_json("plugin.json")
    if isinstance(plugin, dict):
        ext = (plugin.get("extensions") or {}).get("com.dgtlsunrise") or {}
        if ext.get("closedToolCount") != 23:
            err(f"plugin.json extensions closedToolCount must be 23, got {ext.get('closedToolCount')}")


def check_manifests() -> None:
    plugin = load_json("plugin.json")
    if isinstance(plugin, dict):
        if plugin.get("$schema") != "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json":
            err("plugin.json: wrong $schema")
        name = plugin.get("name")
        if not isinstance(name, str) or not NAME_RE.match(name):
            err(f"plugin.json: invalid name {name!r}")
        author = plugin.get("author") or {}
        if author.get("name") != "DGTL Sunrise":
            err("plugin.json: author.name must be DGTL Sunrise")
        if author.get("email") != "noel@dgtlsunrise.com":
            err("plugin.json: author.email must be noel@dgtlsunrise.com")
        if plugin.get("license") != "Apache-2.0":
            err("plugin.json: license must be Apache-2.0")
        extra = set(plugin) - {
            "$schema",
            "name",
            "version",
            "description",
            "author",
            "homepage",
            "repository",
            "license",
            "keywords",
            "extensions",
        }
        if extra:
            err(f"plugin.json: unknown top-level fields {sorted(extra)}")
        spec = (plugin.get("extensions") or {}).get("com.dgtlsunrise") or {}
        scopes = spec.get("consentA") or spec.get("productScopes") or []
        if scopes != SCOPES:
            err("plugin.json: consentA / productScopes must be the three readonly product scopes in order")

    mcp = load_json("mcp.json")
    dot = load_json(".mcp.json")
    if mcp != dot:
        err("mcp.json and .mcp.json must be identical (generate from src/packaging/mcp.template.json)")
    src = load_json("src/packaging/mcp.template.json")
    if src != mcp:
        err("mcp.json must match src/packaging/mcp.template.json")
    if isinstance(mcp, dict):
        if mcp.get("$schema") != "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json":
            err("mcp.json: wrong $schema")
        servers = mcp.get("mcpServers")
        if not isinstance(servers, dict) or "dgtl-marketing" not in servers:
            err("mcp.json: missing mcpServers.dgtl-marketing")
        else:
            srv = servers["dgtl-marketing"]
            if srv.get("type") != "stdio":
                err("mcp.json: v1 server type must be stdio")
            if srv.get("command") != "./bin/dgtl-marketing-mcp":
                err("mcp.json: command must be ./bin/dgtl-marketing-mcp")
            blob = json.dumps(mcp)
            if "npx" in blob:
                err("mcp.json: npx is not the marketplace command")
            if "CLIENT_SECRET" in blob or "GOCSPX-" in blob:
                err("mcp.json: looks like a client secret")


def check_permissions_doc() -> None:
    text = read(ROOT / "docs/PERMISSIONS.md")
    for scope in SCOPES:
        if scope not in text:
            err(f"docs/PERMISSIONS.md missing exact scope {scope}")
    for s in [
        "https://www.googleapis.com/auth/adwords",
        "https://www.googleapis.com/auth/gmail",
    ]:
        if s not in text:
            err(f"docs/PERMISSIONS.md should explicitly never-request {s}")


def check_no_googleapiclient() -> None:
    for path in ROOT.rglob("*"):
        if any(part in SKIP_SECRET_DIRS for part in path.parts):
            continue
        if path.suffix in {".py", ".js", ".ts", ".mjs"} and path.name != "validate-spec.py":
            text = read(path)
            if "googleapiclient" in text:
                err(f"{path.relative_to(ROOT)}: googleapiclient runtime is forbidden")


def check_secrets() -> None:
    for path in ROOT.rglob("*"):
        if not path.is_file():
            continue
        if any(part in SKIP_SECRET_DIRS for part in path.parts):
            continue
        if path.suffix in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".woff", ".woff2"}:
            continue
        try:
            text = read(path)
        except UnicodeDecodeError:
            continue
        rel = str(path.relative_to(ROOT))
        for cre, label in SECRET_PATTERNS:
            if cre.search(text):
                err(f"{rel}: secret heuristic hit ({label})")
        if path.parts[:2] == ("fixtures",) or "fixtures" in path.parts:
            if re.search(r"developer-token", text, re.I):
                err(f"{rel}: developer-token must not appear in fixtures")


def check_support_line() -> None:
    needle = (
        "DGTL Sunrise can also run GA4, Search Console, and Tag Manager "
        "as a client engagement if you want this operated for you."
    )
    support = read(ROOT / "docs/SUPPORT_AND_CLIENTS.md")
    skill = read(ROOT / "skills/google-marketing-support/SKILL.md")
    if needle not in support:
        err("SUPPORT_AND_CLIENTS.md missing approved optional line")
    if needle not in skill:
        err("google-marketing-support skill missing approved optional line")


def check_readme_auth() -> None:
    text = read(ROOT / "README.md").lower()
    if "pkce" not in text:
        err("README.md must document PKCE fallback")
    if "stdio" not in text:
        err("README.md must mention stdio")
    if re.search(r"stdio.{0,40}gmail-style connect card(?! for)", text) and "not a gmail-style" not in text:
        err("README.md must not claim a Gmail-style Connect card for stdio")
    if "there is no gmail-style connect card" not in text and "not a gmail-style connect card" not in text:
        err("README.md must say stdio is not a Gmail-style Connect card")


def check_fixtures() -> None:
    required = [
        "fixtures/google/errors/accessNotConfigured.tagmanager.json",
        "fixtures/google/ga4/runReport.empty.json",
        "fixtures/google/ga4/accountSummaries.list.json",
        "fixtures/google/gsc/searchanalytics.query.json",
        "fixtures/google/gtm/liveVersion.json",
        "fixtures/google/gtm/tags.oversize.json",
    ]
    for rel in required:
        load_json(rel)
    banned = ["breakwater", "axos"]
    for path in (ROOT / "fixtures").rglob("*"):
        if path.is_file():
            lower = read(path).lower()
            for word in banned:
                if word in lower:
                    err(f"{path.relative_to(ROOT)}: forbidden client/copy token {word!r}")


def main() -> int:
    check_required_files()
    check_skills()
    check_catalog_and_tools()
    check_manifests()
    check_permissions_doc()
    check_no_googleapiclient()
    check_secrets()
    check_support_line()
    check_readme_auth()
    check_fixtures()
    if ERRORS:
        print("SPEC INVALID")
        for item in ERRORS:
            print(f"  - {item}")
        return 1
    catalog = json.loads(read(ROOT / "schemas/v1/catalog.json"))
    print(f"SPEC OK  tools={catalog['count']}  skills={len(SKILLS)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
