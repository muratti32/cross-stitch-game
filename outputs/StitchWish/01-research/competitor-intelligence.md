# Competitor Intelligence: Stitch Wish (Cross Stitch&Needlepoint Game)

Fetched: 2026-10-08. Storefront: US App Store (primary). Google Play: mostly unknown (see section 5).

## 0. Method and sources

| Source | Used for | Reliability |
|---|---|---|
| iTunes Search API, `https://itunes.apple.com/search?term=...&entity=software&country=us&limit=25` (6 terms) | Discovery, rating, rating count, price model, genre, release and update dates | Real API data. Search order is API relevance order, NOT App Store search rank. |
| iTunes Lookup API, `https://itunes.apple.com/lookup?id=...&country=us` (batch of 14 ids) | Full description, version, seller, rating, counts | Real API data |
| WebFetch of `apps.apple.com/us/app/<slug>/id<id>` | Subtitle (not in API), IAP price points | Model-summarised. Subtitles checked against the page. Price points are indicative. |
| Regional searches `country=gb,tr,de` (term "cross stitch", limit 10) | Locale variance | Real API data |
| Google Play HTML (curl) and WebSearch | Play installs and rating | Mostly NOT usable (see section 5) |

Raw JSON: `raw/search_us_*.json`, `raw/lookup_us_batch.json`, `raw/lookup_us_stitchwish_self.json`, `raw/search_{gb,tr,de}_cross_stitch.json`, `raw/webfetch_extracts.json`, `raw/play_*.html`.

Rating and rating-count figures are the API values (`averageUserRating`, `userRatingCount`, all-version). WebFetch page values round them and were consistent in all cases checked.

## 1. Selected competitors

Eight direct cross-stitch competitors (game or stitch-by-number apps), plus two adjacent color-by-number leaders. Selection criteria: the title or description is about cross stitch, or the app is a top result for "cross stitch" in US/GB/TR/DE.

Watch-list, not scored: Cross Stitch King (1420415726, 4.70 / 612, free, "Easy board game"). Colors by Number No.Draw (1317690198, 4.68 / 73,857). stitch. by Lykkegaard (1581052096, 4.83 / 34,775, embroidery-hoop puzzle, IAP unknown).

### 1a. Direct competitors (US App Store)

| # | App (trackId) | Subtitle (WebFetch) | Rating (API) | Ratings (API) | Price model | Released | Last update | Genre (API primary) | Developer |
|---|---|---|---|---|---|---|---|---|---|
| D1 | Magic Cross-Stitch: Pixel Art (1461096984) | Zen Stitching & Coloring Book | 4.85 | 6,408 | Free + IAP. Subscription with free trial. Weekly-style $7.99 premium. $4.99 no-ads. | 2020-09-17 | 2026-04-21 | Games | ZiMAD / XIMAD, Inc. |
| D2 | Cross-Stitch World (1034256780) | Relaxing cross-stitch puzzle | 4.72 | 6,343 | Free + IAP. Consumable "Cross-Stitch Cash" $5.99 to $45.99. | 2016-04-01 | 2026-09-25 | Games | InertiaSoft ltd |
| D3 | Cross-Stitch: Color by Number (1246165006) | Cross stitch with your photos! | 4.65 | 15,832 | Free + IAP. Weekly $3.49, subscriptions $9.99 and $59.99, NO ADS $0.99. | 2017-08-25 | 2026-05-01 | Entertainment | 炳甲 梁 |
| D4 | Cross Stitch Coloring Art (1587318796) | Relaxing & creative sew game | 4.71 | 7,911 | Free + IAP. VIP Monthly $19.99. Remove ADS $7.99. | 2021-11-20 | 2026-06-11 | Games | Playcus Limited |
| D5 | Cross-Stitch: Coloring Book (1499339385) | The amazing puzzle board game | 4.58 | 11,705 | Free + IAP. Subscriptions and boosters. | 2020-04-03 | 2026-05-07 | Games | Playcus Limited |
| D6 | Cross Stitch Club (1443781025) | Coloring by number with a hoop | 4.75 | 3,745 | Free + IAP. Weekly $5.99 after 3-day trial. Monthly $17.99. Yearly (not captured). | 2019-01-29 | 2026-02-25 | Games | Andrey Baryshnikov |
| D7 | Stitchly: Cross stitch (1467867656) | Cross-stitch pattern maker | 4.78 | 2,255 | Free + IAP. No subscription: Full Version $75.00 one-time, Special Offer $39.99. | 2019-06-15 | 2026-10-07 | Lifestyle | Subtlabs Ltd |
| D8 | Cross Stitch: Antistress (6769534330) | Color by number with a yarn! | 4.82 | 97 | Free + IAP. Monthly from $14.99. | 2026-07-08 | 2026-08-04 | Lifestyle | Crimson Pine Games sp. z o.o. |

### 1b. Adjacent color-by-number leaders (US App Store)

