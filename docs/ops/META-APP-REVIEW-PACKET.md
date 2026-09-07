# Meta App Review packet — DGTL Sunrise / dgtl-connector

**App:** DGTL Sunrise (Meta Business app)  
**App ID:** `28413225151701670` (public)  
**Permission for v1:** `ads_read` only — **not** `ads_management`  
**Privacy:** https://www.dgtlsunrise.com/privacy  
**Contact:** noel@dgtlsunrise.com  
**Package:** `dgtl-connector` — https://github.com/dgtlsunrise/dgtl-connector  
**Stamp (live):** `https://stamp.dgtlsunrise.com` (backup `https://dgtl-stamp.noel-4ea.workers.dev`)  
**Pro checkout (live):** Polar DGTL Sunrise Pro $19/mo — see `/workspace/dgtl-planning/ops/POLAR-PRO-LIVE-2026-09-07.md`  
**Updated:** 2026-09-07 PT

## Goal
Advanced Access so paying customers (not only app admins/testers) can connect Meta ad accounts and let the Bot read performance via Pro + stamp gateway.

## Status

- Stamp gateway live: `https://stamp.dgtlsunrise.com` (backup `https://stamp.dgtlsunrise.com`).
 snapshot (2026-09-07 PT)

| Item | Status |
|------|--------|
| Business Verification | **Done** — SUNRISE CONSULTING LLC verified 2026-09-05 |
| Polar Pro $19/mo | **Live** (checkout + product active) |
| Stamp Worker | **Live** — `https://stamp.dgtlsunrise.com` |
| Privacy URL | Live + linked in app settings |
| Marketing API + Facebook Login for Business | Set up |
| Recent Insights API call | Satisfied (Graph Explorer 2026-09-05; empty data OK) |
| App mode | Development (OK until Review) |
| `ads_read` Advanced Access | **Submitted 2026-09-07** — Review in progress. Screencast CLEAN uploaded; Website platform https://www.dgtlsunrise.com. Access Verification (Tech Provider) may still arrive by email. |
| `ads_management` | Do **not** request |

Agent drives App Review + Tech Provider access verification as far as the console allows. Noel only for Meta login/2FA/ID uploads. Clean screencast: `/workspace/dgtl-planning/ops/meta-screencast/dgtl-sunrise-ads-read-app-review-CLEAN-20260907.mp4`.

---

## Written use case (paste into App Review)

DGTL Sunrise publishes the `dgtl-connector` plugin for Grok Bot and Cursor. Paying customers (DGTL Pro, $19/mo) connect their own Meta ad accounts so the agent can read campaign and account performance — spend, impressions, clicks, reach, and conversions — and answer questions in chat. Calls go through DGTL’s hosted stamp gateway. We do not use customer ads data to run our own advertising. The user’s Meta access token stays on their computer; the Meta app secret stays on DGTL’s Worker. v1 is read/report only; we are not requesting `ads_management`.

---

## Screencast script — Pro Bot path (`ads_read`)

**Target:** 2–4 minutes, English, one continuous take preferred.  
**Show:** full path from Pro Bot → Meta Login (`ads_read`) → pick ad account → Insights numbers on screen.  
**Do not show:** mutate/boost/create campaigns, app secret, Worker secrets, license JWT raw value, Axos or any client book-of-business accounts, Graph Explorer-only path as the product demo.

Use a **personal / DGTL-owned** ad account Noel administers. Empty Insights rows are acceptable if the HTTP path and metric columns are visible.

### Before you record

1. Stamp reachable: `https://stamp.dgtlsunrise.com` (Pro Bot uses this as gateway).
2. `dgtl-connector` installed in Grok Bot / Cursor; Pro license present (`license_status` shows Meta/ads features unlocked).
3. Browser zoom so Facebook Login app name **DGTL Sunrise** and permission text are readable.
4. If Meta already granted, revoke DGTL Sunrise under Facebook → Settings → Business integrations (or Apps and Websites) so Login is not skipped.
5. Confirm OAuth redirect URIs for hosted Login include the stamp host (see Noel checklist below).
6. Have one ad account id ready to pick out loud (`act_…`).

### Shot 0 — Title (optional, ~5s)

On-screen or voice: “DGTL Sunrise Pro — Meta ads_read reporting in Grok Bot. Read-only Insights for the customer’s own ad accounts.”

### Shot 1 — Cold start / Pro present (~20–30s)

1. Open Grok Bot (or Cursor) with `dgtl-connector` installed.
2. Run / show `license_status` (or equivalent): Pro active; Meta/ads tools available.
3. Optionally flash that gateway is the live stamp host (hostname only — no secrets).

**Voice:** “This is DGTL Pro. Meta Ads reporting goes through our hosted stamp gateway. Free GA4/GSC/GTM are separate and not part of this permission.”

### Shot 2 — Meta Login, grant `ads_read` (~45–75s)

1. Start Meta connect: `auth login-meta` / hosted Login (whichever is the live Pro path).
2. Open the Facebook Login for **DGTL Sunrise**.
3. Hold the consent UI so reviewers see app name and **`ads_read`** (Ads reporting / read performance — wording may vary).
4. **Do not** request or show `ads_management`.
5. Complete password / 2FA yourself (off-script; camera can stay on the consent screen after).
6. Land on success (hosted redirect on stamp host or “authorization saved” equivalent). Confirm token is stored on-device — do not paste the token.

