# Localized App Store Search-Term Research — Store Listing Rename

- **Date:** 2026-09-22
- **App:** Stitch Wish — App Store ID `6792383323`, bundle `com.avk.stitchwish`
- **Scope:** research only. No file under `metadata/` was modified by this document.
- **Data source:** iTunes Search API (`https://itunes.apple.com/search?term=<term>&country=<cc>&entity=software&limit=20`), queried live on 2026-09-22.
- **Baseline verified via** `https://itunes.apple.com/lookup?id=6792383323&country=<cc>`: the live listing name is `Stitch Wish: Cross Stitch` (v1.2) in **every** storefront checked (us, de, fr, es, it, br, jp, kr, ru). No localized names exist today — the rename is a greenfield opportunity in 9 of 10 locales. The app is **not available on the `cn` storefront**; `zh-Hans` therefore serves Simplified-Chinese users on other storefronts (HK/SG/US/CA/AU), and `cn` was used for term evidence only.

## Method and conventions

1. For each locale, the local-language spelling of each concept was sent to the storefront's Search API and the returned `trackName` / `sellerName` / `primaryGenreName` were inspected.
2. A term is treated as **validated** when the query returns cross-stitch or coloring apps in `Games` / `Entertainment` / `Lifestyle`, and as **polluted** when it returns unrelated verticals (Shopping, Music, Utilities).
3. Character counts below were computed programmatically on the exact string (`len()` over the Unicode string), including spaces, punctuation and separators. Full-width CJK punctuation (`＆`, `，`, `、`) counts as **1** character, same as ASCII.
4. Keyword fields are comma separated with **no space after the comma**, and exclude every term already present in that locale's recommended name or subtitle, per the Apple name+subtitle+keywords single-bag rule.

## Cross-locale findings that drive the recommendations

- **`needlepoint` is a weak search term in en-US.** The query returned 19 results of which the large majority are **Shopping** and **Lifestyle** retail/inventory apps for physical needlepoint canvases — `Needlepoint` (KC Needlepoint), `Needlepoint.Com`, `Penny Linn`, `Greenhouse Needlepoint`, `BeStitched Needlepoint`, `Threadstone: Needlepoint Shops`, `Pointed Needle` — plus utilities (`ORTganizer - Needlepoint`, `NeedlePointer`). Only two games surfaced at all (`Cross Stitch Club`). Intent behind `needlepoint` is *buying canvases*, not *playing*. The en-US name is already decided, so this is recorded as a risk, not a change request: the word buys little traffic and consumes 11 of 30 characters. `embroidery` has the same problem (Brother/Husqvarna machine-companion apps dominate) and is correctly relegated to the keyword field.
- **`color by number` is the real volume term everywhere**, and it is a *games* term in every locale — the same publisher set recurs in all ten storefronts (X-FLOW `Happy Color`, Easybrain `Pixel Art`, OAKEVER, Wildlife Studios, Tripledot `Hey Color`, PICFUN `Paint.ly`, Jump Plaid `Colorscapes`, DROIDFUN `No.Pix`, EYEWIND `No.Draw`). Putting the localized color-by-number phrase in the **subtitle** (as en-US already does) is the correct structure and is mirrored in all ten recommendations.
- **`pixel art` survives untranslated in every Latin-script locale** and appears verbatim inside localized competitor names (`Pixel Art - Coloriage`, `Pixel Art - Juegos de pintar`, `Pixel Art － Giochi da colorare`, `Pixel Art - Jogo de pintar`, `Pixel Art: Раскраска по цифрам`). It needs no translation in fr/es/it/pt-BR.
- **The developer already ranks for these terms with a sibling app.** `murat ulug` appears organically in de (`Cross Stitch: Kreuzstich AI`), es (`Cross Stitch: Punto de Cruz AI`), it (`Cross Stitch: Punto Croce AI`), br (`Cross Stitch: Ponto Cruz AI`), jp (`写真からクロスステッチ図案`), kr (`사진으로 십자수 도안`) and cn (`Cross Stitch: 照片转十字绣图案`). That sibling already uses the `<English> : <local term>` pattern, which is further reason for the game to take the **localized-term-first** position instead of competing with itself in English.
- **The current localized keyword fields waste characters.** Every non-en locale in `metadata/version/1.3/` uses `", "` (comma + space) as separator, burning one character per keyword, and `it` (`ricamo` twice) and `pt-BR` (`bordado` twice) each contain a literal duplicate. All recommendations below use no-space separators.

---

## en-US

### Evidence

Queries run on `country=us`: `cross stitch`, `needlepoint`, `color by number`, `embroidery`, `pixel art`.