| # | App (trackId) | Subtitle (WebFetch) | Rating | Ratings | Price model | Released | Last update | Genre | Developer |
|---|---|---|---|---|---|---|---|---|---|
| A1 | Happy Color® – Coloring Games (1407852246) | Сolor by number art for adults (contains a Cyrillic С) | 4.80 | 3,424,645 | Free + IAP. Premium Year $49.99. | 2018-07-29 | 2026-08-01 | Games | X-FLOW LTD |
| A2 | Color by Number：Coloring Games (1317978215) | Pixel art coloring book game | 4.74 | 1,807,309 | Free + IAP. Weekly subscription with free trial. | 2017-12-13 | 2026-10-07 | Entertainment | Wildlife Studios |

### 1c. Our app (self, for comparison)

| App | Subtitle | Rating | Ratings | Price | Current version | Notes |
|---|---|---|---|---|---|---|
| Cross Stitch&Needlepoint Game (6792383323) | Relax: color by number art | none yet | 0 | Free + IAP, $1.99 to $39.99 | 1.3, 2026-09-25 | Store page says not enough ratings to show an overview. Not returned by any of the 6 US search terms or the GB/TR/DE top 10. |

## 2. Per-competitor detail (title, subtitle, description themes, keyword use)

**D1 Magic Cross-Stitch: Pixel Art.** Highest-rated direct app (4.85, 6.4K). Title leads with "Pixel Art". Subtitle is "Zen Stitching & Coloring Book", so "zen" and "coloring book" are indexed. Themes: pictures "for adults and kids", "just paint by numbers", AR "wall" sharing, daily bonuses, "user-created pixel art images" for subscribers. Says "relax" and "stress". No DMC or AI claim. Monetization is aggressive: a $7.99 premium and ads-off purchase. Note the Play developer mismatch: XIMAD (App Store seller) vs ZiMAD (support e-mail and BlueStacks).

**D2 Cross-Stitch World.** Most established direct app (2016 release, 6.3K ratings, 4.72). Subtitle "Relaxing cross-stitch puzzle". Themes: "10,000+ patterns", "Create your own patterns from any photo or image", "Relaxing, easy-to-play stitching at your own pace", "realistic visuals", "Suitable for all ages". Its US search rank on "cross stitch" is #1 (API order). Closest in mechanic to Stitch Wish (tap per stitch, photo import). No AI, DMC or offline claim in description.

**D3 Cross-Stitch: Color by Number.** Largest direct rating base (15.8K, 4.65). Subtitle "Cross stitch with your photos!" makes photo-to-pattern its head claim. Themes: "100000+ different style patterns", "Turn your own photos into cross-stitch patterns!", "New patterns released weekly!", categories (Animals, Art, Flowers, Landscape, People, Comic, Pets). Ranks #2 for US "cross stitch", #1 in TR and DE (localized as "Kreuzstich: Cross Stitch" in DE). Strongest photo competitor. No AI or DMC claim.

**D4 Cross Stitch Coloring Art.** 7.9K, 4.71. Subtitle "Relaxing & creative sew game". Themes: beginner-friendly ("just choose the suitable color and click"), "anti-stress pictures", "New patterns every day!", "10+ categories", calm background music. Does not mention photo import, DMC or AI. Playcus, the same publisher as D5 and Cross Stitch Craft (6443615393) and Mandala (1518562277): a portfolio of stitch-branded apps.

**D5 Cross-Stitch: Coloring Book.** 11.7K ratings, 4.58, lowest rating of the direct group. Subtitle "The amazing puzzle board game". Themes: a wide free pattern range, "Bring your own pictures to life using import", "Take a photo or import a picture", festive patterns. Imports photos, so photo-to-pattern is not unique. Playcus portfolio again.

**D6 Cross Stitch Club.** 3.7K, 4.75. Subtitle "Coloring by number with a hoop". Themes: "Forget stress and anxiety", "meditation app for true cross-stitchers", "color or sew just by one finger", "magic needles", rewards ("Earn nice souvenirs"), "Share your embroidery with your friends". Most "meditation" language of the set. Has in-app currency and a 3-day trial on weekly. Does not mention photo import, DMC or AI.

**D7 Stitchly: Cross stitch.** Pattern-maker utility, not a game. 2.3K, 4.78. Subtitle "Cross-stitch pattern maker". Themes: convert photos, "Use DMC and Anchor thread", export a printable PDF, track progress, "No subscriptions (pay once, enjoy forever)". The only direct app that names DMC as a feature and sells a one-time price. Its "photo" and "DMC" positioning overlaps ours, but it is a tool for designers, not a relaxing game.

**D8 Cross Stitch: Antistress (new, 2026-07-08).** Most important new entrant. 97 ratings and 4.82 so far. Subtitle "Color by number with a yarn!". Developer Crimson Pine Games runs an "Antistress Games" portfolio. Its description is a direct positioning attack on pixel-style apps: "Hyperrealistic, not pixel art. While other cross stitch apps render stitches as flat, childlike pixel grids..." Also claims "Authentic content. Patterns and DMC thread palettes match what real cross stitchers use" and "Digital unlocks physical. Complete an artwork in the app and earn its free printable PDF pattern". It uses the exact phrasing "No timers, no lives, no fail states" and "Zero anxiety by design". This is the closest positioning overlap with Stitch Wish's DMC, no-timers and calm claims.

