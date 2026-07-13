# Cross-Stitch Oyunları Kullanıcı Şikayetleri ve Çıkarımlar Analizi

Bu raporda, `vault/raw/reviews/` dizini altında yer alan 28 rakip kanaviçe (cross-stitch) oyununa ait **1.729 kullanıcı yorumunun** ve **596 olumsuz yorumun (1 ve 2 yıldızlı)** analizi sonucu elde edilen temel çıkarımlar derlenmiştir.

---

## 📊 Şikayet Konularının Dağılımı

Analiz edilen olumsuz yorumların ana temalara göre dağılımı şu şekildedir:

1. **Reklam Sıklığı ve Zen Hissinin Bölünmesi (Ads):** %41.4 (247 Yorum)
2. **Para Kazanma Modeli / Pahalı Şablonlar / Hata Cezalandırmaları (Monetization):** %22.0 (131 Yorum)
3. **Kötü Güncellemeler ve Kontrol/Arayüz Sorunları (UI/UX Changes):** %17.6 (105 Yorum)
4. **İlerleme Kaybı ve Bulut Senkronizasyon Hataları (Progress Loss):** %13.1 (78 Yorum)
5. **Teknik Hatalar / Çökme / İnternet Bağlantı Hataları (Technical Bugs):** %12.9 (77 Yorum)

---

## 🔍 Temel Çıkarımlar ve Detaylı Analiz

### 1. Reklam Politikaları (Sakinlik vs. Agresiflik)
Kullanıcılar bu oyunları stres atmak, sakinleşmek ve bir şeyler boyamak/dikmek için indirmektedir.
* **Kritik Hata:** Dikiş esnasında (tam odaklanmışken) aniden tam ekran pop-up reklam çıkması kullanıcıyı oyundan tamamen soğutmaktadır.
* **Satın Alım İkilemi:** "Reklamsız" (Ad-free) paketi alan kullanıcılara dahi günlük hediyeleri açarken veya ekstra ödüller kazanmak istediklerinde zorla reklam izletilmesi sadık kitlenin güvenini sarsmaktadır.

### 2. Oyun İçi Ekonomi ve Kullanıcı Dostu Oynanış
* **Aşırı Pahalı Şablonlar:** Popüler desenlerin veya geniş şablon paketlerinin çok yüksek fiyatlarla satılması veya çok fazla oyun içi altın gerektirmesi kullanıcıları pes ettirmektedir.
* **Hataların Cezalandırılması:** Bazı oyunlarda dikiş yaparken yanlış renge basıldığında, o karenin kilitlenmesi ve açılması için para istenmesi en büyük tepki çeken özelliklerden biridir.

### 3. Güncelleme ve Arayüz (UI/UX) Sorunları
* **Zoom/Büyütme Kısıtlamaları:** Yapılan son güncellemeler sonrasında şablonların ekrana çok fazla yaklaşması veya uzaklaşamaması özellikle tablet kullanıcıları için oyunu oynanamaz hale getirmiştir.
* **Sol El Desteği:** Renk paletinin veya dikiş araçlarının ekranın sağında sabit durması sol elini kullanan oyuncuları ciddi şekilde zorlamaktadır.

### 4. İlerleme Kaybı Felaketi (Özellikle Cross-Stitch World)
* **Senkronizasyon Kaybı:** Oyunların son güncellemelerinden sonra kullanıcıların yıllarca biriktirdiği dikiş ilerlemeleri, seviyeleri (1000+ seviyeler dahil) ve gerçek parayla satın aldıkları desen paketleri tamamen silinmiştir.
* **Destek Yetersizliği:** Kullanıcıların veri kaybı yaşadıktan sonra destek ekibinden geri dönüş alamaması markaya karşı büyük bir öfke oluşturmuştur.

### 5. Bağlantı Hataları
* Oyunların güçlü bir Wi-Fi veya hücresel ağ olmasına rağmen "İnternet bağlantısı yok" hatası vererek açılmaması teknik olarak en çok bildirilen hatalardan biridir.

---

## 💡 Yeni Bir Cross-Stitch Oyunu İçin Fırsatlar (Product Action Items)

Rakiplerin bu zayıf yönlerini avantaja çevirmek için geliştireceğimiz yeni oyunda şu aksiyonlar alınmalıdır:

| Rakip Hatası (Pain Point) | Bizim Çözümümüz (Action Item) |
|--------------------------|-------------------------------|
| **Zorunlu Reklam Kesintisi** | Dikiş/Boyama ekranında reklam göstermemek. Reklamları sadece isteğe bağlı ödül (Rewarded) butonlarında tutmak. |
| **Pahalı Hata Düzeltme** | Kullanıcı dostu oynanış sunmak; dikiş hatalarını geri alma (Undo) özelliğini tamamen ücretsiz yapmak. |
| **Kayıp İlerleme Riski** | Google, Apple ve Email ile çoklu bulut yedeklemesi sunmak ve yerel verileri korumak. |
| **Solaklar İçin Zorluk** | Arayüz ayarlarına sol el modu (left-handed mode) eklemek. |
| **Pahalı ve Sınırlı Şablonlar** | AI Pattern Maker özelliğimiz sayesinde kullanıcıların kendi fotoğraflarını ücretsiz olarak kanaviçe desenine dönüştürebilmesini sağlamak. |