- `cross stitch` — 20 results, overwhelmingly `Games`. Competitors seen: `Cross-Stitch World` (InertiaSoft), `Cross Stitch Club` (Andrey Baryshnikov), `Cross-Stitch: Color by Number`, `Cross-Stitch: Coloring Book` / `Cross Stitch Coloring Art` / `Cross Stitch:Craft & Art` / `Cross Stitch: Color by Letters` (PLAYCUS LIMITED — four listings), `Magic Cross-Stitch: Pixel Art` (XIMAD), `Cross Stitch King` (MOBIRIX), `Cross-Stitch Masters` (TAPCLAP), `Cross Stitch: Antistress` (Crimson Pine), `Stitchly: Cross stitch`, `Cross Stitch Quest`, `Jigsaw & Cross Stitch`.
- `needlepoint` — 19 results, mostly **Shopping/Lifestyle retail**: `Needlepoint`, `Needlepoint.Com`, `Penny Linn`, `Greenhouse Needlepoint`, `BeStitched Needlepoint`, `Threadstone: Needlepoint Shops`, `Stitchpoint`, `Needlepoint Studio`, `theNDLPTapp`, `Serendipity Needleworks`. Games: only `Cross Stitch Club`.
- `color by number` — 19 results, all `Games`/`Entertainment`: `Color by Number：Coloring Games` (Wildlife), `Happy Color®` (X-FLOW), `Pixel Art － Color by Number` (Easybrain), `Paint by Number Coloring Game` / `Zen Color` / `Color Aura` (OAKEVER), `Hey Color` (Tripledot), `Tap Color Pro`, `Colorscapes®`, `Colors by Number® – No.Draw` (EYEWIND).
- `embroidery` — dominated by machine/digitizing tools: `Brother Artspira`, `Brother My Stitch Monitor`, `StitchBuddy HD`, `Embroidery File Viewer`, `PRO digitizing`, `Embroidery Digitizing & Viewer`, `Threads Embroidery Software`, plus magazines. Low game intent — keyword field only.
- `pixel art` — mixed games and editors: `Pixel Art － Color by Number`, `Sandbox - Pixel Art Coloring`, `Pixel Tap: Color by Number`, `No.Pix`, `Color Island: Pixel Art Puzzle`, `Pixquare`, `8bit Painter`.

**Verdict:** `cross stitch` and `color by number` are the two load-bearing terms. `needlepoint` and `embroidery` are low-intent.

### Recommendation

| Field | Exact string | Chars | Limit |
| --- | --- | --- | --- |
| Name | `Cross Stitch&Needlepoint Game` | 29 | 30 |
| Subtitle | `Relax: color by number art` | 26 | 30 |
| Keywords | `embroidery,pixel,coloring,needlework,craft,pattern,calm,sewing,painting,puzzle,zen,floss,hobby,diy` | 98 | 100 |

Name and subtitle are as already decided. Keywords exclude every token in the name/subtitle bag (`cross`, `stitch`, `needlepoint`, `game`, `relax`, `color`, `by`, `number`, `art`); `pixel` is listed alone because `art` is already carried by the subtitle, and `coloring` is listed because Apple does not reliably stem `color` → `coloring`.

### Description

Opens with the literal `Stitch Wish` **twice** (confirmed in `metadata/version/1.3/en-US.json`).

- Sentence 1 — `Stitch Wish turns cross stitch into a calm, tap-by-tap escape.` → **`This cross stitch game turns needlework into a calm, tap-by-tap escape.`**
- Sentence 2 — `Stitch Wish is designed for quiet moments: ...` → **`Every pattern is designed for quiet moments: ...`**

---

## de-DE

### Evidence

Queries run on `country=de`: `Kreuzstich`, `Stickerei`, `Malen nach Zahlen`, `Sticken`.

- `Kreuzstich` — 20 results, category-correct. Competitors: `Kreuzstich: Cross Stitch`, `Stitchly: Kreuzstich`, `Silk: Kreuzstichmuster`, `Magic Needle: Kreuzstich`, `Kreuzstich Paternmaker`, `Ausmalen - Magic Cross-Stitch` (XIMAD), `Cross-Stitch Masters`, `Cross-Stitch World`, `Cross Stitch: Kreuzstich AI` (own sibling app).
- `Malen nach Zahlen` — 19 results, **all games**, and the phrase appears verbatim in 12 competitor names: `Malen nach Zahlen: Malbücher`, `Pixel Art － Malen nach Zahlen`, `Malen nach Zahlen. Happy Color`, `Zen Color – Malen nach Zahlen`, `Colorscapes: Malen nach Zahlen`, `Malen nach Zahlen: Malbuch`, `Dark Color: Malen nach Zahlen`, `Gallery: Malen nach Zahlen`, `Paint.ly - Malen nach Zahlen`, `Gemütliches Malen nach Zahlen`, `Malen nach Zahlen: Hey Color`, `Diamond: Malen nach Zahlen`. This is the highest-volume German term in the set.
- `Stickerei` — only 14 results and they are education/utility (`Stickerei Designs & Patterns`, `StitchBuddy HD`, `Needlentory`, `Stitch Fiddle Kreuzstich`). Thin but category-adjacent.
- `Sticken` — returns the cross-stitch cluster plus `Kreuzstich Sticken: Basteln`, but is polluted by the `Stickmen ...` ragdoll games (`Stickmen Falling`, `Stickmen Ragdoll`, `Stickmen Exile Hero`) — prefix-matching noise. Keep `sticken` in keywords only.

**Verdict:** `Kreuzstich` for the name; `Malen nach Zahlen` is too valuable to bury and belongs in the subtitle where it fits whole.

### Recommendation

| Field | Exact string | Chars | Limit |
| --- | --- | --- | --- |
| Name | `Kreuzstich & Stickerei Spiel` | 28 | 30 |
| Subtitle | `Malen nach Zahlen, entspannt` | 28 | 30 |
| Keywords | `pixel,handarbeit,sticken,basteln,muster,ausmalen,farben,nadel,hobby,achtsamkeit,vorlagen,puzzle,garn` | 100 | 100 |

