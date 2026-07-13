# Ingest & Lint Log

Bu dosya, bilgi tabanında yapılan tüm veri alım (ingest) ve doğrulama işlemlerinin kaydını tutar.

## [2026-07-12] Appfigures "cross stitch" Keyword Search Ingestion

- **İşlem:** `raw/cross-stitch-keyword-search.md` kaynağındaki 81 sonuçtan listelenen ilk 30 uygulamanın yaklaşık son-ay indirme/gelir sinyallerinin ingest edilmesi.
- **Eklenen/Güncellenen Sayfalar:**
  - [[wiki/summaries/keyword-search-cross-stitch.md]] (Yeni) - Ticari sinyaller, arama gürültüsü ve kanıt sınırları.
  - [[wiki/index.md]] (Güncellendi) - Yeni özet sayfası eklendi.
  - [[wiki/summaries/competitor-games-analysis.md]] ve [[wiki/summaries/reviews-complaints-analysis.md]] (Güncellendi) - Arama verisine çapraz bağlantı ve ticari bağlam eklendi.
  - Doğrudan eşleşen 10 rakip yorum özeti (Güncellendi) - Uygulama bazında Appfigures arama sırası ve yaklaşık metrik bağlamı eklendi.
- **Kanıt Sınırı:** Kaynak yalnızca ilk 30 sonucu içerir; metrikler yaklaşık bantlardır. `Stitch Fix` ve `Pic Stitch` cross-stitch dışı yanlış pozitifler olarak işaretlendi.

## [2026-07-10] Ingestion of Cross-Stitch Games Reviews & Metadata

- **İşlem:** Yorumların Appfigures MCP ile indirilmesi ve rakip oyunların eşleştirilmesi.
- **Eklenen/Güncellenen Sayfalar:**
  - [[wiki/index.md]] (Yeni) - Bilgi tabanı ana giriş sayfası.
  - [[wiki/summaries/competitor-games-analysis.md]] (Yeni) - 30 rakip oyunun Appfigures Unified App ID ve Product ID eşleşme tablosu ve 403 API yetki kısıtlaması açıklamaları.
  - [[wiki/summaries/tracked-apps-reviews.md]] (Yeni) - Takip edilen kendi uygulamalarımız için indirilen kullanıcı yorumları.
- **Açıklama:**
  - `raw/cross-stitch-games-analysis.md` dosyasındaki 30 oyun Appfigures `apps_search` sonuçlarıyla eşleştirildi.
  - Rakip oyunların yorumlarının indirilmesi denendi ancak Appfigures API'sinin harici/rakip oyunların yorumlarına izin vermediği (403 Partner API Access hatası) tespit edildi.
  - Hesap tarafından takip edilen `Cross Stitch AI Pattern Maker` ve `Needlepoint Pattern Maker AI` uygulamalarının yorumları başarıyla indirilip bilgi tabanına eklendi.

## [2026-07-10] Download of Competitor Game Reviews via Public APIs

- **İşlem:** Rakip oyunların App Store ve Google Play yorumlarının indirilmesi ve özetlenmesi.
- **Eklenen/Güncellenen Sayfalar:**
  - [[wiki/summaries/competitor-games-analysis.md]] (Güncellendi) - Rakip oyunlar tablosundaki oyun isimleri, ilgili oyunun yorum özet sayfasına wikilink olarak bağlandı.
  - [[wiki/summaries/reviews-*.md]] (28 Yeni Sayfa) - 28 rakip oyun için en güncel yorumları, örneklenmiş puanları, puan dağılımlarını ve öne çıkan yorumları içeren özet sayfaları oluşturuldu.
  - `raw/reviews/*.md` (28 Yeni Dosya) - Ham yorum verileri (JSON'dan dönüştürülmüş Markdown) kaydedildi.
- **Açıklama:**
  - Appfigures API kısıtlamasını aşmak amacıyla, Appfigures CLI ile elde edilen Apple ID'ler ve Google Play paket isimleri kullanılarak kamuya açık mağaza kaynaklarından veri çekildi.
  - iOS yorumları Apple iTunes Müşteri Yorumları RSS feed'inden, Android yorumları ise `google-play-scraper` kütüphanesiyle çekilerek yerel olarak arşivlendi.

## [2026-07-10] User Complaints Analysis Ingestion

- **İşlem:** İndirilen 1.729 yorumun taranarak olumsuz (1-2 yıldız) yorumlar üzerinden şikayet analizi yapılması.
- **Eklenen/Güncellenen Sayfalar:**
  - [[wiki/index.md]] (Güncellendi) - Şikayet analizi sayfası eklendi.
  - [[wiki/summaries/reviews-complaints-analysis.md]] (Yeni) - Olumsuz yorumların istatistiksel dağılımı, tematik detaylı analizleri ve yeni oyun tasarımı için sunduğu fırsatlar dokümante edildi.
- **Açıklama:**
  - `analyze_complaints.py` scripti kullanılarak 596 olumsuz yorum taranmış ve 5 ana şikayet teması (Reklamlar, Para kazanma, Arayüz güncellemeleri, İlerleme kaybı, Bağlantı/Teknik hatalar) altında kategorize edilmiştir.
  - Sektör lideri rakip uygulamalardaki kritik problemler belirlenmiştir (örn. Cross-Stitch World'ün son güncellemesinde yaşanan toplu ilerleme kayıpları).

