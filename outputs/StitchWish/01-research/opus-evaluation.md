# Opus evaluation of the Haiku competitor research (2026-10-08)

## Data check
- Ratings and counts in `competitor-intelligence.md` match `raw/lookup_us_batch.json`.
- Our lookup is live: released 2026-08-31, v1.3 (2026-09-25), Games/Casual/Puzzle, 0 ratings.
- We are absent from every saved search set: 6 US terms (top 23–25 each) and the GB/TR/DE "cross stitch" top 10.
- Subtitles and IAP prices come from model-summarised WebFetch extracts (`raw/webfetch_extracts.json`). They are not raw HTML, so spot-check before quoting.

## Corrections to the report
1. **"Not visible in search" is overstated as a blocker.** The iTunes Search API is not App Store search ranking. An app 5 weeks old with 0 ratings, competing against 6K–16K-rating incumbents on the head term, is expected to sit below the top 25. Treat it as a signal and check it on device, but it is not an indexing bug until proven.
2. **"antistress" is a generic word, not a competitor brand.** It can be used as a keyword. The real question is search volume.
3. **AI-led positioning is risky.** Part of the craft audience reacts badly to AI art. Test it in promotional text or a Product Page Optimization variant before putting it in the subtitle.

## What matters most (ranked)
1. **Ratings.** 0 ratings vs 3.7K–16K for rivals. The app has no review prompt (no `expo-store-review` / `requestReview` in `app/`). Add `expo-store-review` after the first completed pattern, plus a later milestone. This is the highest-leverage fix and it is not copy work.
2. **Photo→pattern is table stakes and real-DMC is contested.** Our true differentiators are AI artwork (0/10 rivals mention it) and the community/creator catalog. Use both as differentiators, but test before committing (see correction 3).
3. **Keyword field (iOS, 100 chars).** Our differentiators ("photo", "ai") are missing from the keyword field. Low-intent words ("diy", "hobby", "calm") could make room for "photo", "stress", "antistress", "relaxing". Don't duplicate words already in the name or subtitle ("relax", "color", "number", "art", "stitch", "needlepoint"). Get volume from Apple Search Ads before changing anything.
4. **Long tail before the head term.** "needlepoint" has weak results in the US (Stitchpoint 228, Needlepoint 751 ratings). That is a realistic first ranking target, and our name already contains it.

## Still unknown
Search volume and difficulty, competitor keyword fields, Play installs and ratings, real rank positions.