`Kreuzstich` never drops. `Spiel` fits, so nothing had to be shortened. Alternative if `Stickerei`'s thin volume is judged not worth 9 characters: `Kreuzstich: Malen nach Zahlen` (29 chars) puts the highest-volume phrase in the name and frees the subtitle for `Stickerei, Handarbeit & Pixel` (29).

### Description

Opens with the literal `Stitch Wish` twice.

- `Stitch Wish verwandelt Kreuzstich in eine ruhige ...` → **`Dieses Kreuzstich-Spiel verwandelt Handarbeit in eine ruhige, Schritt-für-Schritt-Flucht.`**
- `Stitch Wish ist für ruhige Momente konzipiert: ...` → **`Das Spiel ist für ruhige Momente konzipiert: ...`**

---

## fr-FR

### Evidence

Queries run on `country=fr`: `point de croix`, `broderie`, `coloriage par numero`, `pixel art`.

- `point de croix` — 20 results, category-correct, phrase used verbatim by: `Stitchly: Point de croix`, `Point de croix: Cross Stitch`, `Point de Croix: Broderie Brico`, `Point de croix: Crossie`, `StitchHub: Point de croix`, `Magic Needle: Point de croix`, `Stitch Fiddle Point de Croix`, `Calculateurs de Point de Croix`, `StitchStash: Point de Croix`, `point de croix roi` (MOBIRIX).
- `broderie` — mixed: machine companions (`Brother Artspira`, `Brother My Design Snap`, `HUSQVARNA VIKING® QuickDesign`, `PXF Express`) alongside `Silk : motifs de broderie`, `Stitchique: Art de la broderie`, `Point de Croix: Broderie Brico`. Moderate intent.
- `coloriage par numero` (unaccented, as typed) — 20 results, all games: `Peinture par numéro: coloriage`, `Happy Color® Jeu de coloriage`, `Paint.ly - Jeux de Coloriage`, `Art Color:Peinture par Numéros`, `Pixel Art - Coloriage`, `Colorscapes: Jeux de Coloriage`, `Zen Color - Coloriage numéroté`, `Hey Color – Jeux de Coloriage`, `Polygon – Coloriage par Numero`, `Coloriage par numéro`, `Coloriage par numéro cosy`, `April - Coloriage Numéroté`. Both `coloriage` and `peinture par numéro` are live; `coloriage` is the broader head term.
- `pixel art` — untranslated in French listings: `Pixel Art - Coloriage`, `Pixel Art à colorize - No.Draw`, `Pixel Art Book：Color By Number`, `Pixel Art – Dessin a Colorier`, `Jeux de dessin - Jeu pixel art`.

### Recommendation

| Field | Exact string | Chars | Limit |
| --- | --- | --- | --- |
| Name | `Point de croix & broderie` | 25 | 30 |
| Subtitle | `Coloriage par numéro relaxant` | 29 | 30 |
| Keywords | `pixel,art,motif,couture,artisanat,détente,calme,aiguille,dessin,jeux,zen,perles,fil,loisirs,peinture` | 100 | 100 |

`jeu` is deliberately omitted from the name: `Point de croix & broderie jeu` (29) is ungrammatical French, and per the shortening rule the word for "game" is the first thing to drop. `jeux` is recovered in the keyword field. `broder` was removed from the keyword list because it is a substring of `broderie` in the name.

### Description

Opens with the literal `Stitch Wish` twice.

- `Stitch Wish transforme le point de croix en une évasion calme ...` → **`Ce jeu de point de croix transforme la broderie en une évasion calme, touche par touche.`**
- `Stitch Wish est conçu pour les moments calmes : ...` → **`L'application est conçue pour les moments calmes : ...`**

---

## es-ES

### Evidence

Queries run on `country=es`: `punto de cruz`, `bordado`, `colorear por numeros`, `pixel art`.

- `punto de cruz` — 20 results, category-correct: `Stitchly: Punto de cruz`, `Punto De Cruz: Pasatiempos`, `Punto de cruz: Cross Stitch`, `StitchCraft: Punto de Cruz`, `Punto de cruz mágico: colorear` (XIMAD), `StitchHub: Punto de cruz`, `Magic Needle: Punto de Cruz`, `Sala de Punto de Cruz` (Moo Moo Lab), `Punto de cruz Rey` (MOBIRIX), `Calculadoras de Punto de Cruz`, plus own sibling `Cross Stitch: Punto de Cruz AI`.
- `bordado` — heavily machine/digitizing (`Brother Artspira`, `Bordado: Digitalizar y Ver`, `Stitch Viewer Pro`, `PFAFF® ImageStitch`, `Stitchique: Arte de bordado IA`). Moderate intent, but it is the correct Spanish rendering of the needlepoint/embroidery slot.
- `colorear por numeros` — 19 results, all games: `Color by Number: Colorear`, `Pintar por número color juegos`, `Pixel Art - Juegos de pintar`, `Zen Color - Colorea por número`, `Happy Color® juegos de pintar`, `No.Pix - Colorea por números`, `Pinta por Números: Colorear`, `Pintar con Numeros – Hey Color`, `Gallery: Colorear por números`, `ColorPlanet Pintar con Números`. Note both `colorear` and `pintar` are in heavy use; `colorear` matches the "coloring" concept, `pintar` the "paint by number" concept.
- `pixel art` — untranslated: `Pixel Art - Juegos de pintar`, `Sandbox - Pixel Art Colorear`, `Pixel para colorear – No.Draw`, `Pixel Art Book：Color By Number`.

