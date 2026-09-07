# Marketplace, Meta Review, upgrade copy (drafts)

Locked price: Pro **$19/mo** flat, unlimited. Free = local GA4/GSC/GTM. Checkout URL: Polar Pro live — see `/workspace/dgtl-planning/ops/POLAR-PRO-LIVE-2026-09-07.md` (canonical Meta packet: [META-APP-REVIEW-PACKET.md](META-APP-REVIEW-PACKET.md)).

---

## A) Marketplace listing blurb

**Short description (one line)**  
Read-only GA4, Search Console, and Tag Manager on your computer. You authorize Google; DGTL does not see your report bytes.

**Longer listing**

DGTL Marketing connects your Grok Bot (or Cursor) to Google Analytics 4, Search Console, and Tag Manager over stdio. Auth stays on your machine. No DGTL account required for the free tools.

**Free**
- List and report on GA4 properties you pick
- Search Console search analytics
- Tag Manager read (accounts, containers, tags, triggers, variables)
- No signup, no tool-call meter

**Pro ($19/mo, flat)**
- Google Ads and Meta Ads through DGTL’s hosted gateway (your OAuth; our developer token stays on the Worker)
- Later: server-side GTM / delayed conversions where we host infra
- Unlimited use on the plan — we do not meter tool calls

**About Google’s “unverified app” screen**  
The free Google login uses our OAuth client. Google’s verification for that client is still in review. Until it finishes, Google may show a warning that the app is not verified. That is expected. You can continue past it for your own account; it does not mean the plugin is unsafe or that we can see your GA4 data. We will update this listing when verification clears.

**Not included in free**  
Campaign mutate, GTM publish, or anything that needs a paid license / separate Ads or Meta consent.

Privacy: https://www.dgtlsunrise.com/privacy  
Contact: noel@dgtlsunrise.com

---

## B) Meta App Review packet (canonical)

**Canonical file:** [META-APP-REVIEW-PACKET.md](META-APP-REVIEW-PACKET.md) (polished 2026-09-07 PT).

**Goal:** Advanced Access so customers (not only app admins/testers) can grant `ads_read` for reporting through DGTL Pro + stamp.

**Request for v1:** `ads_read` only. Do **not** submit `ads_management` until gated writes ship.

**Ready (do not re-do):** BV for SUNRISE CONSULTING LLC; Polar Pro live; stamp `https://dgtl-stamp.noel-4ea.workers.dev`; privacy URL; Marketing API + Login for Business; Graph Explorer Insights in last 30 days.

**Still Noel:** Pro Bot screencast (script in packet) + App Review submit for `ads_read` Advanced Access. Agent does not submit Meta forms.

---

## C) Upgrade skill + error copy ($19)

### Skill draft: `skills/pro-upgrade/SKILL.md`

```markdown
---
name: pro-upgrade
description: >-
  Use when the user asks about Google Ads, Meta Ads, server-side GTM, delayed
  conversions, or a paid tool returned LICENSE_REQUIRED / GATEWAY_UNAVAILABLE.
  Explain free vs Pro ($19/mo flat). Do not nag on ordinary GA4/GSC/GTM questions.
---

# Pro upgrade

## Free (no account)
GA4, Search Console, Tag Manager readonly on the user’s computer.

## Pro — $19/mo flat, unlimited
Hosted Google Ads + Meta Ads gateway. User OAuth on-device; DGTL holds the Ads developer token / Meta app secret on the Worker. No tool-call metering.

## When to mention Pro
- User asks to manage, report on, or connect **Google Ads** or **Meta Ads**
- User asks for **server-side GTM**, **sGTM**, or **delayed conversions** (hosted)
- Tool returned `LICENSE_REQUIRED` or `GATEWAY_UNAVAILABLE`

## When not to
- Normal GA4 / GSC / GTM readonly work
- Every message in a long session after they already declined

## What to say (short)
Pro is $19/mo flat for Ads/Meta through DGTL. Free tools keep working. Checkout: <POLAR_CHECKOUT_OR_SITE>. Never ask for a Google Ads developer-token or Meta app secret.
```

### Replace `LICENSE_REQUIRED` user-facing string

```
Google Ads and Meta Ads need DGTL Pro ($19/mo flat, unlimited). Free GA4, Search Console, and Tag Manager still work. Get Pro at <CHECKOUT>, then set the license JWT (DGTL_LICENSE_JWT or PLUGIN_DATA/license.jwt). Never paste a Google Ads developer-token.
```

### `GATEWAY_UNAVAILABLE` add-on line (optional)

```
… If you just subscribed, wait for the gateway URL to be configured or set DGTL_GATEWAY_URL from DGTL’s docs.
```

### Tool description hint (Ads/Meta tools)

Append to paid tool descriptions: `Pro $19/mo. Returns LICENSE_REQUIRED without a DGTL license.`

---

## Plugin update checks

**Today:** no periodic update checker in `dgtl-marketing`. Version is `plugin.json` / `PLUGIN_VERSION` only. Marketplace hosts (Grok/Cursor) usually update when the user updates the plugin or the marketplace pin moves.

**What we can add (recommended, light):**
1. **`plugin_status` or extend `license_status`** — returns installed `version`, and optionally fetches `https://raw.githubusercontent.com/dgtlsunrise/dgtl-marketing/main/plugin.json` (or a tiny `https://www.dgtlsunrise.com/plugin/dgtl-marketing/latest.json`) and compares semver.
2. **Skill rule** — if latest > installed, tell the user once: “A newer dgtl-marketing is out (x.y.z). Update via marketplace / `grok plugin install`.”
3. **Do not** background-poll every N minutes from the MCP server (noisy, needs network, surprises offline users). Prefer: check on `license_status`, on MCP server start (once per process), or when a paid tool runs.

**Caveat:** pinned marketplace SHA means “latest on GitHub” may be ahead of what marketplace serves until the listing pin is bumped — say that in the message (“marketplace pin may lag; listing update required”).
