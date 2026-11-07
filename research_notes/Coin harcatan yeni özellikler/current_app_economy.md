# Current App Economy and Feature Set (Stitch Wish / cross-stitch-game)

Scope: internal codebase research only, as of 2026-11-01 (branch `staging`, HEAD `d66a7981`). Sources are repo file paths relative to `/Volumes/ssd/react_native_workspace/cross-stitch-game` unless noted. The GitHub issue list was pulled with `gh issue list -R muratti32/cross-stitch-game --state all --limit 300` (266 issues returned).

## 1. What currencies exist, and how are they earned?

### Takeaway
There are exactly two balances. **Stitch Coin** is the gameplay currency. **AI Credit** is a separate paid unit used only for AI artwork. Nothing converts between them. Coin comes from Daily Tasks (30/day guaranteed), First Completion Rewards (25/60/120), Rewarded Ads and the Premium Daily Claim (one shared 30/day pool), and Coin Packs (300/900/2,000 for $1.99/$4.99/$9.99). There are no gems, hints, energy, or level currencies.

### Cited Findings
- **Two currencies only.** The backend type is `CommerceCurrency = 'coin' | 'ai_credit'`. — [backend/src/economy/commerce.constants.ts](backend/src/economy/commerce.constants.ts)
- **Stitch Coin** is the "backend-authoritative gameplay currency earned through play or Rewarded Ads, received through a Premium Daily Coin Claim, or purchased in a Stitch Coin Pack". It can never fund AI Artwork. Glossary entries to avoid: "Coin, gold, point, token". — [CONTEXT.md §Economy and Commerce](CONTEXT.md)
- **AI Credit** is a non-expiring balance. It is acquired only by purchase or a Membership Credit Grant, and "gameplay rewards never add AI Credit". One delivered AI Artwork costs exactly 1 credit. There is no Coin↔Credit exchange. — [docs/adr/0011-separate-ai-credit-from-gameplay-currency.md](docs/adr/0011-separate-ai-credit-from-gameplay-currency.md); [docs/adr/0003-fal-ai-artwork-with-purchased-credits.md](docs/adr/0003-fal-ai-artwork-with-purchased-credits.md)
- **Daily Tasks.** Three tasks per Reward Day, 10 Coin each, 30/day maximum:
  - 100 cell-level Stitch Actions
  - ≥10 Stitch Actions in each of 3 DMC colors
  - 1 Thread Color Completion

  Catalog, Personal, and Replay sessions all count. Tasks never require ads, purchases, AI, or sharing. They expire with "no streak loss or missed-day penalty". The constants are `DAILY_TASK_COIN = 10`, `DAILY_TASK_CELLS_TARGET = 100`, `DAILY_TASK_COLOR_ACTIONS_MIN = 10`, and `DAILY_TASK_DISTINCT_COLORS_TARGET = 3`. — [CONTEXT.md §Rewards](CONTEXT.md); [backend/src/economy/economy.constants.ts](backend/src/economy/economy.constants.ts)
- **First Completion Reward.** Granted once per eligible Official or Community Pattern, with tiers by stitchable cells:
  - Small (1–3,999 cells): 25
  - Medium (4,000–14,999): 60
  - Large (≥15,000): 120

  Color count is not a multiplier. Personal Patterns never mint it, and replays never repeat it. — [CONTEXT.md](CONTEXT.md); [backend/src/economy/economy.constants.ts](backend/src/economy/economy.constants.ts)