### Recommendation

| Field | Exact string | Chars | Limit |
| --- | --- | --- | --- |
| Name | `Punto de cruz y bordado` | 23 | 30 |
| Subtitle | `Colorear por números relax` | 26 | 30 |
| Keywords | `pixel,arte,bordar,costura,artesania,patrones,calma,aguja,pintar,juegos,mandala,hilo,zen,puntada,diy` | 99 | 100 |

`juego` dropped from the name (rule order) since `Punto de cruz y bordado juego` reads as broken Spanish; `juegos` recovered in keywords. `pintar` is kept in keywords because it is a distinct high-volume verb from `colorear` in the subtitle. `artesania` and `patrones` are intentionally unaccented to also catch unaccented typing.

### Description

Opens with the literal `Stitch Wish` twice.

- `Stitch Wish convierte el punto de cruz en un escape tranquilo ...` → **`Este juego de punto de cruz convierte el bordado en un escape tranquilo, toque a toque.`**
- `Stitch Wish está diseñado para momentos tranquilos: ...` → **`La aplicación está diseñada para momentos tranquilos: ...`**

---

## it

### Evidence

Queries run on `country=it`: `punto croce`, `ricamo`, `colora per numeri`, `pixel art`.

- `punto croce` — 20 results, category-correct: `Schemi Punto Croce: Disegno`, `Stitchly: Punto croce`, `Punto croce: Cross Stitch`, `StitchHub: Punto croce`, `Stitch Fiddle Punto Croce`, `Punto Croce Magico: Pixel Art` (XIMAD), `Magic Needle: Punto croce`, `Calcolatori per Punto Croce`, `Punto croce re` (MOBIRIX), `Punto Croce: Cross Stitch Room`, plus own sibling `Cross Stitch: Punto Croce AI`. Note `Schemi Punto Croce` ranks first — **`schemi`** (patterns/charts) is a strong Italian co-term.
- `ricamo` — 20 results: `Ricamo Disegni & Stitching`, `Ricamo: Digitalizza & Vedi`, `Stitchique ricamo artistico AI`, `Tondo, punto croce e ricamo`, plus Brother machine apps. Category-correct, moderate intent.
- `colora per numeri` — 19 results, all games: `Colora per Numeri: Colorela`, `Colora per Numeri & Pixel Art`, `Pixel Joy – Colora per numero`, `Mini Mondo: Colora per Numero`, `Colora per Numero Auto`, `PixArt Maker:colora per numero`, `PaintMe - Colora per Numero`, `Colorare con i numeri Relax`, `April - Colorare con i numeri`, `Hey Color: Giochi da Colorare`, `Happy Color® gioco da colorare`, `Pixel Art － Giochi da colorare`. Both `colora per numeri` and `giochi da colorare` are live phrasings.
- `pixel art` — untranslated: `Pixel Art － Giochi da colorare`, `Sandbox Colorazione Pixel Art`, `Pixel Art – Giochi da Colorare`, `Pixel Colorare con Numeri`.

### Recommendation

| Field | Exact string | Chars | Limit |
| --- | --- | --- | --- |
| Name | `Punto croce e ricamo` | 20 | 30 |
| Subtitle | `Colora per numeri, pixel art` | 28 | 30 |
| Keywords | `giochi,ricamare,cucito,artigianato,modelli,calma,ago,colorare,dipingere,puzzle,zen,perline,schemi` | 97 | 100 |

`gioco` dropped from the name per rule order; `giochi` (the form actually used in competitor names, e.g. `Giochi da colorare`) leads the keyword field instead. `schemi` is included on the strength of `Schemi Punto Croce` ranking #1 for `punto croce`. If a longer name is preferred, `Gioco di punto croce e ricamo` is exactly 29 chars and grammatical, but it is not keyword-first.

### Description

Opens with the literal `Stitch Wish` twice.

- `Stitch Wish trasforma il punto croce in una fuga tranquilla ...` → **`Questo gioco di punto croce trasforma il ricamo in una fuga tranquilla, tocco dopo tocco.`**
- `Stitch Wish è pensato per i momenti tranquilli: ...` → **`L'app è pensata per i momenti tranquilli: ...`**

---

## pt-BR

### Evidence

Queries run on `country=br`: `ponto cruz`, `bordado`, `colorir por numero`, `pixel art`.

