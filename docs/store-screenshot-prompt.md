# Store Screenshot Generation Prompt (Stitch Wish)

Paste everything below the line into Claude Design / an image-generation design session.

---

## ROLE

You are a senior mobile app-store creative designer. Produce a complete App Store (iOS) and Google Play (Android) screenshot set for a cozy cross-stitch puzzle game called **Stitch Wish**. Output must be production-ready, pixel-exact, and localizable.

## 1. THE APP

- **Name:** Stitch Wish
- **Store title:** `Stitch Wish: Cross Stitch` (25 chars)
- **iOS subtitle:** `Relaxing cross stitch art` (25 chars)
- **Category:** Games › Puzzle (secondary: Games › Casual)
- **Platforms:** iOS 16.4+, Android 7.0+. Portrait only, tablets supported in portrait.
- **What it is:** A catalog-first digital cross-stitch game. You pick a pattern, then fill a stitch grid square by square with DMC thread colors — pinch to zoom, pan across the canvas, tap to stitch. It is a calm, tactile, no-timer, no-pressure coloring/craft experience.
- **What makes it different:**
  - Hand-curated **Pattern Catalog** plus patterns published by other players.
  - **Photo import** — turn your own photo into a real stitchable pattern.
  - **AI artwork** — generate artwork from a text prompt and stitch it.
  - **Offline-first** — sessions and progress keep working with no connection.
  - **Stitch Coin** economy, daily tasks, and player-started rewarded ads (never forced).
  - **Premium membership** — extra grid themes (Classic Linen, Rose Garden, Moonlit Aida), stitch shapes, no interruptions.
- **Tone:** cozy, warm, handmade, calm, analog-craft. NOT neon, NOT gamer-aggressive, NOT corporate SaaS.

## 2. COLOR SYSTEM (use exactly these hex values)

Surfaces
- Warm linen background `#FAF6F0`
- Card / white `#FFFFFF`
- Warm border `#EADFC9`
- Preview backdrop `#F3EAD9`
- HUD surface `#FFF9EE`

Thread accents (the brand palette — these are named after threads, use them as the accent hierarchy)
- Warm Rose `#C36A76` — primary accent, hero highlights, CTA
- Sage Green `#7A9A82` — secondary accent
- Honey Gold `#D4A35C` — tertiary accent, coins/rewards, premium
- Deep Teal `#2C5E65` — dark anchor, gameplay frame
- Honey soft `#F6E7C8` — raised action surface
- Frame edge `#234C52` / frame shadow `#173438` — stitched HUD frame

Text
- Primary `#2E2A25` (warm brown-slate, never pure black)
- Secondary `#857D75`
- On-dark `#FAF6F0`

Status: success `#5B8C5A`, error `#D35D5D`, warning `#D39E5D`

Grid themes (for gameplay shots)
- Classic Linen: bg `#FAF6F0`, minor grid `#E6E1D8`, major grid `#B6AE9F`

**Rules:** every background is warm-neutral linen or a soft Deep Teal→Sage gradient. Never pure white page, never pure black, never neon. Max 3 accent colors per single screenshot. Keep the whole set reading as one system — same background family across all 10.

## 3. TYPOGRAPHY

- **Caption headline:** a warm geometric/humanist sans with soft terminals — Poppins SemiBold / Nunito Bold / Quicksand Bold. Weight 600–700. Tight tracking (-1%). Sentence case, not ALL CAPS.
- **Caption subline:** same family, Regular/Medium 400–500, color `#857D75` on light backgrounds, `#FAF6F0` at 80% on dark.
- **In-device UI text:** system stack (SF Pro on iOS mocks, Roboto on Android mocks), sizes from the app scale: 12 / 14 / 16 / 18 / 20 / 24 / 32; weights 400 / 500 / 600 / 700.
- **Sizes on a 1290×2796 canvas:** headline 96–116 px, subline 48–56 px, line-height 1.15 headline / 1.35 subline.
- **Hierarchy per screenshot:** 1 headline (max 4 words) + 1 subline (max 8 words). Never a third text block.
- Numerals: tabular for coin counts and progress percentages.
- Never place text over busy pattern art — always over a solid or 1-stop gradient band.

## 4. THE 10 SCREENSHOTS

Order matters — 1–3 must sell the app with no reading required. Each entry: what to render inside the device + the caption headline + subline.

1. **Hero / gameplay** — Zoomed stitch grid mid-progress, half the canvas stitched into a recognizable cozy motif (a fox in autumn leaves), unstitched cells showing faint symbol+number, a floating DMC color chip HUD at the bottom on `#FFF9EE` with `#234C52` frame edge.
   Headline: **Stitch, square by square** · Sub: *Calm, tactile, no timers*
2. **Pattern catalog** — Browse grid, 6 pattern preview cards on linen, category chips, like hearts.
   Headline: **Hundreds of patterns** · Sub: *New designs to stitch every week*
3. **Photo import** — Split composition: a real photo on the left morphing into a stitch grid on the right, with the conversion controls visible.
   Headline: **Your photo, stitched** · Sub: *Turn any picture into a pattern*
4. **AI artwork** — A prompt field with example text, plus the generated artwork previewing as a pattern.
   Headline: **Imagine it, stitch it** · Sub: *Describe artwork and start stitching*
5. **Thread palette** — DMC color picker open, palette swatches in the thread accents, remaining-count badges per color.
   Headline: **Real DMC threads** · Sub: *Authentic floss colors and codes*