- **Rewarded Ads.** 10 Coin per verified completion (`AD_REWARD_COIN = 10`), at most 3 per day (`DAILY_AD_LIMIT = 3`). They draw from the 30-Coin **Ad-Equivalent Coin Pool** (`DAILY_POOL_COIN = 30`). Ads are started only by the player, outside active Stitching Sessions. There are no interstitials and no banners. Verification uses AdMob SSV. — [CONTEXT.md §Rewards](CONTEXT.md); [docs/adr/0033-verify-rewarded-ads-with-admob-server-side-verification.md](docs/adr/0033-verify-rewarded-ads-with-admob-server-side-verification.md)
- **Premium Daily Coin Claim.** Once per Reward Day, a Premium member collects whatever is left in the same pool: 30, 20, 10, or 0. Claiming closes the pool, so ads plus the claim never exceed 30/day. — [CONTEXT.md](CONTEXT.md); [docs/adr/0011…](docs/adr/0011-separate-ai-credit-from-gameplay-currency.md)
- **Reward Day** runs from `00:00 UTC` to `00:00 UTC`. It is server-authoritative, and the client never infers the reset from device time. — [CONTEXT.md](CONTEXT.md)
- **Stitch Coin Packs** (consumable):

  | Product ID | Coin | US price |
  |---|---|---|
  | `com.avk.stitchwish.coin_pack_300` | 300 | $1.99 |
  | `com.avk.stitchwish.coin_pack_900` | 900 | $4.99 |
  | `com.avk.stitchwish.coin_pack_2000` | 2,000 | $9.99 |

  Registered Accounts and iOS Guests can buy them. Android Guests must register first. — [docs/store-products.md](docs/store-products.md); [CONTEXT.md](CONTEXT.md); [docs/adr/0045-enable-ios-guest-stitch-coin-commerce.md](docs/adr/0045-enable-ios-guest-stitch-coin-commerce.md)
- **AI Credit Packs** (consumable):

  | Product ID | Credits | US price |
  |---|---|---|
  | `com.avk.stitchwish.ai_credit_pack_5` | 5 | $2.99 |
  | `com.avk.stitchwish.ai_credit_pack_20` | 20 | $9.99 |
  | `com.avk.stitchwish.ai_credit_pack_50` | 50 | $19.99 |

  — [docs/store-products.md](docs/store-products.md)
- **Premium Membership** (auto-renewing, in one subscription group):

  | Plan | US price | Membership Credit Grant |
  |---|---|---|
  | Weekly | $2.99 | 3 AI Credit per paid period |
  | Monthly | $7.99 | 15 AI Credit per paid period |
  | Annual | $39.99 | 180 AI Credit, all at once |

  Only Monthly has a 3-day free trial. The trial grants no AI Credit but unlocks themes and the daily coin claim. The full benefit list is: Membership Credit Grant, Premium Daily Coin Claim, and Premium Theme Collection. — [docs/store-products.md](docs/store-products.md); [CONTEXT.md §Premium Membership](CONTEXT.md); [docs/adr/0003…](docs/adr/0003-fal-ai-artwork-with-purchased-credits.md)
- **Paid Reserve.** Coin minted by a purchase is "spent after free value" and is reduced first by refunds or chargebacks. A Commerce Reversal can push the balance negative. Existing unlocks are never deleted. — [CONTEXT.md §Paid Reserve, §Commerce Reversal](CONTEXT.md)
- **Pending Coin Reward.** Offline Daily Task or completion evidence is stored locally and is not spendable until the backend reconciles it. — [CONTEXT.md](CONTEXT.md)
- **No Player Level.** "The first release has no Player Level or level-up Coin reward." — [CONTEXT.md §Unlock Earnability Target](CONTEXT.md)
- **RevenueCat wiring is incomplete.** The RevenueCat columns in the product table are still marked "*pending*", and the doc says: "Still to do before real purchases work: App Store Connect API key…, Play service-account credentials…, webhook pointed at the backend". Products were in `READY_TO_SUBMIT` as of 2026-08-06. — [docs/store-products.md](docs/store-products.md)

### Inferences
- A free player who does all Daily Tasks and watches all ads gets at most 60 Coin per day, plus one-off completion rewards. A Premium member gets the same 60 per day, because the claim only replaces ads. Premium buys convenience, not extra Coin.
- Coin Pack value is about 151 Coin/$ (300 pack) to 202 Coin/$ (2,000 pack). At that rate a Large unlock (300 Coin) is roughly $1.49–$1.99.

### Gaps
- Whether the RevenueCat columns marked *pending* in `docs/store-products.md` are now provisioned is not confirmed. That doc is dated 2026-08.
- I found no live production data on Coin balances, spend rates, or sink usage.

## 2. What do coins buy today, and at what price?

### Takeaway
Coin has exactly **two sinks**: (1) permanent **Pattern Unlocks** for paid Official Patterns at 75/150/300, and (2) the **Remaining Cell Locator** at an operator-set price of 1–10 Coin per successful use (starting value 1). Nothing else spends Coin. That includes themes, which are Premium-only, and AI art, which uses credits.