- `ponto cruz` — 19 results, category-correct: `Stitchly: Ponto cruz`, `Ponto cruz: Cross Stitch`, `Stitch Craft Ponto de Cruz`, `Ponto Cruz` (Daniel Pires), `Ponto de Cruz: Crossie`, `Silk: Bordados em Ponto Cruz`, `Ponto Cruz: Desenho Patrones`, `Magic Needle: Ponto de cruz`, `Calculadoras de Ponto Cruz`, `Bordado Mágico: Jogo Pixel Art` (XIMAD), plus own sibling `Cross Stitch: Ponto Cruz AI`. Both `ponto cruz` and `ponto de cruz` are in live use; the short form `ponto cruz` appears in more top-ranked names.
- `bordado` — 20 results; the top of the list is machine/digitizing (`StitchBuddy HD`, `Stitch Viewer Pro`, `Brother Artspira`, `Bordado: Digitalizar e Ver`), but `Bordado Mágico: Jogo Pixel Art` is a direct game competitor using exactly the bordado + pixel art + jogo combination.
- `colorir por numero` — 19 results, all games: `Pixel Art - Jogo de pintar`, `Pintar por Número jogos legais`, `Zen Color - Cor por Número`, `Color by Number: Colorir`, `Happy Color® – jogo de pintar`, `No.Pix - Colorir por Números`, `Colorscapes-Pinte com Números`, `Art Color: Pintar por Números`, `Pintar por Números: Hey Color`, `Colorir por Número: puzzle`, `Jogos de pintar por número art`. `pintar` is at least as common as `colorir` in names.
- `pixel art` — untranslated: `Pixel Art - Jogo de pintar`, `Sandbox Pixel Art para colorir`, `Jogos de pintar - Pixel art`, `Bordado Mágico: Jogo Pixel Art`.

### Recommendation

| Field | Exact string | Chars | Limit |
| --- | --- | --- | --- |
| Name | `Ponto cruz e bordado` | 20 | 30 |
| Subtitle | `Colorir por número relaxante` | 28 | 30 |
| Keywords | `pixel,arte,bordar,costura,artesanato,padroes,calma,agulha,pintar,jogos,zen,linha,ponto de cruz` | 94 | 100 |

`jogo` dropped from the name per rule order; `jogos` recovered in keywords. The long form `ponto de cruz` is carried explicitly in the keyword field so both spellings are covered — the name supplies `ponto` + `cruz`, the keyword field supplies the exact phrase. `padroes` is intentionally unaccented.

### Description

Opens with the literal `Stitch Wish` twice.

- `Stitch Wish transforma o ponto cruz em uma fuga calma ...` → **`Este jogo de ponto cruz transforma o bordado em uma fuga calma, toque a toque.`**
- `Stitch Wish foi projetado para momentos tranquilos: ...` → **`O app foi projetado para momentos tranquilos: ...`**

---

## ja

### Evidence

Queries run on `country=jp`: `クロスステッチ`, `刺繍`, `ぬりえ`, `ドット絵`, `数字ぬりえ`.

- `クロスステッチ` — 20 results, category-correct and the unambiguous head term: `クロスステッチ: Cross Stitch`, `クロスステッチの王` (MOBIRIX), `クロスステッチ - マスターズクラブ` (TAPCLAP), `Stitchly: クロスステッチ`, `クロスステッチ・ワールド` (InertiaSoft), `クロス・ステッチ：刺繍図案の作成とパターン・メーカー`, `クロスステッチ計算ツール`, `Stitch Fiddle : クロスステッチ`, `マジッククロスステッチ：ペインティング &ドット 絵 ゲーム` (XIMAD), `クロスステッチ図案: Crossie`, `Cross Stitch Club - 美しい刺繍の本`, plus own sibling `写真からクロスステッチ図案`.
- `刺繍` — 19 results, category-correct: `刺しゅう糸`, `刺繍デジタイズ＆ファイルビューア`, `クロス・ステッチ：刺繍図案の作成とパターン・メーカー`, `Cross Stitch Club - 美しい刺繍の本`, `ホビーラホビーレ`, `ユザワヤ公式アプリ`, `CRAFTING`. Note the alternate okurigana spelling **`刺しゅう`** is live (`刺しゅう糸`) and is a separate index token — worth a keyword slot.
- `数字ぬりえ` vs `ぬりえ` — the canonical competitor phrasing is **`数字で塗り絵`** (kanji `塗り絵`, with `で`), used by `Pixel Art - 数字で塗り絵` (Easybrain), `Happy Color® – 数字で塗り絵と色ぬりえ`, `数字で塗り絵 - すうじでぬりえパズルゲーム` (OAKEVER), `Colorscapes - 数字で塗り絵ゲーム`, `No.Pix - 数字で塗り絵`, `ColorPlanet: 数字で塗り絵`, `Paint.ly塗り絵 - 数字で色ぬりえ`, `大人向け数字による塗り絵`, `UNICORN 数字で塗り絵`, `Color a Day: 大人のための塗り絵ゲーム:数字で`. The hiragana `ぬりえ` also returns the same cluster and is used as a secondary spelling — both spellings are needed.
- `ドット絵` — this is the correct Japanese for pixel art, but the results skew to **editors** (`8bit Painter`, `ドットピクト！`, `ドット絵エディタ - Dottable`, `ドット絵メーカー`, `Pixelable`, `Pixquare`, `ドット絵作成アプリ：Pixelome`) plus unrelated RPGs. `Pixel Art - 数字で塗り絵` is the one coloring game returned. Use it, but it is weaker than `数字で塗り絵`.

**Verdict:** `クロスステッチ` + `刺繍図案` in the name; `数字で塗り絵` in the subtitle. Both spellings of coloring (`塗り絵` in subtitle, `ぬりえ` in keywords) must be covered.

