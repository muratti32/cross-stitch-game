# Research Actions: Stitch Wish (ASO competitor pass)

Fetched: 2026-10-08. Source docs: competitor-intelligence.md, competitor-gaps.md. Nothing under metadata/, app/, backend/ or docs/ was changed. These are recommendations for the owner and the aso-optimizer step.

Priority: P0 do first (blocks everything else). P1 this release cycle. P2 later.

## P0: Verify and get missing data

- [ ] **Confirm search visibility on device.** Search "cross stitch", "cross stitch game", "pixel art coloring" and "needlepoint" in the US App Store. Our app is not in the API results (6 terms) or in the GB, TR or DE top 10. Lookup works, so this may be index lag. If still missing after several days, check the app's search indexing status.
- [ ] **Get search volume and difficulty** for at least: cross stitch, cross stitch game, pixel art, color by number, paint by number, needlepoint, antistress, ai cross stitch, photo to cross stitch, stress relief coloring. Source: Apple Search Ads Basic or an ASO tool. Without this, every keyword change in P1 is a guess.
- [ ] **Check Google Play listing.** `com.avk.stitchwish` returned an unparseable page. Confirm whether the Play listing is live and record its installs and rating. Verify the Play package IDs for Magic (com.zimad.mpixel) and Cross-Stitch World before relying on any Play figure.
- [ ] **Confirm subtitle and price data** for the rivals that were summarised rather than quoted: spot-check D1 to D8 subtitles on the live page before quoting them externally.

## P1: Positioning and copy (this release cycle)

- [ ] **Test AI plus photo as the lead message.** Zero of 8 direct rivals and 0 of 2 adjacent apps mention AI in their store copy. Candidate subtitle to test (30 chars max, check the count before use): "Photo & AI cross stitch" (23). Candidate promo text (170 chars): lead with "Turn your photos or a text prompt into a stitchable pattern". Validate with volume data first. Check that AI-generated art is acceptable for the target audience.
- [ ] **Do not lead with "no timers, no lives".** Cross Stitch: Antistress (D8) uses the same phrase, and its description is nearly identical in tone. Keep the claim in the description, but do not use it in the subtitle or promo text.
- [ ] **Make "real DMC, really stitchable" provable.** D8 offers a printable PDF after completion and D7 offers a printable PDF export. Our "DMC-style" wording is softer than rivals' "DMC palettes". Action: rephrase to what the app actually does (for example, "Real DMC-style floss colors"), and check the wording is accurate. Product question for the owner: does Stitch Wish need a printable chart export to match D8? Record the answer; do not build it from this research alone.
- [ ] **Decide what "pixel" means in our visual identity.** D8 claims rivals' pixel style is "childlike" and markets "hyperrealistic, not pixel art". Our keyword field and D1's title both use pixel. Pick one: (a) keep pixel and show crisp grid screenshots, or (b) drop pixel from headline copy and keep it in keywords only.
- [ ] **Screenshot plan** (feed to aso-optimizer): screenshot 1 shows photo to pattern. Screenshot 2 shows the AI-prompt art. Screenshot 3 shows the DMC palette mapping. Screenshot 4 shows offline or calm play. Avoid claims that appear only in competitor copy.

## P1: Keyword field (100 chars, currently 98)

Current: `embroidery,pixel,coloring,needlework,craft,pattern,calm,sewing,painting,puzzle,zen,floss,hobby,diy`

- [ ] **Add "photo"** (rivals D3, D2, D5, D7 use it). Highest-confidence addition.
- [ ] **Add "stress"** (or "stress relief") and/or "meditation". Rivals D1, D4, D6, D8 use this language. Our current calm and zen terms are generic.
- [ ] **Add "ai art"** (or "ai") as a test. Unclaimed in rival copy. Only add after volume data exists.
- [ ] **Remove candidates** (low expected value, hypothesis only): "diy" and "hobby". Replace with the higher-value terms above. Re-check against volume data before final removal.
- [ ] **Do not add "dmc"** until a trademark and metadata-policy check is done. It is a third-party brand.
- [ ] **Do not repeat title or subtitle words** in the keyword field (cross, stitch, needlepoint, game, color, number, art, relax). They are already indexed.
- [ ] **Antistress as a keyword** is a competitor brand term and may be rejected or flagged. Check before any change, and only if volume supports it.

## P1: Ratings

- [ ] **Ratings are the largest visible gap.** We have 0 ratings. Rivals range from 97 (D8, new) to 15,832 (D3). Action: add an in-app review prompt after a clear completion milestone (for example, finishing a pattern), using the platform review API, once per user, and never gated on rating. Note in the release plan for the owner.

## P2: Later

- [ ] **Title test.** D1 (highest-rated direct app) uses "Pixel Art" in the title. Our title is "Cross Stitch&Needlepoint Game". Consider a variant such as "Cross Stitch Pixel Art Game" (27 chars), then test with Product Page Optimization. Trade-off: "needlepoint" in the title serves almost no game-intent search (its results are shopping and tool apps). Check volume before removing it.
- [ ] **Localization check (read-only).** DE #1 for "cross stitch" uses the localized term "Kreuzstich". Verify the de-DE title and keywords include "Kreuzstich". Also check tr-TR. Do not edit under metadata/ without owner approval.
- [ ] **Monitor Cross Stitch: Antistress (D8).** New (2026-07-08), 97 ratings, 4.82. Its positioning overlaps ours (DMC, no timers, calm, printable). Re-check its rating and copy monthly.
- [ ] **Monitor Cross-Stitch: Color by Number (D3).** Strongest photo competitor, 15.8K ratings. Track its subtitle and "photo" messaging monthly.
- [ ] **Weekly subscription pricing check.** Rivals sell weekly plans at $3.49 to $7.99 and trial periods on some. Compare our weekly and monthly prices against D1, D3 and D6. Requires our subscription table (not reviewed here).
- [ ] **Quarterly competitor refresh.** Re-run the 6 search terms and lookup batch. Save output to raw/ with a dated filename.

## Data limits to keep in view

- No search-volume data. Every keyword recommendation is a hypothesis until P0 volume data is in.
- Subtitles and IAP figures come from WebFetch summaries, not raw HTML.
- Google Play data is third-party and undated, except for the Play HTML that could not be parsed.
- The iTunes API search order is not App Store search rank.

## Handoff

**Next:** aso-optimizer. Inputs: keyword-list (not yet produced; keyword swaps above are candidates only), competitor-gaps.md section 4 (positioning), and the screenshot plan. Complete P0 volume and visibility checks before the aso-optimizer drafts final copy.
