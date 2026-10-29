# Turkish and Variant-Locale App Store Search-Term Research

- **Date:** 2026-09-22
- **App:** Stitch Wish — App Store ID `6792383323`, bundle `com.avk.stitchwish`
- **Scope:** research only. No file under `metadata/` was modified by this document.
- **Data source:** iTunes Search API (`https://itunes.apple.com/search?term=<term>&country=<cc>&entity=software&limit=20`), queried live on 2026-09-22, plus Turkish craft-vocabulary web sources cited below.
- **Companion document:** `docs/research/2026-09-22-store-listing-rename-localized-terms.md`. Method, conventions and the single-bag (name + subtitle + keywords) rule are inherited from it unchanged.
- **Baseline verified via** `https://itunes.apple.com/lookup?id=6792383323&country=tr`: the live TR listing is `Stitch Wish: Cross Stitch` v1.2, primary genre `Games` (`Games / Casual / Puzzle`). There is **no `tr` localization today** — the Turkish listing is greenfield.

## Method and conventions

1. Each Turkish-language term was sent to the `tr` storefront Search API and the returned `trackName` / `sellerName` / `primaryGenreName` were inspected.
2. A term is **validated** when it returns cross-stitch or coloring apps in `Games` / `Entertainment` / `Lifestyle`, and **polluted** when it returns unrelated verticals.
3. **Shopping- vs game-intent** is judged separately for the *web* and the *App Store*. Turkish craft retail is overwhelmingly a web/marketplace business (Goblen.com, Hobium, Hobisitesi), so a term can be shopping-intent on the open web while still being clean inside the App Store index, or vice versa. Both are recorded.
4. Character counts were computed programmatically over the NFC-normalized string with `len(list(...))` over code points (equivalent to JS `Array.from(s).length`). All Turkish letters (`ç ğ ı İ ö ş ü`) are single BMP code points in NFC; every string below was verified NFC-stable, so no combining-mark inflation is possible.
5. Keyword fields are comma separated with **no space after the comma**, and exclude every token present in that locale's name or subtitle, plus substrings of those tokens.

---

## Part 1 — Turkey (`tr`, storefront TR)

### Turkish craft vocabulary (web evidence)

Turkish has three near-synonyms plus one false friend for this craft:

- **kanaviçe** — the craft itself: thread worked in full and half crosses to form a pattern. Turkish sources note that people use *etamin* and *çarpı işi* interchangeably for it. ([Takıhanem](https://takihanem.com/kanavice-nedir/), [Kumaş Kağıt Makas](https://kumaskagitmakas.com/kanavice-nedir-nasil-yapilir/))
- **etamin** — strictly the *fabric* (even-weave cloth), but used colloquially as the name of the craft. ([Milliyet](https://www.milliyet.com.tr/egitim/etamin-nedir-nasil-yapilir-kanavice-ve-etamin-farklari-nelerdir-6507437))
- **çarpı işi** — literally "cross work"; the umbrella descriptive name for the X-stitch technique. ([Balköpüğü](http://www.balkopugutasarim.com/2013/06/kanavice-etamin-carpi-isi-yapma.html))
- **goblen** — the *half-cross* / tapestry variant, a distinct and more detailed technique, and the dominant Turkish retail category name. ([kanavice.blogspot](https://kanavice.blogspot.com/2007/10/goblen-ile-etaminin-fark-nedir.html), [Goblen.com](https://www.goblen.com/tr))

On the open web all four are **shopping-intent**: the first page for kit queries is entirely e-commerce — Goblen.com, [Hobium](https://www.hobium.com/c-etamin-goblen), [Hobisitesi](https://www.hobisitesi.com/kanavice-etamin-kitleri), [goblenkanavice.com](https://www.goblenkanavice.com/). That matters for Google Play and for ASA copy, but **not** for the App Store index, which is a separate, much smaller corpus — and there the picture inverts, as the table shows.

### Per-term evidence (`country=tr`, 2026-09-22)

| Term | Results | Top 3 ranking apps (name \| seller \| genre) | Intent / verdict |
| --- | --- | --- | --- |
| `kanaviçe` | **20** | `Cross Stitch: Color by Number` \| 炳甲 梁 \| Entertainment · `Cross Stitch Pattern Creator` \| Sand Castle Designs \| Graphics & Design · `Cross Stitch Craft: Crossie` \| ISOMEM \| Lifestyle | **Game/hobby. Validated — the head term.** Full 20-result cluster, all cross-stitch. |
| `etamin` | **18** | `Needlepoint Pattern Maker AI` \| **murat ulug** \| Lifestyle · `Cross Stitch: Color by Number` \| 炳甲 梁 \| Entertainment · `Cross Stitch Craft: Crossie` \| ISOMEM \| Lifestyle | **Game/hobby. Validated — #2 term.** Own sibling app already ranks **#1** here. |
| `çarpı işi` | **2** | `FotoKanavice: Cross Stitch` \| Yavuz TANRIVERDI \| Graphics & Design · `Cross Stitch Craft: Crossie` \| ISOMEM \| Lifestyle | Correct but **very thin index**. Keyword-field only. |
| `çapraz dikiş` | **3** | `Cross-Stitch Masters` \| TAPCLAP \| Games · `Stitch: AI Embroidery Art` \| Appy Labs \| Photo & Video · `pixel2stitch` \| Pavel Grigorev \| Lifestyle | Literal calque, barely used. **Skip** — `dikiş` alone is the useful half. |
| `nakış` | **20** | `Embroidery File Viewer` \| Maya Patel \| Utilities · `PFAFF® ImageStitch` \| VSM Group \| Lifestyle · `Cross Stitch Club` \| Andrey Baryshnikov \| Games | Mixed: machine/digitizing utilities **plus** games. Category-correct, moderate intent. Also surfaces `1_Stitch - New Patterns -` (Benek Ozer) and `El İşi Dünyası`. |
| `goblen` | **19** | `Gold and Goblins – Idle Games` \| AppQuantum \| Games · `Goblins Wood: lumber tycoon` \| ProGamesLab \| Games · `Goblin Miner: Tycoon Game` \| ProGamesLab \| Games | **POLLUTED — do not use.** Prefix-matches `Goblin*`; the entire result set is idle/tycoon games. Zero craft apps returned. The highest-volume Turkish *retail* term is the worst possible App Store keyword. |
| `piksel sanat` | 18 | `Pixel Art Maker - Pixel Canvas` \| Kai Chi Tsao \| Graphics & Design · `Magico: Pixel Art Puzzle Games` \| Vadim Gladkikh \| Games · `Pixel Draw - Pixel Art` \| Ramalingam S. \| Entertainment | Category-adjacent but skews to **editors**, not coloring games. Moderate. |
| `sayılarla boyama` | **20** | `Colour by Number：Paint Games` \| Wildlife Studios \| Entertainment · `Happy Color® – Colouring Games` \| X-FLOW \| Games · `No.Pix - Color by Number` \| DROIDFUN \| Games | **Pure game intent. Validated — the volume term.** Exactly the global color-by-number publisher set. |
| `boyama oyunu` | 15 | `Colour by Number：Paint Games` \| Wildlife \| Entertainment · `Coloring Games: Painting, Glow` \| RV AppStudios \| **Education** · `Happy Color®` \| X-FLOW \| Games | Game intent, but **diluted by kids/Education** titles (KidloLand, Bimi Boo). Weaker than `sayılarla boyama`. |
| `örgü` | 19 | `Yarnbie: Crochet & Knit Guide` \| Serhat Gokce \| Education · `El İşi Dünyası` \| Yunus Emre Eke \| Social Networking · `YarnPal - Crochet & Knitting` \| PIXELCELL \| Lifestyle | **Wrong craft** (knit/crochet) and partly shopping (`Örgüye Dair Herşey` is a Shopping app). Skip. |
| `el işi` | 17 | `Yarnbie` \| Serhat Gokce \| Education · `El İşi Dünyası` \| Yunus Emre Eke \| Social Networking · `Block World 3D: Craft & Build` \| FUNBURSTGAME \| Games | **POLLUTED — do not use.** `ikinci el` (second-hand) commerce apps dominate: Dolap, ikinciyeni.com, DOD. Classic shopping-intent trap. |
| `dikiş` | 19 | `Sewing Patterns & Ideas: Sewie` \| Hang Ma \| Reference · `Singer Sewing Assistant` \| VSM Group \| Lifestyle · `Sewing & Quilting: Hooked` \| Mehdi El Moussali \| Lifestyle | Sewing-adjacent, partly shopping (`DİKİŞ SEPETİ`, `Tailor Body Measurements`). Weak but clean enough for the keyword field. |
| `desen` | 16 | `Pinterest: Lifestyle Ideas` \| Pinterest \| Lifestyle · `Drawing Pad` \| Sunny Side Hurricane \| Graphics & Design · `Pixel Art - Colour by Numbers` \| Easybrain \| Games | Half-polluted (generic design/drawing), but it is the correct Turkish word for *pattern* and a coloring game does rank. Keyword field, low priority. |
| `rahatlatıcı oyun` | **20** | `Mini Relaxing Game - pop it` \| M S Game Notch \| Games · `Antistress - Relaxing games` \| Jindoblu \| Games · `Perfect Makeover Cleaning ASMR` \| HMBL APPS \| Games | Pure game intent, but **generic ASMR/antistress** competitive set — high volume, low relevance. |
| `stres atma` | **20** | `Soap Cutting` \| Cocoplay \| Games · `Antistress - Relaxing games` \| Jindoblu \| Games · `I am - Daily Affirmations` \| Monkey Taps \| Health & Fitness | Game intent, same generic antistress pool. `stres` is worth one keyword slot; the two-word phrase is not. |

#### Supplementary terms queried

| Term | Results | Note |
| --- | --- | --- |
| `kanaviçe oyunu` | 6 | `Cross Stitch King` (MOBIRIX), `Cross-Stitch Masters` (TAPCLAP), `Pixel Beads: Gem Art Coloring`. Confirms the *game* subset of the kanaviçe cluster. |
| `kanaviçe desen` | 10 | `FotoKanavice`, `Cross Stitch Craft: Crossie`, **`Needlepoint Pattern Maker AI` (murat ulug, #3)**. |
| `etamin desen` | 3 | **`Needlepoint Pattern Maker AI` (murat ulug) ranks #1.** |
| `kanevice` (unaccented) | **1** | Only `1_Stitch - New Patterns -`. Turkish users evidently type the accented form; **no unaccented variant needed**. |
| `piksel boyama` | 20 | Full coloring-game set plus `TRT Piksel Boyama` (Turkish public broadcaster, Games). Strong. |
| `sayı boyama` | 20 | Same set as `sayılarla boyama` — the short form is equally indexed. |
| `renklerle boyama` | 3 | Thin. Skip. |
| `cross stitch` | **20** | `Cross Stitch: Color by Number`, `Stitchly: Cross stitch`, `Cross Stitch Club`. **English works in TR.** |
| `pixel art` | 19 | `Pixel Art - Colour by Numbers` (Easybrain), `Colour by Number：Paint Games` (Wildlife). English works. |
| `zen oyun` | 20 | `Zen Word®`, `Happy Color®`, `Zen Color`. `zen` is a live token in TR. |
| `bulmaca`-adjacent `yapboz` | 18 | Jigsaw/block games. Generic; `bulmaca` preferred as the puzzle word. |
| `boncuk` | 20 | **Polluted** — `Jewel Muse!`, `Candy Crush Saga`, `Bricks Breaker`. Match-3 noise. Do not use. |
| `hobi oyunu` | 18 | **Partly polluted** — prefix-matches `Hopi`/`Boyner` shopping apps. Use bare `hobi`, not the phrase. |
| `el sanatları` | 18 | Polluted by Minecraft-style `Craft` building games. Skip. |
| `meditasyon` / `rahatlama` | 19 / 20 | Health & Fitness vertical (Meditopia, Headspace). Wrong category. Skip. |
| `iğne oyası` | **0** | Zero results. |
| `boyama kitabı` | 19 | Kids Education titles dominate. Skip. |
| `dikiş nakış` | 19 | Same cluster as `nakış`; no extra coverage. |
| `sakinleştirici` | 18 | Health & Fitness + generic antistress. Skip. |

### Key Turkish findings

1. **`kanaviçe` is the head term and `etamin` is a genuine second head term**, not a synonym to be demoted — 20 and 18 results, both returning the correct cluster, and the developer's own sibling app (`Needlepoint Pattern Maker AI`) already ranks **#1 on `etamin`** and **#3 on `kanaviçe desen`**. Both belong in the name.
2. **`goblen` must be excluded outright.** It is the biggest Turkish craft-retail keyword, and it is also the single most polluted App Store term tested — `Goblin*` idle-tycoon games take every slot. Anyone optimizing from web keyword volume alone would put it in the name and get nothing.
3. **`el işi` is the second trap**, poisoned by `ikinci el` second-hand-marketplace apps.
4. **The TR storefront is dominated by English-titled apps.** Almost every ranked competitor for Turkish queries carries an English `trackName` — very few publishers ship a `tr` localization. That is the opportunity (a Turkish-language name would be nearly unique in the results) and also the reason `cross stitch` is worth 12 characters in the keyword field: today Turkish users get English results, so many of them type English.
5. **`sayılarla boyama` is the volume term and is pure game intent**, mirroring the color-by-number finding in every other locale. The short form `sayı boyama` is equally indexed, so the subtitle's `Sayılarla boyama` covers `sayı`+`boyama` as separate tokens too.

### Recommendation — `tr`

| Field | Exact string | Chars | Limit |
| --- | --- | --- | --- |
| Name | `Kanaviçe&Etamin Nakış Oyunu` | **27** | 30 |
| Subtitle | `Sayılarla boyama, rahatla` | **25** | 30 |
| Keywords | `piksel,sanat,çarpı işi,dikiş,iplik,iğne,desen,hobi,stres,zen,bulmaca,renk,cross stitch,ücretsiz` | **95** | 100 |

Counts are NFC code-point counts, verified programmatically.

**Rationale**

- Name is brand-free and keyword-first, carries **both** head terms, uses `&` with no spaces per the convention, and adds `Nakış` (category-correct, 20 results) plus `Oyunu` to signal the games vertical against a result set full of Lifestyle/Utilities pattern-makers. Turkish grammar tolerates the bare juxtaposition here, unlike the Romance locales where `jeu`/`juego` had to be dropped.
- Subtitle takes the highest-volume, purest-game-intent phrase (`sayılarla boyama`) and adds the relaxation positioning with `rahatla`. No token is shared with the name.
- Keywords carry: the third craft synonym (`çarpı işi`), the sewing/thread/needle cluster (`dikiş`, `iplik`, `iğne`), the pixel-art pair (`piksel`, `sanat`), the pattern word (`desen`), the relaxation and puzzle tokens that showed live game intent (`stres`, `zen`, `bulmaca`), and the English head term `cross stitch` for the large English-typing share of TR users.
- **Excluded deliberately:** `goblen` (Goblin pollution), `el işi` (second-hand-commerce pollution), `boncuk` (match-3 pollution), `örgü` (wrong craft), `çapraz dikiş` (3 results), `kanevice` unaccented (1 result), `meditasyon`/`rahatlama` (Health & Fitness vertical), `boyama kitabı` (kids Education).
- **First candidates for the remaining 5 characters** once live ranking data exists: `oya` (3), or swap `desen` (5) for `pixel art` (10) if the English-typing share proves larger than assumed.

**Alternatives considered**

- Subtitle `Sayılarla boyama, piksel sanat` is exactly **30** characters and would free 13 characters in the keyword field by promoting `piksel`/`sanat` out of it. Rejected as the primary because `piksel sanat` skews to editor apps in TR, and because it drops the relaxation positioning from the two highest-weight fields. Worth an A/B.
- Name `Kanaviçe&Etamin Oyunu` (21) drops `Nakış`. Cheaper, but `nakış` returns a full 20-result category-correct cluster and 6 free characters have no better use.

---

## Part 2 — Differentiated keyword fields for variant locales

For these five, **name and subtitle stay identical to the parent locale** already in `metadata/app-info/` — they are not restated as recommendations, only as the exclusion bag. The keyword field is the only thing that changes, and its job is **incremental coverage**: every token below is absent from the parent locale's full name + subtitle + keyword bag.

### Parent bags being differentiated against

| Parent | Name | Subtitle | Keywords (from `metadata/version/1.3/`, as revised in the companion doc) |
| --- | --- | --- | --- |
| en-US | `Cross Stitch&Needlepoint Game` | `Relax: color by number art` | `embroidery,pixel,coloring,needlework,craft,pattern,calm,sewing,painting,puzzle,zen,floss,hobby,diy` |
| fr-FR | `Point de croix & broderie` | `Coloriage par numéro relaxant` | `pixel,art,motif,couture,artisanat,détente,calme,aiguille,dessin,jeux,zen,perles,fil,loisirs,peinture` |
| es-ES | `Punto de cruz y bordado` | `Colorear por números relax` | `pixel,arte,bordar,costura,artesania,patrones,calma,aguja,pintar,juegos,mandala,hilo,zen,puntada,diy` |

### `en-GB` (evidence: `country=gb`)

| Term | Results | Top 3 | Verdict |
| --- | --- | --- | --- |
| `colouring` | 18 | `Color Goods™` \| Dewela \| Book · `Happy Color® – Colouring Games` \| X-FLOW \| Games · `Sandbox - Pixel Art Colouring` \| Grigorkin \| Entertainment | **Validated.** British spelling is a separate index token and X-FLOW/Easybrain ship `Colouring`-spelled GB titles. |
| `colour by number` | 18 | `Colour by Number：Paint Games` \| Wildlife \| Entertainment · `Pixel Art - Colour by Numbers` \| Easybrain \| Games · `Happy Color®` \| X-FLOW \| Games | **Validated.** Confirms `colour` as its own token. |
| `counted cross stitch` | 20 | `Cross-Stitch World` \| InertiaSoft \| Games · `Cross Stitch: Color by Number` \| 炳甲 梁 \| Entertainment · `Stitchly` \| Subtlabs \| Lifestyle | `counted` is the craft-correct qualifier and is free (not in en-US bag). |
| `perler beads` | 20 | `PerlerBead Pattern Maker` \| Bili Time \| Utilities · `PerlerBeads Designer` \| 莹 唐 \| Utilities · `Perlypop: Perler & Hama beads` \| **Subtlabs** \| Lifestyle | Strong adjacent niche; `hama` confirmed as the co-term. Subtlabs (a direct cross-stitch competitor) runs both. |
| `knitting` | 20 | `YarnPal` \| PIXELCELL \| Lifestyle · `LooseLoop` \| Loose Loop \| Reference · `Loopsy` \| Springtown \| Lifestyle | Adjacent craft, clean. |
| `jigsaw` | 19 | `Jigsawscapes®` \| OAKEVER \| Games · `Jigsaw Puzzle: Game for Adults` \| Veraxen \| Games · `Jigsaw Puzzles` \| Easybrain \| Games | Pure game intent; `puzzle` is in the en-US bag, `jigsaw` is not. |
| `tapestry` | 12 | `Tapestry Education Platform` \| FSF \| Education · `Tapestry LA Church` \| Lifestyle · `Iconfactory Tapestry` \| Social Networking | **Weak/polluted** — but `Tapestry Crochet` and `StitchMagic` do rank. Low-cost, low-priority. |
| `mosaic art` | 17 | `Pro Photo Mosaic Creator` \| Picture Mosaics \| Photo & Video · `Bouquet: Craft Mosaic Art` \| Sola \| Photo & Video · `Mosaic Art Studio` \| Education | **Weakest term in the set** — photo-mosaic utilities. Included only because it costs 7 characters; first to drop. |
| `aida` | 16 | `AIDA` \| **AIDA Cruises** \| Travel · `AIDA.info` \| Finance · `AIDA64` \| Utilities | **REJECTED.** The cross-stitch fabric name collides with a cruise line and a diagnostics tool. Zero craft results. |

**Recommended `en-GB` keywords**

`colour,colouring,tapestry,counted,perler,hama,beads,jigsaw,mosaic,mindful,knitting,thread,chart` — **95 / 100**

`colour` and `colouring` are both listed because Apple does not reliably stem one into the other (same reasoning as `color`/`coloring` in en-US). `chart` is the cross-stitch word for a pattern grid, absent from the en-US bag. `stitchery` was rejected as a substring of `stitch` in the name.

### `en-CA` (evidence: `country=ca`)

| Term | Results | Top 3 | Verdict |
| --- | --- | --- | --- |
| `diamond painting` | 20 | `Jewel Coloring` \| Ta Ta Game \| Games · `Diamond Painting: Antistress` \| Crimson Pine \| Lifestyle · `Diamond Painting ASMR Coloring` \| CRAZY LABS \| Games | **Validated, strong.** Crimson Pine also publishes `Cross Stitch: Antistress` — same audience. `painting` is already in the en-US bag, so only `diamond` is new. |
| `beads art` | 20 | `Bead Art: Coloring Games` \| JOINT TECH \| Games · `Beads Art Creator` \| Jahanzeb \| Lifestyle · `Bead Art - Coloring Puzzle -` \| BAF \| Games | **Validated.** An entire games sub-genre keyed on `bead`. |
| `colouring` | 18 | `Color Goods™` \| Book · `Adult Colouring Book - Pigment` \| Pixite \| Lifestyle · `Happy Color® – Colouring Games` \| X-FLOW \| Games | Validated — CA storefront serves the British spelling too. |
| `handmade` | 20 | `HandMade -crafts` \| Alagoz \| Lifestyle · `Handmade Story: DIY ASMR` \| Wejoy \| Games · `idus - Handmade Marketplace` \| Backpackr \| **Shopping** | Mixed: real DIY-ASMR games plus marketplaces. Usable, mid priority. |
| `offline games` | 18 | `Offline Games - No Wifi Games` \| Jindoblu \| Games · `Offline Games: No WiFi - FunOn` \| 720 Media \| Games · `Subway Surfers` \| Sybo \| Games | Pure game intent; a real acquisition angle since the app plays offline. |
| `relaxing puzzle` | 20 | `Slices: Relax Puzzle Game` \| AI GAMES \| Games · `Water Sort Puzzle` \| IEC GLOBAL \| Games · `Zen Match` \| Moon Active \| Games | Generic; `relax`/`puzzle`/`zen` are all already in the en-US bag, so only a fresh synonym (`unwind`, `cozy`) adds anything. |
| `tapestry` | 14 | `Iconfactory Tapestry` \| Social Networking · `Tapestry Education Platform` \| Education · `Knitting Chart` \| van Cleef \| Utilities | Weaker in CA than GB. Dropped from the CA list. |

**Recommended `en-CA` keywords**

`colouring,diamond,beads,cozy,handmade,offline,jigsaw,yarn,crochet,quilting,canvas,grid,unwind` — **93 / 100**

CA leans into the **diamond-painting / bead-art** adjacency (its two strongest queries) and the **offline** angle, and takes `cozy`/`unwind` as relaxation synonyms that en-US does not already own. `yarn`, `crochet`, `quilting`, `canvas`, `grid` are craft-adjacency and are judgement calls on top of the `knitting`/`handmade` evidence rather than separately queried head terms.

### `en-AU` (evidence: `country=au`)

| Term | Results | Top 3 | Verdict |
| --- | --- | --- | --- |
| `diamond art` | 19 | `Diamond Painting: Antistress` \| Crimson Pine \| Lifestyle · `Jewel Coloring` \| Ta Ta Game \| Games · `Diamond Painting by Number` \| EYEWIND \| Entertainment | **Validated, strong** — and `diamond art` is the AU/NZ retail phrasing. |
| `colour by number` | 19 | `Colour by Number: Paint Games` \| Wildlife \| Entertainment · `Happy Color®` \| X-FLOW \| Games · `Pixel Art - Colour by Number` \| Easybrain \| Games | Validated, British spelling. |
| `colouring` | 18 | `Color Goods™` \| Book · `Happy Color® – Coloring Book` \| X-FLOW \| Games · `Colour by Number: Paint Games` \| Wildlife \| Entertainment | Validated. |
| `beading` | 19 | `Beading Patterns Tutorials` \| Riafy \| Education · `Planbead` \| Monneret \| Lifestyle · `Threadologie: Bead Pattern` \| Levices \| Graphics & Design | Craft-correct, low competition, no games — cheap to own. |
| `tapestry` | 13 | `Tapestry Education Platform` \| Education · `Iconfactory Tapestry` \| Social Networking · **`Tapestry Crochet`** \| Bekke \| Lifestyle, then `Stitch Fiddle`, `Stitchly` | Weak head but **cross-stitch apps do rank** in AU — better than in CA. |
| `stitchery` | 18 | `Stitchly: Cross stitch` \| Subtlabs \| Lifestyle · `Sewing & Stitchery Expo 2022` \| WSU \| Business · `CrossStitcher` \| Warners Group \| Lifestyle | Category-correct **but rejected**: `stitchery` contains `stitch`, already in the name. |
| `mindful games` | 18 | `Offline Games - No Wifi Games` \| Jindoblu \| Games · `Perfect Tidy` \| ABI GLOBAL \| Games · `MindPal` \| Elektron \| Education | Generic; `mindfulness` is the token worth taking. |
| `free games` | 18 | `Subway Surfers` \| Sybo · `Candy Crush Saga` \| King · `Block Blast!` \| ARETIS | Top-chart noise, zero relevance — but `free` is a common AU qualifier and costs 4 characters. Low priority. |

**Recommended `en-AU` keywords**

`colouring,diamond,beading,tapestry,mindfulness,unwind,handmade,jigsaw,chart,free,counted,yarn` — **93 / 100**

### `fr-CA` (evidence: `country=ca`, French-language queries)

| Term | Results | Top 3 | Verdict |
| --- | --- | --- | --- |
| `casse-tête` | **20** | `Magic Jigsaw Puzzles－Games HD` \| XIMAD \| Games · `Jigsaw Puzzle for Adults` \| Veraxen \| Games · `Jigsaw by Staple Games` \| Games | **Validated, strong.** The Quebec word for *puzzle*; fr-FR uses `puzzle`/`jeux` and does not own this token. Highest-value fr-CA-specific term found. |
| `colorier par numero` | 19 | `Tap Color - Paint by Number` \| Talefun \| Games · `Color Aura: Paint by Number` \| OAKEVER \| Games · `Paint by Number Art: Hey Color` \| Tripledot \| Games | Pure game intent. The **verb** `colorier` is distinct from `coloriage` in the fr-FR subtitle. |
| `point de croix` | 16 | `Cross-Stitch: Color by Number` \| 炳甲 梁 \| Entertainment · `Stitchly: Cross stitch` \| Subtlabs \| Lifestyle · `Cross Stitch Pattern Maker` \| Huon \| Utilities | Category-correct on the CA storefront; confirms the fr-FR name transfers. **Note: the CA results are English-titled**, same dynamic as TR. |
| `grille point de croix` | 15 | `Stitch Fiddle Pattern Maker` \| van der Ploeg \| Lifestyle · `Uzora: Cross Stitch` \| Rozhnova \| Lifestyle · **`Needlepoint Pattern Maker AI`** \| murat ulug \| Lifestyle (#4) | `grille` is the French cross-stitch word for the chart, absent from fr-FR. Own sibling app ranks. |
| `jeu relaxant` | 20 | `Mini Relaxing Game - pop it` \| M S Game Notch \| Games · `Satisgame` \| Wuxi Dishudong \| Games · `Zen Word®` \| OAKEVER \| Games — with `Pixel Art - Color by Number` at #4 | Game intent; `jeux`/`détente`/`calme` already in fr-FR bag, so only fresh synonyms help. |
| `bricolage` | 15 | `PicCollage` \| Cardinal Blue \| Photo & Video · `DIY: Learn Craft Offline` \| Elsa George \| Graphics & Design · `DIY Mini Notebook` \| Farrukh Ahmad \| Games | Half-polluted (`PicCollage` prefix noise) but real DIY apps rank. Low priority. |
| `broderie diamant` | 14 | `Jewel Color Sort` \| HappyTapLand \| Games · unrelated Book/Shopping/Social · `Pixel Pop: Color by Number Art` \| Cetinbas \| Entertainment | Thin as a phrase, but `diamant` is worth a slot given how strong `diamond painting` is on the same storefront in English. |
| `canevas` | 14 | `Canva: AI Video & Photo Editor` \| Canva \| Photo & Video · `Canvas by Instructure` \| Education · `Canvas AI Design` \| Graphics & Design | **REJECTED.** The Quebec word for needlepoint canvas is swallowed whole by Canva/Canvas. |
| `tapisserie` | **9** | `Ange Bakery` \| UEAT \| Food & Drink · `Crèmerie Chez Mamie` \| Food & Drink · `Scores` \| Food & Drink | **REJECTED.** 9 results, almost all Quebec restaurant apps. |

**Recommended `fr-CA` keywords**

`casse-tête,colorier,grille,diamant,bricolage,tricot,laine,gratuit,hors ligne,anti-stress,repos` — **94 / 100**

`broder` was rejected as a substring of `broderie` in the fr-FR name. `numéros` rejected as a plural of `numéro` in the subtitle. `tricot`/`laine` are craft-adjacency judgement calls layered on the validated core.

### `es-MX` (evidence: `country=mx`)

| Term | Results | Top 3 | Verdict |
| --- | --- | --- | --- |
| `punto de cruz` | **20** | `Stitchly: Punto de cruz` \| Subtlabs \| Lifestyle · **`Cross Stitch: Punto de Cruz AI`** \| murat ulug \| Lifestyle (#2) · `Stitch Creator` \| Kuznetsov \| Productivity | Category-correct; confirms the es-ES name transfers to MX. **Own sibling app ranks #2.** |
| `manualidades` | **20** | `Pinterest` \| Lifestyle · `Aprende manualidades papel` \| Riafy \| Education · `Manualidades Aprender Tutorial` \| Riafy \| Lifestyle | **The Mexican word for crafts** — es-ES uses `artesania`, which is a different token. Slightly diluted (tutorial apps) but it is the term people type. |
| `rompecabezas` | 18 | `Rompecabezas (Puzzle Game)` \| Veraxen \| Games · `Jigsaw Puzzle: Rompecabezas` \| Easybrain \| Games · `Jigsawscapes® - Rompecabezas` \| OAKEVER \| Games | **Validated, pure game intent.** es-ES bag has no puzzle word at all — this is a clean gap. |
| `colorear por numeros` | 19 | `Pintar por número color juegos` \| OAKEVER \| Games · `Zen Color - Colorea por número` \| OAKEVER \| Games · `Happy Color® juegos de pintar` \| X-FLOW \| Games | Confirms the es-ES subtitle works in MX unchanged. |
| `tejido` | **20** | `Yarnpal: Crochet y Tejido` \| PIXELCELL \| Lifestyle · `LoopCraft: Clases de tejido` \| Scala \| Lifestyle · `Yarn Scape` \| Finger Rush \| Games | Adjacent craft, clean, strong. Absent from es-ES. |
| `diamante pintura` | 8 | `arte píxeles pintura diamantes` \| Rahman \| Games · `Pintar con Diamantes Números` \| Maslennikov \| Games · `Diamond Art – Colors by Number` \| EYEWIND \| Entertainment | Thin as a phrase but **all results are games** — `diamante` and `pintura` both earn slots. |
| `bordado` | 20 | `Bordado: Digitalizar y Ver` \| MTTenterprise \| Graphics & Design · `Embroidery File Viewer` \| Patel \| Utilities · `StitchBuddy HD` \| Arndt \| Productivity | Same machine/digitizing skew as in es-ES. Already in the name; nothing new. |
| `pixel art` | 18 | `Pixel Art - Juegos para pintar` \| Easybrain \| Games · `Color by Numbers: Puzzle Games` \| Wildlife \| Entertainment · `Pixel Studio for pixel art` \| Yarullina \| Graphics & Design | English survives; `pixel`/`arte` already in es-ES bag. |
| `juego relajante` | 20 | `Antistress - relaxation toys` \| Jindoblu \| Games · `Color de clasificación de agua` \| Vaishnav \| Games · `Mini juego relajante: pop it` \| M S Game Notch \| Games | Generic antistress pool; `antiestres` is the token worth taking. |
| `chaquira` | **2** | `Threadologie: Bead Pattern` \| Levices \| Graphics & Design · `Beadium: Beading Patterns` \| Diachek \| Lifestyle | **REJECTED.** Correct Mexican word for seed beads, but a 2-app index. |

**Recommended `es-MX` keywords**

`manualidades,rompecabezas,diamante,tejido,gratis,antiestres,dibujar,cuentas,pintura,sin internet` — **96 / 100**

`pintura` is kept alongside es-ES's `pintar` because neither is a substring of the other and both appear in ranked competitor names. `antiestres` and `sin internet` are intentionally unaccented / space-separated to match how users type.

---

## Summary of proposed strings

| Locale | Name | N | Subtitle | S | Keywords | K |
| --- | --- | --- | --- | --- | --- | --- |
| `tr` | `Kanaviçe&Etamin Nakış Oyunu` | 27 | `Sayılarla boyama, rahatla` | 25 | `piksel,sanat,çarpı işi,dikiş,iplik,iğne,desen,hobi,stres,zen,bulmaca,renk,cross stitch,ücretsiz` | 95 |
| `en-GB` | *= en-US* | 29 | *= en-US* | 26 | `colour,colouring,tapestry,counted,perler,hama,beads,jigsaw,mosaic,mindful,knitting,thread,chart` | 95 |
| `en-CA` | *= en-US* | 29 | *= en-US* | 26 | `colouring,diamond,beads,cozy,handmade,offline,jigsaw,yarn,crochet,quilting,canvas,grid,unwind` | 93 |
| `en-AU` | *= en-US* | 29 | *= en-US* | 26 | `colouring,diamond,beading,tapestry,mindfulness,unwind,handmade,jigsaw,chart,free,counted,yarn` | 93 |
| `fr-CA` | *= fr-FR* | 25 | *= fr-FR* | 29 | `casse-tête,colorier,grille,diamant,bricolage,tricot,laine,gratuit,hors ligne,anti-stress,repos` | 94 |
| `es-MX` | *= es-ES* | 23 | *= es-ES* | 26 | `manualidades,rompecabezas,diamante,tejido,gratis,antiestres,dibujar,cuentas,pintura,sin internet` | 96 |

All name and subtitle values are ≤ 30 code points and all keyword values are ≤ 100 code points, verified programmatically over NFC-normalized strings. No keyword token duplicates a token in its locale's name or subtitle (checked programmatically for `tr`, by hand against the parent bags for the other five).

## Limitations and open items

- The iTunes Search API returns a **relevance-ranked result set, not search volume**. Result counts here measure how much of the index matches a term, which is a proxy for corpus depth and a reliable detector of pollution — it is *not* a demand estimate. No volume figures are claimed anywhere in this document.
- **`tr` has no existing localization**, so there is no before/after ranking baseline. Ranking checks after the first Turkish release are the only way to settle `Nakış` vs the 6 free characters, and `piksel sanat` in subtitle vs keywords.
- The **en-GB / en-CA / en-AU differentiation is partly judgement.** The head terms in each table were queried live; the craft-adjacency fillers (`yarn`, `crochet`, `quilting`, `canvas`, `grid`, `thread`) were not individually queried and are placed on category logic. Same caveat for `tricot`/`laine` in fr-CA.
- Apple applies English (UK) as a fallback language on several storefronts beyond GB/AU; the en-GB field may therefore be doing work in more markets than its name suggests, which is an argument for keeping the British spellings at the front of that string.
- `goblen` should be **re-tested periodically**. It is the most valuable Turkish craft word commercially and is currently unusable purely because of `Goblin*` prefix matches; if the App Store tightens prefix matching, it becomes a name candidate overnight.