### Recommendation

| Field | Exact string | Chars | Limit |
| --- | --- | --- | --- |
| Name | `クロスステッチ＆刺繍図案 ドット絵ゲーム` | 20 | 30 |
| Subtitle | `数字で塗り絵、癒しのパズル` | 13 | 30 |
| Keywords | `手芸,裁縫,ぬりえ,リラックス,パターン,ピクセル,暇つぶし,無料,アート,瞑想,針,趣味,手作り,ハンドメイド,大人,ビーズ,オフライン,刺しゅう,cross stitch,pixel art,簡単` | 100 | 100 |

`図案` (pattern/chart) is added to the name because it is the term Japanese cross-stitchers actually search and it appears in three ranked competitor names. `脳トレ` was the only candidate dropped for space. English `cross stitch` and `pixel art` are included because the Japanese storefront returns and ranks English-named apps for those strings.

### Description

Opens with the literal `Stitch Wish` twice.

- `Stitch Wish は、クロスステッチを静かなタップごとの脱出ゲームに変えます。` → **`このクロスステッチゲームは、刺繍を静かなタップごとの体験に変えます。`**
- `Stitch Wish は、待合室、通勤中、または 1 日の最後の 10 分間など、静かな瞬間のために設計されています。` → **`このアプリは、待合室、通勤中、または 1 日の最後の 10 分間など、静かな瞬間のために設計されています。`**

---

## ko

### Evidence

Queries run on `country=kr`: `십자수`, `자수`, `숫자 색칠`, `픽셀 아트`, `컬러링`.

- `십자수` — 20 results, category-correct and the unambiguous head term: `Stitchly: 십자수`, `십자수: Cross Stitch`, `십자수의 왕` (MOBIRIX), `매직 십자수: 숫자 색칠 & 그리기 게임` (XIMAD), `십자수 - 마스터 클럽` (TAPCLAP), `십자수 공예 - 크로스 스티치 패턴 만들기`, `Beads Coloring - 해피컬러 보석십자수 픽셀`, `코지 스티치`, plus own sibling `사진으로 십자수 도안`. Note `보석십자수` (jewel/diamond cross stitch) is a live Korean sub-niche.
- `자수` — returns the same cross-stitch cluster (it is a substring of 십자수 and a real word for embroidery): `자수 디지타이징 & 파일 뷰어`, `Cross Stitch Club - 크로스 스티치 클럽`, `Magic Needle: 크로스-스티치`, `십자수 도안: Crossie`, `십자수 계산기`. Also confirms **`크로스 스티치`** (transliterated, with space) as a distinct live token.
- `숫자 색칠` — 20 results, all games: `Pixel Art - 숫자로 색칠하기` (Easybrain), `숫자별로 색칠하기: 픽셀 색칠 게임` (Wildlife), `숫자로 색칠하기 - 재미있는 게임` (OAKEVER), `Happy Color® – 컬러링북, 숫자 색칠 게임`, `No.Pix - 숫자에 맞춰 색칠하기`, `Zen Color - 숫자 색칠`, `색칠공부게임 - 컬러링북 & 숫자로 색칠하기`, `Paint.ly - 숫자 색칠 게임`, `미니 월드: 숫자 따라 색칠하기`, `픽셀 아트, 숫자별 색칠하기 - 아띠랜드2`. **`색칠`/`색칠하기`** is the verb that matters.
- **`컬러링` is polluted and must be avoided.** The query returned ringback-tone/ringtone apps in `Music` at the top — `벨팡-벨소리 컬러링 통화연결음`, `벨365`, `최고의 벨소리 2026`, `벨소리 메이커 - RingTune` — because 컬러링 is the Korean consumer word for a *ring-back tone*. `컬러링북` (coloring book) is safe as a compound, but bare `컬러링` wastes characters on the wrong intent. The current `ko.json` keyword field does not use it, which is correct; do not introduce it.
- `픽셀 아트` — live and used verbatim: `픽셀 아트 채색 게임 - No.Draw`, `픽셀 아트 - Pixel Canvas`, `픽셀 아트 - 번호색칠공부`, `Pixquare - 픽셀아트 프로그램`. Both spaced (`픽셀 아트`) and unspaced (`픽셀아트`) forms appear.

### Recommendation

| Field | Exact string | Chars | Limit |
| --- | --- | --- | --- |
| Name | `십자수&자수 도안 픽셀아트 게임` | 17 | 30 |
| Subtitle | `숫자로 색칠하는 힐링 퍼즐` | 14 | 30 |
| Keywords | `바느질,공예,휴식,패턴,크로스 스티치,명상,무료,취미,그림,색칠공부,수놓기,실,오프라인,어른,감성,자수도안,cross stitch,pixel art,도트,보석십자수` | 91 | 100 |

`도안` (pattern/chart) is added to the name — it is the term the developer's own sibling app already ranks with (`사진으로 십자수 도안`). `아트` was removed from the keyword list as a substring of `픽셀아트` in the name. `컬러링` deliberately excluded (ringback-tone pollution). `크로스 스티치` is carried in keywords so the transliterated spelling is covered alongside the native `십자수` in the name.

### Description

Opens with the literal `Stitch Wish` twice. Note `ko.json` also contains the string `스티치` inside other copy — check that separately when editing.

