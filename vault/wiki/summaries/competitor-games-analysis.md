---
title: Competitor Cross-Stitch Games Appfigures Mapping
type: summary
source: raw/cross-stitch-games-analysis.md
created: 2026-07-10
updated: 2026-07-12
---

# Competitor Cross-Stitch Games Appfigures Mapping

Bu belgede, `raw/cross-stitch-games-analysis.md` dosyasında yer alan 30 oyun/uygulamanın Appfigures üzerindeki eşleşmeleri (Unified App ID ve Storefront Product ID) ve bu uygulamalara ait yorumların indirilmesi sırasındaki kısıtlamalar detaylandırılmıştır.

## Arama ve Ticari Bağlam

10 Temmuz 2026 tarihli Appfigures `cross stitch` aramasının ilk 30 sonucu, yaklaşık son-ay indirme ve gelir bantlarıyla [[keyword-search-cross-stitch]] sayfasında özetlenmiştir. Bu veri, aşağıdaki kimlik eşleştirmelerini ticari sinyallerle tamamlar; ancak arama sırası keyword ranking olarak yorumlanmamalı ve cross-stitch dışı `Stitch Fix` ile `Pic Stitch` kayıtları rakip analizinden çıkarılmalıdır.

## Appfigures Yorum İndirme Kısıtlaması (API Limitation)

Appfigures API aracılığıyla hesapta **tanımlanmamış veya takip edilmeyen (competitor)** harici uygulamaların yorumlarını toplu olarak (`reviews_list` veya `reviews_breakdown` araçları ile) indirmek istendiğinde aşağıdaki hata alınmaktadır:

> [!WARNING]
> **403 - Forbidden: Partner API Access Required**  
> `This resource requires Partner API Access. Reason: Some given products are not owned by your account.`

Bu hata, mevcut Appfigures API anahtarınızın / planınızın rakip (competitor) analizi ve kamuya açık yorumları toplu çekme yetkisine sahip olmadığını, sadece kendi hesabınıza bağlı (tracked) uygulamaların özel verilerine ve yorumlarına tam erişim sağlayabildiğini göstermektedir.

---

## Oyunların Appfigures Eşleşme Tablosu

Aşağıdaki tablo, `cross-stitch-games-analysis.md` içerisindeki 30 oyunun Appfigures üzerinde yapılan arama sonuçlarıyla otomatik eşleştirilmiş verilerini içermektedir:

| # | Oyun Adı | Geliştirici | Appfigures Eşleşen Ad | Yayıncı | Unified App ID | Storefronts |
|---|----------|-------------|-----------------------|---------|----------------|-------------|
| 1 | [[reviews-cross-stitch-world\|Cross-Stitch World]] | InertiaSoft ltd | Cross-Stitch World | InertiaSoft | `ua_xy3d2o` | iOS, Google Play |
| 2 | [[reviews-cross-stitch-club\|Cross Stitch Club]] | Andrey Baryshnikov | Cross Stitch Club | Andrey Baryshnikov | `ua_uE43Pw` | iOS |
| 3 | Cross-Stitch: Coloring Book | Marcos Roy | Cross-Stitch: Coloring Book | Playcus Limited | `ua_z2iyBG` | iOS, Google Play |
| 4 | [[reviews-stitchly-cross-stitch\|Stitchly: Cross stitch]] | Subtlabs Ltd | Stitchly: Cross stitch | Subtlabs | `ua_EjS1nt` | iOS, Google Play |
| 5 | [[reviews-cross-stitch-masters\|Cross-Stitch Masters]] | TAPCLAP LIMITED | Cross-Stitch Masters | TAPCLAP | `ua_2hllH1` | iOS, Google Play |
| 6 | [[reviews-cross-stitch-saga\|Cross Stitch Saga]] | Irina Kopylova | Cross Stitch Saga | Irina Kopylova | `ua_nM4LUq` | iOS, Google Play |
| 7 | [[reviews-cross-stitch-coloring-art\|Cross Stitch: Coloring Art]] | PLAYCUS LIMITED | Cross Stitch Coloring Art | Playcus Limited | `ua_XnmLip` | iOS, Google Play |
| 8 | [[reviews-cross-stitch-color-by-number\|Cross-Stitch: Color by Number]] | Tho Huynh Ngoc | Cross-Stitch: Color by Number | 炳甲 梁 | `ua_z2soN8` | iOS |
| 9 | [[reviews-cross-stitch-king\|Cross Stitch King]] | MOBIRIX | Cross Stitch King | MOBIRIX | `ua_9UrtDj` | iOS, Google Play |
| 10 | [[reviews-magic-needle-cross-stitch\|Magic Needle: Cross-Stitch]] | Artem Shal | Magic Needle: Cross-Stitch | Artem Shal | `ua_gXx1SE` | iOS, Google Play |
| 11 | [[reviews-cross-stitch-coloring-mandala\|Cross Stitch Coloring Mandala]] | PLAYCUS LIMITED | Cross Stitch Coloring Mandala | Playcus Limited | `ua_VZHOnA` | iOS, Google Play |
| 12 | [[reviews-magic-cross-stitch-pixel-art\|Magic Cross-Stitch: Pixel Art]] | XIMAD, Inc. | Magic Cross-Stitch: Pixel Art | ZiMAD | `ua_4anRZ5` | iOS, Google Play |
| 13 | [[reviews-xstitch-calculator\|XStitch Calculator]] | Lykkegaard Europe Limited | XStitch Calculator | Dziyana Belahryvaya | `ua_q08DVM` | iOS |
| 14 | [[reviews-cross-stitch-creator\|Cross Stitch Creator]] | GORA Studio | Cross Stitch Creator | Adam Evans | `ua_I4zprv` | iOS |
| 15 | [[reviews-silk-cross-stitch-patterns\|Silk: Cross Stitch Patterns]] | CSP Embroidery UG | Silk: Cross Stitch Patterns | CSP Embroidery UG | `ua_Nui3YB` | iOS |
| 16 | [[reviews-stitchpics-stitch-screenshots\|StitchPics - Stitch Screenshots]] | Lykkegaard Europe Limited | StitchPics-Stitch Screenshots | 磊 马 | `ua_p5Ri4p` | iOS |
| 17 | [[reviews-just-crossstitch\|Just CrossStitch]] | Annie's Publishing, LLC | Just CrossStitch | Annie's Publishing, LLC | `ua_RWQPMe` | iOS |
| 18 | [[reviews-cross-stitch-favourites\|Cross Stitch Favourites]] | Our Media Ltd | Cross Stitch Favourites | Our Media Limited | `ua_x208No` | iOS, Google Play |
| 19 | [[reviews-cross-stitch-quest-sewing-pattern-mania\|Cross Stitch Quest - Sewing Mania]] | Arbel Eshed | Cross Stitch Quest | Arbel Eshed | `ua_OtsA4r` | iOS, Google Play |
| 20 | [[reviews-cross-stitch-embroidery-art\|Cross Stitch Embroidery Art]] | GORA Studio | Cross Stitch Embroidery Art | Joydustry, TOO | `ua_M3ulvg` | iOS, Google Play |
| 21 | [[reviews-cross-stitch-color-by-letters\|Cross Stitch: Color by Letters]] | PLAYCUS LIMITED | Cross Stitch: Color by Letters | Playcus Limited | `ua_XM2t33` | iOS, Google Play |
| 22 | [[reviews-cross-stitch-joy\|Cross Stitch Joy]] | GORA Studio | Cross Stitch Joy | Creative APPS | `ua_86aiea` | Google Play |
| 23 | [[reviews-cross-stitch-blitz\|Cross Stitch Blitz]] | Gravity LLC | Cross Stitch Blitz | Logics7 Inc | `ua_86NTh2` | iOS, Google Play |
| 24 | [[reviews-cross-stitch-color-by-letter\|Cross stitch : Color by Letter]] | EYEWIND LIMITED. | Cross stitch : Color by Letter | EYEWIND LIMITED | `ua_GpiHid` | iOS |
| 25 | [[reviews-cross-stitch-calculator\|Cross Stitch Calculator]] | Goatella | Cross Stitch Calculator | Goatella | `ua_k8bPLK` | iOS, Google Play |
| 26 | [[reviews-stitch-fix-personal-styling\|Stitch Fix - Personal Styling*]] | Lykkegaard Europe | Stitch Fix - Personal Styling | Stitch Fix | `ua_I3WCTv` | iOS, Google Play |
| 27 | [[reviews-cross-stitch-pixel-art\|Cross Stitch: Pixel Art]] | 尚辉 曾 | Cross Stitch: Pixel Art | 尚辉 曾 | `ua_EjqHLR` | iOS, Google Play |
| 28 | [[reviews-picture-cross\|Picture Cross]] | AppyNation Ltd. | Picture Cross | AppyNation Ltd. | `ua_xMMX7o` | iOS, Google Play |
| 29 | [[reviews-cross-stitch-color-by-number\|Cross Stitch: Color by Number]] | Tho Huynh Ngoc | Cross-Stitch: Color by Number | 炳甲 梁 | `ua_z2soN8` | iOS |
| 30 | [[reviews-pic-stitch-collage-editor\|Pic Stitch - Collage Editor*]] | Lykkegaard Europe | Pic Stitch - Collage Editor | Maple Media Apps | `ua_3dzujW` | iOS, Google Play |

*\*Not: 26 ve 30 numaralı uygulamalar cross-stitch oyunu değildir, isim eşleşmesinden dolayı gelmiştir.*

---
Bu analizle ilgili diğer detaylar ve kendi takip ettiğimiz uygulamalara ait yorumlar için:
- [[tracked-apps-reviews]] - Kendi takip ettiğimiz kanaviçe uygulamalarının kullanıcı yorumları.
- [[index]] - Knowledge Base Ana Sayfası.
