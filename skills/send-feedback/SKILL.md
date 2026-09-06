---
name: send-feedback
description: After a real diagnosis of a hard plugin failure, offer once to prepare a draft for support@dgtlsunrise.com. Show the draft and wait for the user to approve before feedback_send. Never send tokens. Do not nag on LICENSE_REQUIRED, empty rows, or the ordinary property picker.
---

# Send plugin feedback

Users’ agents can prepare feedback and, **after explicit approval**, send it to DGTL. Destination mailbox is **support@dgtlsunrise.com**. Reply-To is the address the user provided.

This is diagnostics, like `support_packet`. It is not a sales tool. Engagement / client-work email stays **noel@dgtlsunrise.com**.

## When to offer (once)

Offer **once** after you have actually diagnosed a **hard failure**, for example:

- `ACCESS_NOT_CONFIGURED` / publisher API-not-enabled
- Persistent `GOOGLE_UNAVAILABLE` after a retry
- `UNAUTHENTICATED` / `REAUTH_REQUIRED` that is still broken after the documented AuthPort steps
- A 403/500 that is not a picker or empty-property non-bug

Do **not** offer, and do not nag, on:

- `LICENSE_REQUIRED` (that is `pro-upgrade`)
- Empty rows / `ok: true` with no data
- Ordinary property picker (“which of the 40?”)
- Successful how-tos, GSC recipes, or GTM audits that already worked

## Flow

1. Finish the diagnosis first. Use `google_whoami` and the failing family. Call `support_packet` with `last_tool`, `error_code`, and `resource_id` (no tokens).
2. Ask the user if they want a draft sent to DGTL. If they decline or ignore, stop.
3. Ask for a **Reply-To email** they check. Then call `feedback_prepare` with `message`, `reply_to`, optional `kind` (`bug` | `feature` | `other`), and the last tool / error / resource.
4. **Show the draft** (`draft_text`) and the `draft_id`. Do not send yet.
5. Only after the user clearly approves **this turn**, call `feedback_send` with `confirm: true` and that `draft_id`.
6. If they edit the message, re-run `feedback_prepare` and show the new draft. Never invent `confirm: true`.

## Forbidden

- Calling `feedback_send` without `confirm: true` or without a matching `draft_id`
- Putting refresh tokens, access tokens, `client_secret`, `token.json`, JWTs, or HARs with `Authorization` in `message`
- Echoing a pasted token back
- Changing the destination away from `support@dgtlsunrise.com`
- Using this channel for the engagement pitch (that line stays `noel@dgtlsunrise.com`)
- Offering feedback on every empty report or Ads upsell