- `Stitch Wish는 십자수를 탭하여 탭하는 조용한 탈출 게임으로 바꿔줍니다.` → **`이 십자수 게임은 자수를 탭 한 번으로 즐기는 조용한 휴식으로 바꿔줍니다.`**
- `Stitch Wish는 대기실, 통근 또는 하루의 마지막 10분 등 조용한 순간을 위해 설계되었습니다.` → **`이 앱은 대기실, 통근 또는 하루의 마지막 10분 등 조용한 순간을 위해 설계되었습니다.`**

---

## zh-Hans

### Evidence

Queries run on `country=cn` (term evidence only — the app is **not** distributed on the `cn` storefront; `zh-Hans` serves Simplified-Chinese users on HK/SG/US/CA/AU): `十字绣`, `刺绣`, `数字填色`, `像素画`, `涂色`.

- `十字绣` — 18 results, category-correct: `Stitchly: 十字绣`, `十字绣涂色游戏 - 手工拼豆游戏 像素数字填色拼图` (Finger Interactive), `手工十字绣 — 做衣服上色模拟器`, `Magic Needle: 十字绣`, `十字绣图案: Crossie`, `十字绣室: Cross Stitch` (Moo Moo Lab), `绣库`, plus own sibling `Cross Stitch: 照片转十字绣图案`.
- **`拼豆` (perler/fuse beads) is the dominant adjacent niche in Chinese** and co-occurs with 十字绣 constantly: `拼豆 Pixel Color - 数字填色游戏`, `颂拼豆`, `拼豆设计器`, `拼豆图案设计`, `拼豆豆 - 拼豆图纸生成器 像素数字填色助手`, `豆画 - 拼豆图纸创作`, `拼豆画-拼豆图纸生成器`, `像素创作家-拼豆图纸像素画生成器`, `像素豆`, `拼豆艺术-拼豆.像素画`, `拼豆绘`, `Handpix 像素手 - 像素画和拼豆专业软件`. This is the single biggest Chinese-specific opportunity and is absent from the current `zh-Hans.json` keyword field.
- `刺绣` — 19 results, but skewed to professional/industrial digitizing (`刺绣-指尖上的绣花工具`, `图宝刺绣`, `DST刺绣绣花大师`, `绣花ERP`, `Stitch Viewer Pro`). Low game intent — keyword field, not name-critical.
- `数字填色` — 17 results, all coloring games: `花花填色-数字涂色秘密花园Paint.ly画画小游戏`, `填色一二三：像素着色应用` (Wildlife), `画画像素涂色—数字填色花园`, `草莓涂涂 - 数字填色` (DROIDFUN), `画画涂色—数字填色游戏`, `Dazzly绚石工坊——按数字填色的钻石艺术`, `Draw Color 数字填色`, `曼陀羅數字填色`, `April - 成人艺术油画按数字填色游戏`. This is the canonical Chinese color-by-number phrase.
- `像素画` — the correct Chinese for pixel art, returns `8bit像素画家`, `像素画 - 像素涂色 & 数字填色`, `点音:像素画画社区`, `像素创作家`, plus the whole 拼豆 cluster. Note `像素艺术` (as used in the current metadata) returned fewer category hits than `像素画`.
- `涂色` / `着色` — both live; `涂色` is the broader consumer term (`Pigment - 涂色游戏`, `指尖涂色`, `涂色花园`, `悦涂色`, `十字绣涂色游戏`), `着色` the more formal one (`填色一二三：像素着色应用`).

**Verdict:** replace `像素艺术` with `像素画`, and add `拼豆` — the current keyword field misses the highest-volume Chinese adjacency entirely.

### Recommendation

| Field | Exact string | Chars | Limit |
| --- | --- | --- | --- |
| Name | `十字绣&刺绣图案 像素画游戏` | 14 | 30 |
| Subtitle | `数字填色，解压治愈手工` | 11 | 30 |
| Keywords | `拼豆,绣花,放松,涂色,着色,冥想,针线,免费,休闲,艺术,减压,离线,单机,解谜,涂鸦,创作,十字绣图纸,cross stitch,pixel art,手工艺,秘密花园,绣线` | 88 | 100 |

`图案` added to the name (it is the term the sibling app ranks with). `绣图` was removed as a substring of `刺绣图案`; `十字绣图纸` is kept as the long-tail pattern-chart phrase. `解压`/`治愈` in the subtitle are the two standard Chinese relaxation-game descriptors. There are ~12 free characters in the keyword field for further terms once real ranking data is available.

### Description

Opens with the literal `Stitch Wish` twice — once inside Chinese title brackets `《Stitch Wish》`, once bare. Both must be handled.

- `《Stitch Wish》将十字绣变成了一种平静的、一步一步的逃离。` → **`这款十字绣游戏将刺绣变成一种平静的、一步一步的放松体验。`**
- `Stitch Wish 专为安静时刻而设计：候诊室、通勤或一天的最后十分钟。` → **`本应用专为安静时刻而设计：候诊室、通勤或一天的最后十分钟。`**

---

## ru

### Evidence

Queries run on `country=ru`: `вышивка крестиком`, `вышивка крестом`, `вышивка`, `раскраска по номерам`, `пиксель арт`.

