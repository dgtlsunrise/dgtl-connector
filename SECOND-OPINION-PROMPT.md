You are Grok Build doing a SECOND OPINION on a product/development plan. Do not implement an MCP server. Do not call Google or Meta APIs. Do not send, publish, spend, or contact anyone. Do not invent secrets.

Read:
- SCOPE-AND-PLAN.md (locked commercial + build sequence)
- STEP-0-PLAN.md (earlier architecture notes; SCOPE wins on conflict)

Context: DGTL Sunrise (Sunrise Consulting LLC) public Grok Bot plugin. First Cursor cloud pass produced a 22-tool readonly spec for GA4 + GSC + GTM only (whoami, 8 GA4, 6 GSC, 7 GTM). Noel then locked a bigger product: FREE local = GA4, GSC, GTM, GBP. PAID = Google Ads readonly + Meta Ads readonly via a thin DGTL credential stamp (Ads developer token + Meta app). No data plane. Writes off. Not TikTok/Shopify/HubSpot. Quality bar: xAI-grade, closed typed tools, fixture tests, easy to extend, one-shot the plan so we do not rebuild.

Your job:
1. Think the development plan all the way through (OAuth, Google Ads developer token wait, Meta App Review, marketplace review, license, agency 40-property isolation, Grok Bot vs Grok Build plugin formats, support, future writes).
2. Say what to KEEP.
3. Say what to CHANGE in the plan (concrete, not vibes).
4. Name real defects or missing work that would force a rebuild if ignored.
5. Suggest improvements to the final work product (tool shapes, packaging, tests) that punch above a startup.
6. Propose a one-shot Grok Build implementation order that you would actually want to execute.

Write the full review to SECOND-OPINION.md in this directory. Keep SCOPE-AND-PLAN.md as source of truth unless you must patch a factual error (then patch it and say so).
