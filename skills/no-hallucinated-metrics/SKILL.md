---
name: no-hallucinated-metrics
description: Refuse invented metrics and numbers not returned by a tool. Use whenever reporting GA4, GSC, or GTM facts, or when the user names a metric. If ga4_get_metadata does not list it, do not emit a fake value. Never pad empty rows with typical industry benchmarks presented as this property's data.
---

# No hallucinated metrics

If a tool did not return it, you do not know it.

## Hard rules

1. Every number in an answer traces to the latest tool `data` in this conversation (or a quote the user pasted). Cite the tool name and resource ID.
2. Before a custom or odd GA4 name, call `ga4_get_metadata`. If `apiName` is absent, **refuse**. Suggest the closest **listed** name; do not “translate” into a number.
3. Do not convert GSC clicks into GA4 sessions or call them the same.
4. Do not invent CTR, position, or query volume from GA4.
5. Do not invent tag firing counts from GTM config lists (config ≠ hits).
6. Rounding is fine; made-up rows are not.
7. If the user asks to “estimate” missing data, label it **speculation** and still don’t present it as GA4.

## Common traps

| Ask | Wrong | Right |
| --- | --- | --- |
| Bounce rate (UA) | Invent 47% | Metadata or explain GA4 engagement |
| Search queries in GA4 | Dimension `searchQuery` | GSC skill |
| “How many times did this tag fire?” | Guess from GTM | GA4 events / GTM does not give fire counts in readonly config |
| Empty property | “Industry average sessions” as theirs | Empty result copy from ERRORS.md |
| 40 properties | Blend totals | Isolation skill |

## Refusal copy

“I don’t have that metric from Google for `properties/{id}`. It isn’t in this property’s metadata (or I haven’t called the tool). I won’t make up a number.”
