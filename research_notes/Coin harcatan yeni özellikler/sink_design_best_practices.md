# Soft-Currency (Coin) Sink Design Best Practices for Casual / Cozy Puzzle Mobile Games (2022–2026)

Research note scope: which coin sinks work, earn/spend balance, player psychology, random-reward regulation, and case studies, applied to a relaxing cross-stitch / color-by-number game. Researched 2026-11-01. Source-quality caveat up front: primary, quantified retention/ARPDAU data split by sink type is almost never published. Most hard numbers below are revenue totals, feature-adoption rates (GameRefinery), or store-listing snapshots. Several widely repeated per-feature percentages could not be verified and are flagged.

## 1. Which sink categories perform best (boosters, permanent unlocks, cosmetics, decoration meta, collections/albums, passes, events, gacha, streak protection, energy)?

### Takeaway
The best-evidenced sinks in top-grossing casual puzzle games are meta layers: decoration/renovation, collections/albums and monthly passes. Each runs on top of a consumable core of boosters, extra moves and lives. GameRefinery adoption data shows meta layers went from almost absent to the norm among top-grossing Match-3 games. No public source isolates retention or ARPDAU per sink type, so the ranking rests on adoption and revenue correlation, not on controlled data.

### Cited Findings
**Meta layers (decoration / renovation)**
- About 70% of top US iOS Match-3 titles now have some meta feature. Six years earlier, over 90% of the top-grossing 100 Match-3 puzzle games had none. — [wnhub summary of GameRefinery](https://wnhub.io/news/analytics/item-4490)
- Top-100-grossing Match-3 games with a construction/building meta rose from 7% to 49% (GameRefinery, about 2022). — [GameRefinery Casual Trends Snapshot, Mar 2022](https://www.gamerefinery.com/casual-gaming-trends-snapshot-report-march-2022/)
- 42% of top-20%-grossing Match-3 games use renovation or construction elements. Royal Match and Zen Match are examples. GameRefinery data names completing milestones as the biggest motivation of mobile casual gamers. Decoration also meets a need for visual self-expression, and seeing visible results of one's work adds a sense of achievement. — [Mobidictum / GameRefinery case study, Oct 31 2022](https://mobidictum.com/case-study-why-renovation-favorite-in-casual-games/)
- Four implementation styles for decoration: single-area renovation, room-by-room, no-choice renovation (simplified, no style options), and event-based renovation added to another genre. Lily's Garden added a permanent Home Design mode. Homescapes' "Dream Date" update added character-look customization. The article warns the meta must fit the game's structure and audience or it will feel irrelevant. — [Mobidictum / GameRefinery](https://mobidictum.com/case-study-why-renovation-favorite-in-casual-games/)
- Project Makeover combines dress-up, makeover and decoration as its meta. — [GameRefinery: How to Crack the Match 3 Code Part 4](https://www.gamerefinery.com/how-to-crack-the-match-3-code-part-4-project-makeover/)
- GameRefinery's June 2025 overview cites Tasty Travels, a Merge-2 game with a base-building meta launched in Feb 2025, as scaling in downloads and revenue. — [Mobidictum market overview, June 2025](https://mobidictum.com/?p=201452)

**Collections / albums**
- The share of US top-grossing games with a collection meta layer grew from just over 20% to 65% in two years (GameRefinery, about 2021–2022). — [GameRefinery Casual Trends Snapshot, Mar 2022](https://www.gamerefinery.com/casual-gaming-trends-snapshot-report-march-2022/)
- Monopoly GO reached $2B gross revenue in about 10 months, with less than a quarter of revenue spent on UA. — [PocketGamer.biz](https://www.pocketgamer.biz/monopoly-go-makes-2-billion-in-10-months-with-less-than-a-quarter-of-revenue-spent-on-ua); Hasbro Q2 2024 credited Monopoly GO for 20% YoY revenue growth, and lifetime gross passed $3B — [GamingOnPhone](https://gamingonphone.com/news/monopoly-go-continues-stellar-run-crosses-3-billion-in-lifetime-revenue)
- Monopoly GO album structure: the Monopoly Games album ran from 20 Jun to 26 Sep 2024 with 252 stickers, 47 of them gold. Unfinished sets vanish when the album ends. — [Dexerto](https://dexerto.com/monopoly-go/monopoly-games-sticker-album-collections-dates-rewards-2787197); [Dexerto album end](https://www.dexerto.com/monopoly-go/sticker-album-end-monopoly-go-2784190)
- UNVERIFIED: the claims that "sticker packs = 30% of Monopoly GO revenue" and "sticker updates lifted retention 25%" appear only on a low-quality blog. They cite Sensor Tower and an earnings call, but no primary source was found. Do not rely on them. — [Argenox blog (low quality)](https://dev2.argenox.com/?p=29981)

**Passes (battle / season pass)**
- Royal Match's Royal Pass is time-limited and valid only until the end of the month. — [Dream Games help center](https://dreamgames.helpshift.com/hc/az/3-royal-match/faq/112-royal-pass). A marketing blog says it unlocks at level 37 with 30 reward tiers per month (secondary source). — [FoxAdvert](https://foxadvert.com/en/digital-marketing-blog/the-3-billion-strategy-how-royal-match-wins-without-ads)
- PocketGamer.biz credits regular feature rollouts, such as the Hidden Temple minigame and Summer Pass, with lifting Royal Match engagement. — [PocketGamer.biz](https://pocketgamer.biz/royal-match-takes-the-puzzle-throne-from-candy-crush-saga)
- Royal Match annual revenue rose from about $932M (2023) to about $1.46B (2024), per AppMagic via Business of Apps. Appfigures reports more than $3B lifetime. Tracker estimates differ. — [Business of Apps](https://businessofapps.com/?p=88662); [mobilegamer.biz](https://mobilegamer.biz/dream-games-royal-match-has-passed-3bn-says-appfigures/)

**Consumable boosters / continues (core sink)**
- In Royal Match, coins are earned per cleared level and spent on extra moves when a level fails. Coins also buy boosters and life refills. One case study describes coins as the game's single currency, which doubles as hard currency and keeps the economy easy to read. — [Substack breakdown](https://pranaysarepaka.substack.com/p/royal-match-breakdown-part-1); [Esports.net](https://www.esports.net/news/mobile-games/how-does-royal-match-make-money/); [Medium case study](https://medium.com/@abhisekh.nath11/case-study-on-royal-match-by-dream-games-80ebc8b8d877)

**Color-by-number genre comps (closest analog)**
- Paint-by-number apps monetize mainly through subscriptions (unlimited books, no ads, unlimited hints), plus consumable hint and paint-bucket packs. Example (Fancy Color US listing): $4.99/week, $9.99/month, $69.99/year subscriptions; hint packs $0.99–6.99; bucket packs $3.99–6.99. — [Fancy Color App Store listing](https://apps.apple.com/us/app/id1661790429?l=en-us)
- Subscriber reviews in this genre complain that hint rewards are useless to subscribers, who already have unlimited hints, and that they are still asked to watch ads for coins after subscribing. — [Search synthesis of App Store reviews; e.g. Color Painting listing](https://apps.apple.com/us/app/id1578990727)

**Streak protection**
- Duolingo's retention PM says the first 7 days are the most fragile period for retention, and the company has run over 600 streak experiments. The episode covers "Developing the Streak Freeze feature" and "Balancing monetization and retention," but the public page has no freeze-specific numbers. — [Lenny's Podcast, Dec 15 2024](https://www.lennysnewsletter.com/p/behind-the-product-duolingo-streaks)
- UNVERIFIED: claims that Streak Freeze "reduced churn 21% for at-risk users" and "+10% long-term retention" come from a student portfolio and a stats aggregator with no primary citation. — [Portfolio case](https://jiwonvyoo.github.io/portfolio/case/duolingo/duo.html); [Gitnux](https://gitnux.org/duolingo-user-statistics/)

**2024 trend summary**
- GameRefinery's 2024 review highlighted hybrid-casual, live events, "overarching currencies" and loss-aversion mechanics as the defining trends. — [GameRefinery 2024 podcast ep. 60](https://feeds.buzzsprout.com/856837/episodes/16286854-episode-60-mobile-gaming-in-2024-exploring-the-top-trends-that-dominated-the-year)
- Sensor Tower: puzzle game revenue grew 14% YoY in 2024 while downloads fell 3%, so the genre is earning more per player rather than growing its audience. — [Sensor Tower](https://sensortower.com/blog/puzzle-games-creative-trends)

### Inferences
- For a cross-stitch game, the closest proven pattern is "core consumables + persistent decoration/collection meta." Finished patterns could feed a room/gallery to decorate or a thematic album, which makes the player's creative output the visible progress the GameRefinery data says casual players want.
- A permanent decoration or collection sink matches a relaxing tone better than a fail-state sink. Cross-stitch has no natural fail state, so "extra moves" style sinks don't carry over. Hints, auto-fill and bucket tools are the genre-native consumables.
- Time-limited albums with disappearing progress (Monopoly GO style) drive revenue, but they caused visible player stress (see section 3). For a cozy game, a persistent album or a long-window album with protected progress is the safer variant.
- Streak protection is a plausible low-friction coin sink because it is loss-aversion relief bought with soft currency. Its quantified impact is unverified.

### Gaps
- No public, primary source gives retention or ARPDAU split by sink type, such as decoration vs. album vs. pass. GameRefinery and Liftoff hold this behind paywalls.
- No 2024–2026 GameRefinery figure specific to decoration-meta adoption in puzzle games was found. The best figures are from 2021–2022.
- No public data on gacha/mystery boxes or energy systems specifically in cozy/coloring games.
- The Deconstructor of Fun articles on Royal Match ("Royal Match – The New King from Turkey?") and on Monopoly GO were not retrieved.

## 2. Balancing earn vs. spend (faucets/sinks), inflation control, price anchoring, "coins that feel meaningful"

### Takeaway
The consensus framework is that every faucet (source) needs a matching sink. If inflow outpaces outflow, balances pile up, coins lose meaning, and IAP stops converting. The best-evidenced data point in the genre is Liquid & Grit's finding that Royal Match's economy is about 5x more generous than Candy Crush's and still out-earns it. That suggests generous earning, paired with sinks players actually want, beats scarcity.

### Cited Findings
- Royal Match's economy is about 5x as generous as Candy Crush Saga's, mainly because rounds pay more and cost less. (The full article returned HTTP 403, so this is the summary/headline only.) — [Liquid & Grit](https://blog.liquidandgrit.com/royal-matchs-economy-is-more-generous-and-less-costly-than-candy-crush-saga-s-744f43389104)
- Royal Match in July 2023 passed Candy Crush Saga in monthly revenue and downloads. — [wnhub](https://wnhub.io/news/finance/item-41759)
- Royal Match coin packs run from about $2 for 1,000 coins to about $100 for 100,000, a 1:1 ratio of dollars to thousands of coins with larger bonuses at the high tiers (secondary source). — [Fungies.io](https://fungies.io/?p=31970)
- Soft currency is a low-value, general-purpose currency earned mostly for free. Flooding the economy with hard currency weakens scarcity and the reason to spend. — [Game Developer: types of game currencies](https://www.gamedeveloper.com/business/types-of-game-currencies-in-mobile-free-to-play)
- When faucets exceed sinks, accumulated wealth loses value over time. Limited-time events that inject large amounts of currency without matching sinks cause inflation spikes that outlast the event. The usual fix for late-game surplus is adding premium or exclusive sinks. — [MWM glossary](https://mwm.ai/glossary/game-economy)
- Faucets that scale with player count or game age without control collapse currency value. Axie Infinity is the standard cautionary tale: "faucets without sinks." — [Medium: Designing Game Economies](https://medium.com/@msahinn21/designing-game-economies-inflation-resource-management-and-balance-fa1e6c894670); [Yu-kai Chou](https://yukaichou.com/gamification-study/economy-design-framework-axie-infinity-collapse/)
- "Hard" sinks permanently destroy currency and control inflation. "Soft" sinks convert currency into another form, which slows velocity but does not reduce supply. — [openskillindex economy-designer prompt (heuristic, unsourced)](https://openskillindex.com/skills/alterlab-ieu-alterlab-gameforge-game-economy-designer)
- Heuristic KPI (unsourced): a daily earned/spent ratio of 0.8–1.2 is healthy. Above 1.5 signals inflation and below 0.5 signals deflation. — [claudskills game-economy-design](https://claudskills.com/skills/game-economy-design/SKILL.md)
- A worked sample F2P economy with spreadsheets is in Adrian Crook's practical example (older, but still widely referenced). — [Adrian Crook](https://adriancrook.com/?p=4918)
- The EU CPC principles (2025) require showing the real-money cost of currency-priced items and avoiding multiple currencies or exchange steps that hide real prices. This makes a single, simple coin currency an advantage for price anchoring as well as compliance. — [Lewis Silkin, Oct 15 2026](https://www.lewissilkin.com/insights/2026/10/15/eu-consumer-protection-network-launches-action-involving-nine-video-games-compani-102o5do)

### Inferences
- Royal Match's single-currency model (coins = soft + hard) is the leading example in casual puzzle games. It is simple, readable, and matches the direction of EU price-transparency rules. A cross-stitch game with one coin currency should keep it single and avoid a second premium currency.
- "Coins that feel meaningful" means there is always a desirable next purchase within a few sessions of earning. Permanent meta sinks (decor, album slots, pattern unlocks) soak up long-term surplus. Consumables (hints) handle per-session spending.
- Instrument the earn/spend ratio and balance distribution per cohort. A growing median balance among engaged players is the early-warning sign that a new sink is needed.
- Event faucets need event sinks, such as event-only decor or shop items, so events don't leave lasting inflation behind.

### Gaps
- No published, sourced benchmark for healthy coin balance or earn/spend ratios in casual puzzle games. The 0.8–1.2 figure is an unsourced heuristic.
- The full Liquid & Grit Royal Match vs. Candy Crush analysis (with exact earn/cost values) was blocked (403).
- No 2023–2026 GDC talk on soft-currency sinks in cozy games was found or retrieved.

## 3. Player psychology: what makes spending feel rewarding, and what causes backlash

### Takeaway
Spending feels rewarding when it produces visible, persistent ownership and progress (milestones, decorated spaces, completed sets) and lets players express themselves. Backlash in cozy and casual games comes from forced pressure: time-limited collections that are hard to finish without paying, monetization that breaks the game's relaxing promise, and subscribers still being pushed to watch ads or grind.

### Cited Findings
- Completing milestones is the biggest motivation for mobile casual gamers (GameRefinery motivation data). Decoration adds visual self-expression and a sense of achievement from seeing visible results. — [Mobidictum / GameRefinery](https://mobidictum.com/case-study-why-renovation-favorite-in-casual-games/)
- Players are 3x more likely to consider spending on cosmetics than on power. Decorative skins appear in almost half of the top 20% grossing US mobile games. Cosmetics sell best when the player's own items are visible on screen and when other players can see them, so single-player games rarely monetize mainly through cosmetics because there is "no one around to show off to." (Naavik, July 2022.) — [Naavik: Selling Cosmetics Part 2](https://naavik.co/f2p-mobile/selling-cosmetics-part-2/)
- Self-expression is a core driver of cosmetic purchases: the avatar works as an extension of the player's identity. — [Naavik: Selling Cosmetics Part 1](https://naavik.co/deep-dives/selling-cosmetics-part1/)
- Backlash example (collections): players said Monopoly GO's 71-day Marvel album (20 sets, 180 stickers) was hard to finish in time. They felt forced to spend unwanted time or money, which had not been the case before. — [mxdwn Games](https://games.mxdwn.com/news/monopoly-go-fans-voice-concerns-about-upcoming-christmas-album-event/amp); also reported via [Destructoid](https://www.destructoid.com/?p=541246)
- Backlash example (cozy): critics cite Disney Dreamlight Valley's monetization as damaging player trust, part of a wider "fast fashionization" of cozy games (opinion piece). — [Punished Backlog](https://punishedbacklog.com/the-fast-fashionization-of-cozy-games/?amp=1)
- Coloring-genre backlash: subscriber reviews complain about coin-earning ads after paying, and about rewards (hints) that are worthless to subscribers. — [Color Painting App Store listing](https://apps.apple.com/us/app/id1578990727)
- EU CPC principle: players should not have to buy excessive virtual currency to progress or enjoy the game. — [Lewis Silkin](https://www.lewissilkin.com/insights/2026/10/15/eu-consumer-protection-network-launches-action-involving-nine-video-games-compani-102o5do)
- GameRefinery flags loss-aversion mechanics as a defining 2024 trend. These raise engagement but carry sentiment risk in relaxed genres. — [GameRefinery 2024 review podcast](https://feeds.buzzsprout.com/856837/episodes/16286854-episode-60-mobile-gaming-in-2024-exploring-the-top-trends-that-dominated-the-year)
- AppFollow published a 2026 monetization playbook built on player-review analysis. It was not retrieved in full. — [AppFollow](https://appfollow.io/blog/mobile-game-monetization)

### Inferences
- In a single-player creative game, Naavik's social-visibility argument suggests self-expression sinks (frames, room decor, thread or fabric themes) need a showcase surface to sell strongly. That could be a personal gallery, a shareable finished-work card, or a community feed.
- Ownership and permanence should dominate: buying something that stays (a decor item, an unlocked pattern, a completed album page) feels better in a cozy game than a consumable that disappears.
- Avoid sinks that gate the core relaxing activity (stitching) behind energy or timers. Gate optional acceleration (hints, auto-fill) and optional expression (decor) instead.
- If time-limited collections are used, give generous windows and keep finished-set rewards, or carry progress over, to avoid Monopoly GO-style "forced to pay" sentiment.
- Make subscriber value consistent: if a VIP tier exists, coin rewards should stay meaningful to VIPs, and VIPs should not be shown ads for coins.

### Gaps
- No quantitative cozy-genre study on sentiment toward specific sink types was found.
- No 2023–2026 GDC talk specifically on cozy-game monetization psychology was retrieved.

## 4. Regulatory concerns for random reward mechanics (loot boxes / mystery boxes)

### Takeaway
Both app stores require odds disclosure before any paid randomized purchase. Belgium treats paid loot boxes as gambling. The Netherlands' position has moved back and forth (a court ruled against the regulator, and a ban was floated). Brazil has banned loot box sales to under-18s from about March 2026. The EU is drafting a Digital Fairness Act that explicitly targets "uncertainty-based rewards" paid with real money or in-game currency. A mystery box bought with coins counts as in scope where coins can be bought with money.

### Cited Findings
- **Apple (App Review Guideline 3.1.1):** "Apps offering 'loot boxes' or other mechanisms that provide randomized virtual items for purchase must disclose the odds of receiving each type of item to customers prior to purchase." Also, under 3.1.1: "Any credits or in-game currencies purchased via in-app purchase may not expire." — [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- **Google Play (Payments policy):** "Apps and games offering mechanisms to receive randomized virtual items from a purchase must clearly disclose the odds of receiving those items in advance of, and in close and timely proximity to, that purchase." — [Google Play Payments policy](https://support.google.com/googleplay/android-developer/answer/9858738). Google introduced the rule in 2019. — [PocketGamer.biz](https://www.pocketgamer.biz/google-play-developers-must-now-disclose-loot-box-odds)
- **PEGI** Code of Conduct already requires loot box and odds transparency, per industry statements. — [EU Perspectives, Nov 2025](https://euperspectives.eu/2025/11/developers-push-back-the-digital-fairness-act/)
- **Belgium:** the regulator classified paid loot boxes (FIFA 18, Overwatch, CS:GO) as games of chance under gambling law, with doubled penalties where minors are involved. Enforcement is weak: Leon Y. Xiao's 2021 study found 82% of Belgium's top-grossing iPhone games still had loot boxes. — [Game Developer / Gamasutra](https://gamasutra.com:443/business/researcher-claims-belgium-s-loot-box-ban-is-ineffective-)
- **Netherlands:** a court ruling held that loot boxes are not gambling, overturning the KSA's penalty against EA. The minister then floated measures including a possible outright ban, and the Dutch government has pushed for an EU-level ban. Whether a national ban is in force by 2026 is unconfirmed. — [iGaming Business](https://igamingbusiness.com/legal-compliance/weerwind-floats-possible-dutch-loot-box-ban); [SI Videogames](https://videogames.si.com/news/netherlands-loot-box-ban-eu); [wnhub](https://wnhub.io/news/legal/item-41044)
- **Brazil:** a law signed by President Lula bans loot box sales to under-18s, with implementation from March 2026 (secondary source). — [Gaming Amigos](https://www.gamingamigos.com/post/brazil-bans-loot-boxes-u18s)
- **EU Digital Fairness Act:** the consultation opened 17 July 2025 and flags "uncertainty-based rewards (e.g. loot boxes) where consumers pay either with real money or in-game currency," plus virtual currencies that blur real prices. Consumer groups want paid loot boxes and premium currencies banned. The Commission is weighing default-off settings or bans in children's games. A draft was reportedly due in "November" (2026 per the Oct 2026 note). Earlier analyses said Q3 2026. — [Slaughter and May](https://thelens.slaughterandmay.com/post/102kxp5/digital-fairness-act-european-commission-launches-consultation-and-call-for-evid); [Freshfields](https://technologyquotient.freshfields.com/post/102ltio/the-eus-proposed-digital-fairness-act-a-game-developers-guide-to-potential-imp); [Lewis Silkin, Oct 2026](https://www.lewissilkin.com/insights/2026/10/15/eu-consumer-protection-network-launches-action-involving-nine-video-games-compani-102o5do)
- **EU CPC Network principles on virtual currencies (about March 2025):** show real-money prices, don't hide costs behind multiple currencies or exchange steps, don't force excessive currency purchases to progress, give clear pre-purchase information, explain the 14-day withdrawal right (including unused currency), and protect children. In October 2026 the CPC launched a coordinated action against nine (unnamed) game companies. — [Lewis Silkin](https://www.lewissilkin.com/insights/2026/10/15/eu-consumer-protection-network-launches-action-involving-nine-video-games-compani-102o5do)
- Industry pushback: Video Games Europe and EGDF argue that in-game coins are game content, not "Bitcoin-like" currencies. — [EU Perspectives](https://euperspectives.eu/2025/11/developers-push-back-the-digital-fairness-act/)

### Inferences
- A coin-bought mystery box where coins are also sold via IAP is a "randomized virtual item from a purchase" for store policy and the DFA consultation's framing. It needs odds disclosure on both stores, and it carries legal risk in Belgium, Brazil (minors) and possibly the future EU.
- Lower-risk alternatives that keep the surprise: (a) random rewards only from free, non-purchasable sources (a daily gift, a completion reward); (b) deterministic "pick from visible options" shops; (c) collection packs with duplicate protection and published odds; (d) "mystery" items whose contents are revealed before payment.
- A cozy game with a broad age audience, possibly including children, is more exposed to the minors-focused rules (Brazil, the EU DFA child provisions).
- Price coin items transparently. A single currency with a clear coin-to-money reference fits the CPC principles.

### Gaps
- The current (2026) legal status of a Dutch national loot box ban was not confirmed.
- The exact Brazilian statute number and implementing details were not retrieved from a primary source.
- Whether a DFA draft has been published as of Nov 2026 is unconfirmed.
- Not checked: China, South Korea and Japan odds-disclosure laws, and the UK's position. These matter if the game launches globally.

## 5. Case studies (GDC, Deconstructor of Fun, GameRefinery, mobilegamer.biz, Naavik, Liquid & Grit)

### Takeaway
The best-documented casual case studies are Royal Match (generous single-currency economy, consumable boosters, monthly Royal Pass, frequent events), Monopoly GO (collection album as the core revenue engine, with sentiment cost) and GameRefinery's decoration-meta research (Homescapes, Lily's Garden, Project Makeover). Deconstructor of Fun and GDC Vault primary pieces were not retrievable in this session.

### Cited Findings
- **Royal Match:** about 5x more generous economy than Candy Crush ([Liquid & Grit](https://blog.liquidandgrit.com/royal-matchs-economy-is-more-generous-and-less-costly-than-candy-crush-saga-s-744f43389104)); more than $3B lifetime gross ([mobilegamer.biz](https://mobilegamer.biz/dream-games-royal-match-has-passed-3bn-says-appfigures/)); overtook Candy Crush in monthly revenue in July 2023 ([wnhub](https://wnhub.io/news/finance/item-41759)); monthly Royal Pass ([Dream Games help center](https://dreamgames.helpshift.com/hc/az/3-royal-match/faq/112-royal-pass)); engagement credited to a steady flow of new features and passes ([PocketGamer.biz](https://pocketgamer.biz/royal-match-takes-the-puzzle-throne-from-candy-crush-saga)).
- **Monopoly GO:** $2B in 10 months ([PocketGamer.biz](https://www.pocketgamer.biz/monopoly-go-makes-2-billion-in-10-months-with-less-than-a-quarter-of-revenue-spent-on-ua)); a time-limited album with gold rarity tiers, wild stickers and Golden Blitz trading events ([GameRevolution](https://www.gamerevolution.com/guides/976917-monopoly-go-monopoly-games-sticker-album-all-stickers-sets-list)); player stress over finishing albums in time ([mxdwn](https://games.mxdwn.com/news/monopoly-go-fans-voice-concerns-about-upcoming-christmas-album-event/amp)). PocketGamer.biz also reported a 58% decline in a "Hot Five" roundup, which means revenue peaks from these mechanics can fade. Context of the 58% figure (which metric, which period) was not verified. — [PocketGamer.biz](https://www.pocketgamer.biz/hot-five-monopoly-gos-58-decline-adjust-lays-off-staff-but-seismic-pokmon-tcg-pocket-could-be-the-next-pokmon-go)
- **Decoration meta (GameRefinery):** adoption stats and implementation styles as in section 1. — [Mobidictum / GameRefinery](https://mobidictum.com/case-study-why-renovation-favorite-in-casual-games/); [GameRefinery Project Makeover](https://www.gamerefinery.com/how-to-crack-the-match-3-code-part-4-project-makeover/)
- **Naavik cosmetics series:** 3x more players open to spending on cosmetics than on power, and visibility and social surfaces drive cosmetic revenue. — [Naavik Part 2](https://naavik.co/f2p-mobile/selling-cosmetics-part-2/)
- **Duolingo streaks (non-game but the leading streak-protection case):** more than 600 streak experiments, the first week is the critical window, and a user-selectable streak goal improved retention. — [Lenny's Podcast, Dec 2024](https://www.lennysnewsletter.com/p/behind-the-product-duolingo-streaks)

### Inferences
- Royal Match's lesson: generous earning plus frequent, low-friction sinks, combined with a monthly pass and constant event cadence, outperforms a stingy economy. This suits a relaxing game better than scarcity.
- Monopoly GO's lesson: collections are a powerful sink and engagement engine, but time pressure and rarity walls create backlash. Copy the collection structure (sets, set-completion rewards, duplicate trading or recycling into coins) without the harsh deadline.
- Recycling duplicates into currency or a "star" meter (as Monopoly GO's star vault does) turns bad luck into progress. That is an established way to soften random collections. (Mechanic description is from general knowledge, not a source retrieved here.)

### Gaps
- Deconstructor of Fun pieces on Royal Match and Monopoly GO were not found or retrieved. A Wikipedia citation suggests "Royal Match – The New King from Turkey?" exists.
- No GDC Vault 2023–2026 talk summaries on casual soft-currency sinks were retrieved.
- No Homescapes/Gardenscapes (Playrix) primary data on decoration-sink spending or retention.
- No case study of a coloring or cross-stitch game with a decoration or collection meta and published results was found.