**Voice:** “Facebook Login for DGTL Sunrise. We only ask for ads_read. The user token stays on this computer; the app secret stays on our Worker.”

### Shot 3 — List and pick ad account (~20–40s)

1. Call the Meta list-ad-accounts tool (or agent prompt: “list my Meta ad accounts”).
2. **Stop and pick one account out loud** — say the name and `act_…` id. Do not silently use the first row.
3. Confirm selection on screen.

**Voice:** “The plugin lists accounts I administer. I pick one explicitly.”

### Shot 4 — Read Insights / campaigns (~40–60s)

1. Run Meta Insights (or campaigns list + insights) for the chosen `act_…` (e.g. last 7 or 30 days).
2. On screen, show returned metrics: impressions, spend, clicks, reach, and/or conversions (whatever the tool returns).
3. Zoom so numbers (or empty-data JSON with metric fields) are readable.
4. If empty data: say “no spend in window; the Insights call succeeded.”

**Voice:** “This is read-only reporting — spend, impressions, clicks — for the customer’s own account through the Pro Bot.”

### Shot 5 — Close (~10–15s)

State verbally: “Read-only. No campaign create, edit, boost, or ads_management in this flow. Privacy policy at dgtlsunrise.com/privacy.”

### What not to film

- Creating/editing campaigns, boosting posts, uploading creatives  
- App secret, Worker env, Polar org tokens, raw `DGTL_LICENSE_JWT`  
- Axos or third-party client accounts without clear ownership  
- Graph Explorer as a substitute for the Pro Bot path (Explorer already satisfied the 30-day API-call prereq separately)

### Upload / attach

1. Export MP4 (or Meta’s accepted format). Unlisted YouTube is fine if Meta accepts a link; otherwise upload in the App Review form.
2. Title suggestion: `DGTL Sunrise Pro — Meta ads_read Advanced Access`
3. Description: homepage https://www.dgtlsunrise.com/ — privacy https://www.dgtlsunrise.com/privacy — support noel@dgtlsunrise.com — stamp host `stamp.dgtlsunrise.com`

---

## Noel-only checklist — remaining clicks to submit

Agent cannot finish these. Do in order when ready to submit.

### A. Console prep (before record)

- [ ] **A1.** Meta Developers → app `28413225151701670` → confirm privacy URL https://www.dgtlsunrise.com/privacy and contact noel@dgtlsunrise.com
- [ ] **A2.** Facebook Login for Business → add OAuth redirect URI(s) for stamp host, e.g. `https://stamp.dgtlsunrise.com/...` (exact path from stamp Login docs / PR-3b — hostname must match live Worker)
- [ ] **A3.** Confirm Marketing API product is set up; `ads_read` listed for review (Standard today)
- [ ] **A4.** Confirm Business Verification still shows **Verified** for SUNRISE CONSULTING LLC
- [ ] **A5.** Create or note a **reviewer test user** (or instructions for Meta to use a test role) and a short “how to test” note: install plugin → Pro license → Meta Login → list accounts → Insights
- [ ] **A6.** Optional: one Pro Bot Insights call through stamp in the last 30 days (Graph Explorer already satisfied the API-call prereq; Bot path preferred for the video)

### B. Record + attach

- [ ] **B1.** Record screencast using the script above (you on camera / your Facebook Login)
- [ ] **B2.** Upload video to App Review (or unlisted YouTube link if accepted)

### C. Submit App Review (`ads_read` Advanced Access only)

- [ ] **C1.** App Review → Permissions and Features → **`ads_read`** → Request Advanced Access
- [ ] **C2.** Paste **Written use case** from this packet
- [ ] **C3.** Attach screencast + reviewer test instructions / test user
- [ ] **C4.** Confirm you are **not** requesting `ads_management`
- [ ] **C5.** Submit. Answer Meta reviewer email from **noel@dgtlsunrise.com**
- [ ] **C6.** After approval: switch app to **Live** if Meta requires it for customer tokens; keep Development until then for admin/tester smoke

### Explicit non-goals this submit

- Do **not** contact Axos  
- Do **not** put secrets in the review form or video  
- Do **not** block Google Ads Basic Access / Polar / stamp on Meta approval — testers use Development mode until Advanced Access lands

---

## After approval

1. Switch app to Live as Meta requires.  
2. Keep redirect URIs aligned with stamp hostname.  
3. Document customer Pro path: buy Pro → redeem license → Meta Login → Insights.  
4. Defer `ads_management` until gated writes ship (separate review).

---

## Historical console notes (kept for audit)

### 2026-09-05 PT — early

App Development; BV unverified → then **in review** → email **Verification successful** for SUNRISE CONSULTING LLC (~4:20 PM PT). Marketing API + Facebook Login for Business set up. `ads_read` Standard; no App Review requested.

### 2026-09-05 PT — Insights dry-run

- Config: `GraphExplorer-dev` (`ads_read` only)  
- `GET me` 200; `GET me/adaccounts` 200 (personal/DGTL-related; **Axos not used**)  
- `GET act_<Noel Churchill>/insights?...&date_preset=last_30d` HTTP 200 (empty data OK)  
- Recent successful API call for App Review: **satisfied**

### 2026-09-07 PT — this polish

Polar Pro live; stamp live at `https://stamp.dgtlsunrise.com`. Packet updated for **Pro Bot screencast** + Noel submit checklist. Screencast + Advanced Access submit still Noel-only.