### Cited Findings
- ADR-0011's original rule: "In the first release Stitch Coin has exactly one spend: one-time, permanent Pattern Unlocks for Official Patterns". The locator part was later superseded by ADR-0058. — [docs/adr/0011…](docs/adr/0011-separate-ai-credit-from-gameplay-currency.md)
- **Pattern Unlock Price Tier.** Small 75, Medium 150, Large 300, using the same cell ranges as the completion tiers (`UNLOCK_PRICE_TIER_COIN = { small: 75, medium: 150, large: 300 }`). There is no popularity-based or dynamic pricing. Unlocks are permanent. Premium never grants temporary catalog access. — [CONTEXT.md §Pattern Unlock Price Tier](CONTEXT.md); [backend/src/economy/economy.constants.ts](backend/src/economy/economy.constants.ts)
- **Grandfathered Pattern Unlocks.** When an operator flips a free pattern to paid, every account or guest with any session on it gets a free unlock. Flipping paid back to free refunds nothing. — [docs/adr/0061-change-a-published-official-pattern-between-free-and-paid-with-grandfathered-unlocks.md](docs/adr/0061-change-a-published-official-pattern-between-free-and-paid-with-grandfathered-unlocks.md)
- **Paid catalog rollout (#260).** The plan selects 60 paid Official Patterns across 10 categories, 6 per category. It requires 6–10 Small-tier picks and makes at most half of Staff Picks paid. — [docs/paid-pattern-rollout.md](docs/paid-pattern-rollout.md)
- **Remaining Cell Locator.**
  - It centers the viewport on the next unfinished cell of the active color.
  - It is charged only on success, through a 60-second reservation, and costs nothing on no-target, failure, cancel, or offline.
  - The price is one global value from 1 to 10. It applies equally to guests and accounts, with no Premium discount. It is the "first Stitch Coin value an operator can change; every other economy amount stays defined in code". The migration sets it to 1.
  - It never fills cells, changes progress, grants rewards, or selects colors.

  — [docs/adr/0058-charge-remaining-cell-locator-with-server-authoritative-stitch-coin.md](docs/adr/0058-charge-remaining-cell-locator-with-server-authoritative-stitch-coin.md); [docs/adr/0060-let-operators-manage-a-single-global-locator-price.md](docs/adr/0060-let-operators-manage-a-single-global-locator-price.md); [backend/src/economy/locator-price.ts](backend/src/economy/locator-price.ts)
- **Locator Coin Shortfall** UI routes the player to Coin Packs (issues #265–#267). — [CONTEXT.md](CONTEXT.md); GitHub issues #265, #266, #267
- **Unlock Earnability Target** (a guardrail). Daily Task Coin alone must fund Small within 3 days, Medium within 5, and Large within 10. "Raising prices or lowering guaranteed task income beyond these bounds requires an explicit decision update." — [CONTEXT.md](CONTEXT.md); [docs/adr/0011…](docs/adr/0011-separate-ai-credit-from-gameplay-currency.md)
- **Community Patterns stay free** "avoiding creator revenue-sharing expectations and pricing manipulation". — [docs/adr/0011…](docs/adr/0011-separate-ai-credit-from-gameplay-currency.md)
- **Client surfaces** for the economy: `PatternLockBadge`, `DailyTasksCard`, `RewardedAdCard`, `PremiumDailyCoinClaimCard`, `LocatorCoinShortfallSheet`, and the Commerce Store at `app/app/(tabs)/(profile)/commerce.tsx`. — [app/src/components/](app/src/components/)

### Inferences
- Once a player has unlocked the patterns they want, Coin only flows out at 1–10 per locator use. A long-term player who earns 30–60 per day would pile up Coin. That gives a clear opening for new sinks.

### Gaps
- The current production Locator Price value is stored in the DB, not in code, so it is unknown.
- Whether the 60-pattern paid rollout has been applied to production is not confirmed from the files I read. Issue #260 is CLOSED.

## 3. What game features exist?

### Takeaway
Stitch Wish is a server-backed color-by-number cross-stitch game (Expo + Skia). Its main parts are:
- an Official plus Community pattern catalog with Staff Picks, New, categories, tags, and search
- local-first sessions with cloud sync, replays, and Daily Tasks
- photo or AI → Pattern conversion with a Personal Pattern Editor
- player catalog submissions with human moderation and public creator profiles
- Likes, share links, reports, and blocks
- Premium cosmetic themes

### Cited Findings
- **App tabs:**
  - `(catalog)`: index, browse, search, `[id]`
  - `(create)`: ai-generation, photo-import, pattern-editor
  - `(play)`: `[sessionId]`
  - `(profile)`: commerce, liked-patterns, public-profile, published-patterns, submissions, submit-pattern, moderation-notices, revise-pattern-metadata
  - `(settings)`

  There is also an `onboarding/` flow. — `app/app/(tabs)/…` directory listing
- **Discovery** has four deterministic surfaces: Staff Picks, New Patterns, Categories/Tags, and Search. There is no personalization, and Like counts do not affect ranking. — [docs/adr/0024-use-deterministic-catalog-discovery-without-personalization.md](docs/adr/0024-use-deterministic-catalog-discovery-without-personalization.md)
- **Bundled Starter Patterns** are free and playable offline on first launch. — [docs/adr/0037-bundle-starter-patterns-for-offline-first-launch.md](docs/adr/0037-bundle-starter-patterns-for-offline-first-launch.md); [CONTEXT.md](CONTEXT.md)
- **Gameplay controls:**
  - Thread Palette with Thread Color Numbers, Stitch Sweep, Edge Auto-Pan, Fit View, and Anchored Zoom
  - free Undo
  - Mismatched Tap is a "gentle, non-punitive no-op"
  - Handedness Layout (left or right)
  - Remaining Cell Locator (paid)
  - no auto-fill

  — [docs/adr/0030-use-accessible-numbered-controls-without-paid-assistance.md](docs/adr/0030-use-accessible-numbered-controls-without-paid-assistance.md); [CONTEXT.md §Gameplay Interaction](CONTEXT.md)
- **Sessions.** Local-first progress with cloud sync (ADR-0007). Completed sessions are preserved, and playing again creates a new Replay Session (ADR-0010). — [docs/adr/0007…](docs/adr/0007-local-first-progress-with-cloud-sync.md); [docs/adr/0010…](docs/adr/0010-preserve-completed-sessions-and-replay-with-new-sessions.md)
- **Creation:**
  - Conversion Profiles: Easy (50 short edge, ≤12 colors), Standard (100, ≤20), Detailed (150, ≤30)
  - free Custom Conversion: 20–300 cells per axis, 5–60 colors
  - Pattern Conversion is unlimited and free
  - Personal Pattern Editor saves create Derived Personal Patterns
  - AI artwork via fal.ai `flux-2/turbo` costs 1 AI Credit per delivery, with 3 aspects

  — [CONTEXT.md §Pattern Creation and Conversion](CONTEXT.md); [docs/adr/0003…](docs/adr/0003-fal-ai-artwork-with-purchased-credits.md); [docs/adr/0017…](docs/adr/0017-edit-personal-patterns-by-derivation.md)
- **Community submissions.** Patterns are immutable once moderated (ADR-0001). An automated precheck runs before human review (ADR-0019). A Public Creator Profile is required, with a permanent username (ADR-0020). Withdrawal is separate from safety removal (ADR-0009). Guests cannot submit. — [docs/adr/0020…](docs/adr/0020-separate-public-creator-profile-from-account-identity.md); [CONTEXT.md](CONTEXT.md)
- **Social scope** is limited to Pattern Like, Catalog Share Link, Community Report, Profile Report, and Creator Block. There are "no comments, creator-follow graph, direct messaging, or separate Favorite". Like totals are "display-only… no effect on… Stitch Coin, AI Credit, Premium benefits, or creator compensation". — [docs/adr/0023-bound-first-release-social-features-to-likes-sharing-and-safety-controls.md](docs/adr/0023-bound-first-release-social-features-to-likes-sharing-and-safety-controls.md)
- **Premium Theme Collection** is three cosmetic themes: `default` "Classic Linen", `rose-garden` "Rose Garden", and `moonlit-aida` "Moonlit Aida". They change grid backgrounds, completed-stitch looks, and completion animations, are membership-only, and revert when membership ends. The glossary lists "permanent theme purchase" under _Avoid_. — [app/src/membership/themes.ts](app/src/membership/themes.ts); [CONTEXT.md §Premium Theme Collection](CONTEXT.md); [app/src/components/ThemeCollectionCard.tsx](app/src/components/ThemeCollectionCard.tsx)
- **No achievements, badges, streaks, levels, quests, or events** exist in code or glossary. "Streak" is an _Avoid_ term for Daily Task. The completion-reward text does allow that sessions "may still advance separately defined quests or events" in the future. — [CONTEXT.md §Daily Task, §First Completion Reward](CONTEXT.md)
- **Onboarding** has four just-in-time hints and a tutorial engine (issues #130, #135, #136). These are UI hints, not a paid hint currency. — GitHub issues #130, #135

### Inferences
- The progression and meta layer (collections, achievements, events, cosmetics you own) is almost empty. That is where new Coin sinks would fit, as long as they stay cosmetic or convenience-only (see §5).

### Gaps
- I did not look at `vault/wiki/concepts/completed-stitch-visual-contract.md` in detail. It defines the completed-stitch visual rules, which matter for any cosmetic stitch skins.

## 4. What is planned, proposed, or explicitly rejected?

### Takeaway
Only three issues are open, and none is a new-feature request: #281 (Guest ad reward stranded after sign-in), #280, and #148 (both perf ANRs). Several sinks are explicitly rejected: paid assistance and auto-fill, penalizing mistakes, permanent theme purchases, paid Community Patterns, dynamic pricing, Premium catalog access, and Coin↔AI Credit exchange. The docs leave openings for "quests or events" and future higher-cost AI profiles.

### Cited Findings
- **Open issues:**
  - #281 "[economy] Ad reward earned as Guest is stranded after sign-in (guest promotion not wired)"
  - #280 "[Sentry][perf] Background ANR in accessibility subtree…"
  - #148 "[Sentry][perf] ANR: main thread blocked in HardwareRenderer.setStopped"

  — `gh issue list` output
- **Closed economy issues** (the history of what was built): #14 economy foundation, #15/#39–#41 Pattern Unlock, #16 Rewarded Ads, #17 RevenueCat commerce, #18 Premium Membership, #42–#44 Daily Tasks client and pending rewards, #244 locator charge, #256–#260 free/paid toggle and paid rollout, #265–#267 locator shortfall sheet. — `gh issue list` output
- **Deferred work** listed in the economy handoff:
  - Daily Tasks client wiring (later done in #42/#43)
  - offline Daily Task Pending Coin Reward reconciliation
  - Guest Data Promotion handling for unresolved First Completion claims
  - a standalone coin-balance / rewarded-ad UI surface

  — [HANDOFF-economy.md](HANDOFF-economy.md) (dated 2026-07-22, partly stale)
- **Explicitly rejected or prohibited:**
  - **Paid mistake correction or punishment.** Undo is free and Mismatched Tap is a non-punitive no-op. — [docs/adr/0030…](docs/adr/0030-use-accessible-numbered-controls-without-paid-assistance.md)
  - **Auto-fill / "paid auto-fill" / "auto-stitch".** "The first release deliberately omits auto-fill". These are _Avoid_ terms for the locator. — [docs/adr/0030…](docs/adr/0030-use-accessible-numbered-controls-without-paid-assistance.md); [CONTEXT.md §Remaining Cell Locator](CONTEXT.md)
  - **"Hint currency"** is an _Avoid_ term for the locator. — [CONTEXT.md](CONTEXT.md)
  - **Coin-gating core play or accessibility.** "Core play or accessibility capabilities are never coin-gated". — [docs/adr/0011…](docs/adr/0011-separate-ai-credit-from-gameplay-currency.md)
  - **Permanent theme purchase.** This is an _Avoid_ term under Premium Theme Collection, so themes are membership-only today. — [CONTEXT.md](CONTEXT.md)
  - **Popularity or dynamic pricing**, and **Premium temporary catalog access**. — [CONTEXT.md §Pattern Unlock Price Tier, §Pattern Unlock](CONTEXT.md)
  - **Paid Community Patterns and creator revenue share** in the first release. — [docs/adr/0011…](docs/adr/0011-separate-ai-credit-from-gameplay-currency.md)
  - **Coin → AI Credit exchange.** — [docs/adr/0011…](docs/adr/0011-separate-ai-credit-from-gameplay-currency.md)
  - **Streaks and missed-day penalties.** — [CONTEXT.md §Daily Task](CONTEXT.md)
  - **Player Level and level-up rewards.** — [CONTEXT.md §Unlock Earnability Target](CONTEXT.md)
  - **Like-based incentives, comments, follows, DMs.** — [docs/adr/0023…](docs/adr/0023-bound-first-release-social-features-to-likes-sharing-and-safety-controls.md)
  - **Personalized recommendations** (deferred until there is evidence). — [docs/adr/0024…](docs/adr/0024-use-deterministic-catalog-discovery-without-personalization.md)
  - **Per-Pattern locator pricing, a free (0) locator, a Premium locator discount, and a general Economy Settings console** "for now". — [docs/adr/0060…](docs/adr/0060-let-operators-manage-a-single-global-locator-price.md)
  - **Forced interstitials, banners, and ads during sessions.** — [CONTEXT.md §Rewarded Ad](CONTEXT.md)
- **Openings left in the docs:**
  - Personal and Replay sessions "may still advance separately defined quests or events". — [CONTEXT.md §First Completion Reward](CONTEXT.md)
  - "Future higher-cost generation profiles may use different credit prices". This is an AI Credit sink, not Coin. — [docs/adr/0003…](docs/adr/0003-fal-ai-artwork-with-purchased-credits.md)
  - "Economy tuning may add value", while raising prices needs a decision update. — [docs/adr/0011…](docs/adr/0011-separate-ai-credit-from-gameplay-currency.md)
- **Competitor research in the wiki:**
  - The top complaint themes are ads (41.4%) and monetization (22.0%). Within monetization: expensive patterns, paying to fix mistakes or unlock blocked cells, and no level-up rewards.
  - The listed opportunity is a "fair economy" with daily tasks and level-ups.
  - Review quotes complain about "7500 coins for $15", paying to unlock blocked squares, and paid "mystery package" gacha that under-delivered ("spent 2000 coins… guaranteed 42 patterns. Only got 12!").

  — [vault/wiki/summaries/reviews-complaints-analysis.md](vault/wiki/summaries/reviews-complaints-analysis.md); [vault/wiki/summaries/reviews-cross-stitch-color-by-letters.md](vault/wiki/summaries/reviews-cross-stitch-color-by-letters.md); [vault/wiki/summaries/reviews-cross-stitch-quest-sewing-pattern-mania.md](vault/wiki/summaries/reviews-cross-stitch-quest-sewing-pattern-mania.md)
- **Positive competitor signal:** one review praises "stories that you can use your tokens for". — [vault/wiki/summaries/reviews-cross-stitch-masters.md](vault/wiki/summaries/reviews-cross-stitch-masters.md)

### Inferences
- New sinks that would fit: cosmetics the player owns (only if the "no permanent theme purchase" rule is revisited, since themes are Premium-tied today), collections or story chapters, and limited-time events or quests, which the docs already allow.
- New sinks likely to clash with ADRs and with user sentiment: mistake penalties, gacha or mystery boxes, paid auto-fill, energy or timers, and coin-gated accessibility.

### Gaps
- There are no product roadmap docs or open feature-request issues for new sinks.
- `docs/onboarding-scenario.md` and `docs/architecture.md` were not read in full.

## 5. What constraints must a new coin-spending feature respect?

### Takeaway
Any new sink must:
- be **server-authoritative, idempotent, and online-gated**, using the reservation/commit pattern
- work for **Guests**, through the installation-scoped Guest Ledger
- keep Coin and AI Credit separate
- never gate core play or accessibility, and never punish mistakes
- keep the Unlock Earnability Target
- stay off the render thread and network-free in the stitching loop

Prices live in code. Changing them needs an ADR, except the Locator Price, which operators control.

### Cited Findings
- **Server-authoritative economy.** "Coin economy is server-authoritative + idempotent. ADR-0011 values are LOCKED (changing needs explicit decision)." The client cannot mutate ledgers. — [HANDOFF-economy.md](HANDOFF-economy.md); [CONTEXT.md §Guest Ledger](CONTEXT.md); [docs/adr/0012-keep-commerce-grants-server-authoritative.md](docs/adr/0012-keep-commerce-grants-server-authoritative.md)
- **Guests.** Guests earn and spend Coin in a backend Guest Ledger (ADR-0026). Spending needs connectivity. An account can receive Guest Coin and Unlocks only once (Guest Economy Promotion, ADR-0027). Android Guests cannot purchase. — [docs/adr/0026…](docs/adr/0026-keep-guest-economy-in-an-installation-scoped-backend-ledger.md); [docs/adr/0027…](docs/adr/0027-limit-each-account-to-one-guest-economy-promotion.md); [CONTEXT.md](CONTEXT.md)
- **Spend pattern to copy.** The Locator Attempt holds a 60-second hard reservation and commits exactly one idempotent ledger spend on success; failure, cancel, or offline costs nothing. The client sends the expected price, and a price mismatch is rejected without charge. — [docs/adr/0058…](docs/adr/0058-charge-remaining-cell-locator-with-server-authoritative-stitch-coin.md); [docs/adr/0060…](docs/adr/0060-let-operators-manage-a-single-global-locator-price.md)
- **Anti-fraud evidence:**
  - Guest completion claims require at least 50 ms of server time per cell (`MIN_MS_PER_STITCH = 50`) and an authenticated Stitch Action.
  - Daily Task evidence is bounded by ownership and dedup, not input speed.
  - Evidence dates are bounded by session creation.

  — [docs/adr/0062…](docs/adr/0062-validate-guest-session-completion-claims-with-gameplay-evidence.md); [docs/adr/0063…](docs/adr/0063-bound-daily-task-evidence-by-ownership-not-input-speed.md); [docs/adr/0064…](docs/adr/0064-bound-daily-task-evidence-dates-by-stitching-session-creation.md)
- **Accepted risk.** Rooted-device risk is accepted because Coin "is non-transferable, cannot cash out, and remains bounded by server-owned daily, per-Pattern, and source-key limits". — [docs/adr/0011…](docs/adr/0011-separate-ai-credit-from-gameplay-currency.md)
- **Refunds.** A refund can make the balance negative, and a negative balance blocks new spending. Purchased Coin is spent after free Coin (Paid Reserve). — [CONTEXT.md](CONTEXT.md)
- **Rendering.** Stitch rendering stays off the network and background work (ADR-0031). The renderer is Expo plus Skia SkPicture (ADR-0034). Tile complexity is capped on constrained devices (ADR-0056). Cosmetic stitch or grid skins must therefore respect renderer performance limits. — [docs/adr/0031…](docs/adr/0031-keep-stitch-rendering-off-the-network-and-background-work.md); [docs/adr/0034…](docs/adr/0034-build-the-client-on-expo-with-a-skia-skpicture-grid-renderer.md); [docs/adr/0056…](docs/adr/0056-cap-tile-complexity-and-coalesce-viewport-redraws-on-constrained-devices.md)
- **Platform and identity:**
  - Expo with CNG on iOS and Android, bundle and package `com.avk.stitchwish`
  - brand "Stitch Wish", store name "Cross Stitch&Needlepoint Game"
  - NestJS + PostgreSQL backend (ADR-0014)
  - RevenueCat for purchases (ADR-0032)
  - Firebase Auth used only as a broker (ADR-0038)

  — [docs/app-metadata.md](docs/app-metadata.md); [docs/adr/](docs/adr/)
- **Languages.**
  - The metadata doc says English and Turkish are bundled and es/de/fr/pt-BR/it are approved next.
  - The code now has 33 locale folders under `app/src/i18n/locales/`: ar ca cs da de el en es fi fr hi hr hu id it ja ko ms nb nl pl pt pt-BR ro ru sk sl sv tl tr uk vi zh-Hans zh-Hant. Issues #186/#196 created "candidate" packs for these.
  - Only the app shell is localized (ADR-0051). Releases are gated on complete reviewed translations (ADR-0054).

  A new feature needs strings in every shipped locale. — [docs/app-metadata.md](docs/app-metadata.md); `app/src/i18n/locales/` listing; [docs/adr/0051…](docs/adr/0051-localize-the-app-shell-only.md); [docs/adr/0054…](docs/adr/0054-gate-releases-on-complete-reviewed-translations.md)
- **Privacy:**
  - no IDFA or AAID, no ATT prompt, no cross-app tracking
  - Firebase Analytics only after UMP consent, sent with an opaque player ID
  - Rewarded ads use non-personalized purposes

  New features should emit first-party Gameplay Events (ADR-0035/0055) rather than any tracking SDK. — [docs/app-metadata.md](docs/app-metadata.md); [docs/adr/0033…](docs/adr/0033-verify-rewarded-ads-with-admob-server-side-verification.md); [docs/adr/0055…](docs/adr/0055-mirror-funnel-gameplay-events-to-firebase-analytics.md)
- **Prices are code constants.** "It is the first Stitch Coin value an operator can change; every other economy amount stays defined in code." A general Economy Settings console was rejected "for now". — [docs/adr/0060…](docs/adr/0060-let-operators-manage-a-single-global-locator-price.md)
- **Backend coding detail.** Migrations and entities are registered by hand in `backend/src/database/typeorm-options.ts`, not globbed. — [HANDOFF-economy.md](HANDOFF-economy.md)
- **Testing.** Unit tests only; integration tests were removed. — [CLAUDE.md](CLAUDE.md)
- **Premium boundary.** Premium benefits are limited to three items. Premium must not gate conversion, photo tools, sync, submission, core play, accessibility, or Official Pattern access. — [CONTEXT.md §Premium Membership](CONTEXT.md)

### Inferences
- If a new sink is Coin-buyable and permanent, such as an owned cosmetic, it must be squared with the Premium Theme Collection's "membership-only, no permanent theme purchase" stance. Coin cosmetics would need to be a separate set, or an ADR would need to amend that rule.
- A new sink with a variable price would probably need either a code constant plus an ADR, or an extension of the ADR-0060 operator-price pattern.

### Gaps
- `docs/app-metadata.md` says it is incomplete: RevenueCat, auth, push, and hosting are not inventoried there.
- There is a console/ADR conflict on the AdMob IDFA explainer message, flagged as an open question in app-metadata.

## 6. Reference app: CrossCraft (stitch-master)

### Takeaway
CrossCraft (`/Volumes/ssd/react_native_workspace/stitch-master`) is a pattern-maker tool, not a game. It has no gameplay Coin at all. Its monetization is **Credits** for AI generation plus a **Pro subscription gating Export** (PDF, PNG, CSV, and a Pattern Keeper PDF variant). So it offers no Coin-sink ideas, but it does suggest export or print as a possible paid utility.

### Cited Findings
- **Pro-gated Export.** "Export… Gated entirely behind the **Pro** entitlement (`isPro`)". Export produces a multi-page PDF chart (cover, legend, shopping list, symbol grid), PNG, or CSV. The Pattern Keeper Export is a monochrome symbol-only PDF variant. — `/Volumes/ssd/react_native_workspace/stitch-master/GLOSSARY.md` §Export
- **Credits.**
  - The subscription pays a **Weekly Credit Drip**: 5 per week (weekly plan), 7 (monthly), 10 (yearly).
  - Trial Credit Grant: 3 Credits, once per lifetime.
  - Credit packs are also sold.

  — `/Volumes/ssd/react_native_workspace/stitch-master/GLOSSARY.md` §In-App Purchases
- **Other CrossCraft features:** a community section, a materials and shopping-list screen (`frontend/app/pattern/materials.tsx`), and text and shape stamps in the editor (`frontend/src/utils/textStampFonts.ts`, `shapeRasterizer.ts`). — stitch-master file listing

### Inferences
- Features CrossCraft has that Stitch Wish lacks: printable PDF chart export, Pattern Keeper export, a materials or shopping list for real-world stitching, and editor stamps. In Stitch Wish these could be Coin-gated utilities for Personal Patterns. However, ADR-0011 says core creation capabilities are not Coin-gated, so that would need an explicit decision.

### Gaps
- I did not inspect CrossCraft's community or editor code in depth. Its feature list is inferred from file names and the glossary only.