- **`вышивка крестом` is the form competitors actually use in names**, not `крестиком`. Evidence: `Вышивка крестом: Cross Stitch`, `StitchHub: Вышивка крестом`, `Stitchly: Вышивка крестом`, `Magic Needle: Вышивка крестом`, `Uzora: Вышивка крестом`, `Stitch Fiddle: Вышивка Крестом`, `Вышивка крестом король` (MOBIRIX), `Калькуляторы вышивки крестом`. Only `Чудо вышивка крестиком - игры` (XIMAD) and `Tondo, вышивка крестиком` use `крестиком`. Both queries return the same category cluster, so both forms are indexed by users — but `крестом` is the ranking form. The current `ru.json` keyword field uses only `вышивка крестиком`, i.e. it is optimizing for the minority form.
- `вышивка` alone — also category-correct and returns games: `Cross Stitch Color by Number`, `Cross Stitch Club`, `Cross Stitch: Шитье крестиком`, `Cross-Stitch World`, `Dazzly - Алмазная вышивка` (diamond embroidery — a live adjacent niche). Russian uses one root for both cross-stitch and embroidery, so `вышивка` fills the needlepoint/embroidery slot for free.
- `раскраска по номерам` — 18 results, all games: `Happy Color® – игра раскраска`, `Pixel Art: Раскраска по цифрам`, `Раскраска по цифрам игры` (OAKEVER), `Zen Color - По номерам`, `Color by Number: Pаскраска`, `Раскраска по номерам Hey Color`, `Уютная раскраска по номерам`, `No.Pix - Раскраска по номерам`, `Paint.ly - Раскраска по цифрам`, `Раскраска по номерам - цифрам`, `GownColor-Раскраска по номерам`, `Amuseum - Раскраска по цифрам`. Both `по номерам` and `по цифрам` are in heavy use — roughly a 50/50 split in competitor names.
- `пиксель арт` — live: `Pixel Art: Раскраска по цифрам`, `Песочница Пиксельная Раскраска`, `Раскраска по номерам - пиксель`, `Пиксель-арт мейкер PixelCanvas`.

### Recommendation

| Field | Exact string | Chars | Limit |
| --- | --- | --- | --- |
| Name | `Вышивка крестом: игра` | 21 | 30 |
| Subtitle | `Раскраска по номерам, релакс` | 28 | 30 |
| Keywords | `крестиком,пиксель,арт,рукоделие,узоры,схемы,шитье,медитация,антистресс,хобби,бисер,игры,раскраски` | 97 | 100 |

Russian needs no separate embroidery word — `вышивка` in the name covers both the cross-stitch and the embroidery/needlepoint slot, which is why `игра` can be kept here even though it is dropped in the Romance locales. `крестиком` leads the keyword field to recover the minority inflection that the name does not supply. `по цифрам` is the notable term that did **not** fit; it is the first candidate to swap in if `релакс` underperforms. `нитки` was dropped for space.

---

## Summary of proposed strings

| Locale | Name | N | Subtitle | S | KW |
| --- | --- | --- | --- | --- | --- |
| en-US | `Cross Stitch&Needlepoint Game` | 29 | `Relax: color by number art` | 26 | 98 |
| de-DE | `Kreuzstich & Stickerei Spiel` | 28 | `Malen nach Zahlen, entspannt` | 28 | 100 |
| fr-FR | `Point de croix & broderie` | 25 | `Coloriage par numéro relaxant` | 29 | 100 |
| es-ES | `Punto de cruz y bordado` | 23 | `Colorear por números relax` | 26 | 99 |
| it | `Punto croce e ricamo` | 20 | `Colora per numeri, pixel art` | 28 | 97 |
| pt-BR | `Ponto cruz e bordado` | 20 | `Colorir por número relaxante` | 28 | 94 |
| ja | `クロスステッチ＆刺繍図案 ドット絵ゲーム` | 20 | `数字で塗り絵、癒しのパズル` | 13 | 100 |
| ko | `십자수&자수 도안 픽셀아트 게임` | 17 | `숫자로 색칠하는 힐링 퍼즐` | 14 | 91 |
| zh-Hans | `十字绣&刺绣图案 像素画游戏` | 14 | `数字填色，解压治愈手工` | 11 | 88 |
| ru | `Вышивка крестом: игра` | 21 | `Раскраска по номерам, релакс` | 28 | 97 |

All name and subtitle values are <= 30 characters and all keyword values are <= 100 characters, verified programmatically.

## Open items

- `needlepoint` in the en-US name is retained per decision, but the evidence says it is a Shopping-intent term. Worth an A/B or a post-launch ranking check against the 11 characters it costs.
- ja / ko / zh-Hans names use only 20 / 17 / 14 of 30 characters. CJK terms are dense, so this is expected, but there is real headroom for one more concept per locale once live ranking data exists.
- `zh-Hans` has ~12 free keyword characters and `ko` ~9.
- The description edits above matter for branding consistency and for the Google Play listing; note that on iOS the **description is not indexed for search**, so these changes carry no App Store ranking effect on their own.
- Existing localized keyword fields in `metadata/version/1.3/` should switch from `", "` to `","` separators, and the duplicate entries in `it.json` (`ricamo` twice) and `pt-BR.json` (`bordado` twice) should be removed, independently of this rename.