**A1 Happy Color.** 3.4M ratings, 4.80. Adjacent scale benchmark. Titles and descriptions push "40,000 FREE pictures", Disney content and "community". Shows where a broad color-by-number audience sits.

**A2 Color by Number：Coloring Games (Wildlife).** 1.8M ratings, 4.74. Subtitle "Pixel art coloring book game". Themes: "import your own pictures", "share your masterpieces with our vibrant community". Shows that "pixel art" and "import/community" are mainstream terms in the adjacent space.

## 3. Locale variance: "cross stitch" top 3 (API order, limit 10)

| Storefront | #1 | #2 | #3 | Notes |
|---|---|---|---|---|
| US (limit 24) | Cross-Stitch World | Cross-Stitch: Color by Number | Stitchly: Cross stitch | Our app not in top 24 |
| GB | Cross-Stitch World | Cross-Stitch: Color by Number | Magic Cross-Stitch: Pixel Art | Our app not in top 10 |
| TR | Cross-Stitch: Color by Number | Stitchly: Cross stitch | Cross Stitch Club | Our app not in top 10. Cross Stitch: Magic Embroidery (6444124006) appears at #5 with 0 ratings. |
| DE | Kreuzstich: Cross Stitch (= Cross-Stitch: Color by Number, localized name) | Cross-Stitch World | Cross Stitch:Collection (EYEWIND) | Stitchly localized as "Stitchly: Kreuzstich" at #4. Antistress at #6. Our app not in top 10. |

Read-out: Cross-Stitch: Color by Number leads or ties in three of four storefronts. In DE, its localized title uses "Kreuzstich", which shows the local head term. Cross-Stitch World is #1 in US and GB. Ours is absent from all four lists.

## 4. Other term-level observations

- Title use among direct apps: "cross stitch" or "cross-stitch" appears in 8/8 direct titles. "Pixel" appears in 1 (D1). "Coloring" in 2 (D5 and D4 "Coloring Art"). "Color by Number" in 1 (D3). "Pattern maker" appears only in a subtitle (D7). "Needlepoint" appears in none of the 8.
- Subtitle use: "relax" or "relaxing" in 2 of 8 direct subtitles (D2, D4) and in ours. "Color by number" or "coloring by number" in D6 and D8 and in ours. "Photo" in D3 only. "Zen" in D1 only. "Puzzle" in D2 and D5.
- Descriptions (full text, verified by regex and read): AI or generation terms appear in 0 of 8 direct and 0 of 2 adjacent descriptions. Offline or "no internet" appears only in Cross Stitch King (watch-list). "No timers" or "no lives" appears only in D8 (Antistress). DMC, floss or Anchor appears in D7 and D8 only. Community or creator language appears in A1 and A2 (adjacent). Social or friend sharing appears in D1, D5 and D6. "Creator profile" appears in none. (D7 "share" refers to purchase sharing, not social sharing.)
- Search-term check: the "needlepoint" search results are dominated by shopping and pattern-tool apps (e.g. Needlepoint, Needlepoint.Com, BeStitched), not games. Only Cross Stitch Club and Magic Cross-Stitch from the game set appear.

## 5. Google Play (status: mostly unknown)

| App | Installs | Rating | Ratings | Status |
|---|---|---|---|---|
| Stitch Wish (com.avk.stitchwish) | unknown | unknown | unknown | Play HTML returned a JS shell (about 1 MB) with no parseable title, rating or install count. Listing may be unpublished or unindexed. Verify in the Play Console or a browser. |
| Cross-Stitch World | 3,054,235+ (third-party) | 4.7 (third-party) | unknown | Source: Grand Screen aggregator, via WebSearch. Undated and unverified. Not from Play. |
| Magic Cross-Stitch (com.zimad.mpixel, package inferred) | 1M+ (third-party) | 4.8, about 6K ratings (third-party) | about 6K (third-party) | Source: Spark by MWM mirror. Undated and unverified. Play HTML parse did not give a reliable install bucket. |
| All other direct apps | unknown | unknown | unknown | Play package IDs not confirmed. Not fetched. |

## 6. Data we could NOT obtain

- Subtitles for all rivals: obtained via WebFetch, not the API. Model-summarised. Spot-check before quoting externally.
- Keyword field (100 chars) for competitors: not exposed by any public API or page.
- Search volume and keyword difficulty: no source available. iTunes gives no volume data. Needs Apple Search Ads or a third-party ASO tool.
- Competitor ranking for our target keywords in the real App Store search: the API order is not App Store rank. Our app missing from API results may be index lag. Verify on device.
- Full IAP price tables for D4, D6 yearly, D5 and A2: only partial figures captured.
- Google Play installs and ratings for almost all apps (section 5).
- Download estimates (Sensor Tower, AppMagic, etc.): not used. No credentials or access.