6. **Progress & completion** — A finished piece with a celebration overlay, progress ring at 100%, confetti in Rose/Sage/Honey.
   Headline: **Finish something beautiful** · Sub: *Watch every piece come to life*
7. **Offline play** — Device with an airplane-mode indicator, gameplay running normally, a small "Offline — progress saved" pill in `#5B8C5A`.
   Headline: **Stitch anywhere** · Sub: *Works fully offline, syncs later*
8. **Coins & rewards** — Stitch Coin balance in Honey Gold, daily tasks list with checkmarks, unlock button.
   Headline: **Earn as you stitch** · Sub: *Daily tasks and free rewards*
9. **Premium themes** — Three grid-theme thumbnails side by side (Classic Linen, Rose Garden, Moonlit Aida) with the premium one highlighted in Honey Gold.
   Headline: **Make it yours** · Sub: *Premium themes and stitch styles*
10. **Community** — Creator profile with published patterns, likes, and a share sheet.
    Headline: **Share your patterns** · Sub: *Publish designs the world can stitch*

## 5. LAYOUT SYSTEM

- **Portrait phone/tablet screenshots:** caption band occupies the top 22–26% of the canvas (headline + subline, centered), device mockup below, bleeding off the bottom edge by ~8%.
- Device frame: rounded modern handset/tablet, thin `#EADFC9` bezel highlight, soft warm shadow (`rgba(35,76,82,0.18)`, 60 px blur, 24 px Y-offset). No hands, no photographic desk scenes.
- Safe margins: 8% left/right on phones, 10% on tablets. Nothing important within 6% of any edge (store UI crops corners).
- Alternate the background treatment in a fixed rhythm so the set has cadence: shots 1, 4, 7, 10 on a Deep Teal→Sage gradient with light text; the rest on linen `#FAF6F0` with dark text.
- Optional decorative layer: faint stitch-cross motifs or thread-loop line art at 6–10% opacity, never behind text.
- Tablet variants use the same caption text but a wider device and more visible catalog content (more columns) — do not simply upscale the phone image.

## 6. EXPORT MATRIX

Produce every screenshot in all four device sizes:

| Target | Pixel size | Notes |
|---|---|---|
| iPhone 6.9" (App Store, required) | 1290 × 2796 | Portrait |
| iPad Pro 13" (App Store, required) | 2064 × 2752 | Portrait, tablet layout |
| Android phone (Play) | 1080 × 1920 | Portrait, 9:16 |
| Android tablet (Play, 10") | 1600 × 2560 | Portrait, tablet layout |

Plus:

| Asset | Pixel size | Content |
|---|---|---|
| Play feature graphic | 1024 × 500 | Landscape. Left third: "Stitch Wish" wordmark + `Relaxing cross stitch art` on a Deep Teal→Sage gradient. Right two-thirds: a half-stitched canvas fading from art into grid cells, thread spools in Rose/Sage/Honey. **No device frames, no screenshots, no store badges.** Keep all text inside the central 80% — Play crops the edges. |

Naming: `{platform}-{device}-{locale}-{NN}-{slug}.png`, e.g. `ios-6.9-en-01-hero.png`, `play-tablet10-tr-03-photo-import.png`.

## 7. LOCALIZATION

Generate the full set in each locale below. Only the caption band and the in-device UI strings change; artwork, colors, and composition stay identical.

Required now:
- `en` (source, strings above)
- `tr` — 1 **Kare kare işle** / *Sakin, zamansız, huzurlu* · 2 **Yüzlerce desen** / *Her hafta yeni tasarımlar* · 3 **Fotoğrafın desen olsun** / *Her resmi desene dönüştür* · 4 **Hayal et, işle** / *Yapay zekâyla kendi tasarımın* · 5 **Gerçek DMC ipleri** / *Orijinal iplik renkleri ve kodları* · 6 **Güzel bir şey bitir** / *Her parça gözünün önünde canlansın* · 7 **Her yerde işle** / *Çevrimdışı çalışır, sonra eşitler* · 8 **İşledikçe kazan** / *Günlük görevler ve ücretsiz ödüller* · 9 **Kendine göre ayarla** / *Premium temalar ve dikiş stilleri* · 10 **Desenini paylaş** / *Tasarımlarını herkesle buluştur*

Recommended next wave (translate the `en` strings, keep them within the character budget): `de`, `es`, `fr`, `pt-BR`, `ja`, `ru`.

Localization rules:
- Headline ≤ 22 characters, subline ≤ 40 characters **in every locale**. If a translation overflows, rewrite it shorter — never shrink the type below 88 px on a 1290-wide canvas and never wrap a headline to three lines.
- German and Russian run ~30% longer: budget for two headline lines.
- Japanese: use a Noto Sans JP Bold headline, no letter-spacing reduction.
- Keep the product nouns untranslated where they are brand terms: "Stitch Wish", "DMC", "Stitch Coin".
- Numerals, coin counts, and dates follow the locale's formatting inside the device UI.

## 8. HARD CONSTRAINTS

- No Apple/Google logos, no "Download on the App Store" badges, no device status-bar carrier names, no fake review stars, no fabricated award badges, no pricing claims.
- No claim the app does something listed nowhere above.
- Every in-device UI element must be consistent with the color and type system in sections 2–3 — this is the real app's design language, not a generic mockup theme.
- Deliver flat PNG, sRGB, no transparency, no rounded canvas corners.

## 9. DELIVERABLE

For each locale: 10 screenshots × 4 device sizes, plus 1 feature graphic (feature graphic per locale as well). Present them as a contact sheet first for review, then the full-resolution exports.
