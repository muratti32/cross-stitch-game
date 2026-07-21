# AdMob Kurulumu — Yapman Gerekenler

Bu dosya, `docs/adr/0033-verify-rewarded-ads-with-admob-server-side-verification.md` kararına göre AdMob'u devreye almak için **senin** (hesap/konsol erişimi gerektiren) yapman gereken adımları listeler.

## Şu ana kadar yapılan

Proje ayarları:

- `app/.env.example` ve `app/.env` içine `EXPO_PUBLIC_ADMOB_*` değişkenleri eklendi.
- Şu an bu değişkenlerde Google'ın resmi **test** ID'leri duruyor (gerçek hesap gerektirmez, local geliştirmede ve development build'lerde reklamlar test modunda çalışır):
  - `EXPO_PUBLIC_ADMOB_ANDROID_APP_ID`
  - `EXPO_PUBLIC_ADMOB_IOS_APP_ID`
  - `EXPO_PUBLIC_ADMOB_ANDROID_REWARDED_AD_UNIT_ID`
  - `EXPO_PUBLIC_ADMOB_IOS_REWARDED_AD_UNIT_ID`

**Client-side kod entegrasyonu tamamlandı** (ADR-0033, sadece Rewarded, non-personalized/no-ATT):

- `react-native-google-mobile-ads` SDK kuruldu (`app/package.json`).
- Native config plugin `app/app.config.ts`'e eklendi — App ID'ler `EXPO_PUBLIC_ADMOB_*_APP_ID`'den build-time'da native projelere gömülür. `android/`+`ios/` gitignored olduğu için her `expo prebuild` / EAS build'de otomatik uygulanır; elle native düzenleme yok.
- `app/src/config/index.ts`: `admob` config + `getRewardedAdUnitId(platform)`.
- `app/src/ads/index.ts`: `initializeAdMob()` (idempotent, web/ID yoksa no-op) + `isAdMobAvailable()`. SDK, root layout'ta arka planda warm-up ediliyor.
- `app/src/hooks/useRewardedAd.ts`: Rewarded Ad load/show/reload state-machine, `requestNonPersonalizedAdsOnly: true`, SSV `customData` (opaque backend player id), `onEarnedReward`. Kapanışta oto-reload.
- Test: `app/src/hooks/__tests__/useRewardedAd.test.tsx` (5 test, native module mock'lu).

**Henüz yapılmadı:**

- **Rewarded Ad'i tetikleyen UI ekranı** — uygulamada henüz coin/reward yüzeyi yok; coin ekranı gelince `useRewardedAd` oraya bağlanacak.
- **Backend SSV callback endpoint'i** — backend'de coin/pool/ledger/reward domaini henüz implemente değil (bkz. adım 5). SSV callback grant edecek altyapı olmadan yazılamaz; önce coin economy backend'de kurulmalı. Client, `/v1/auth/session` → `id` değerini SSV `customData` olarak geçmeye hazır.

## Senin yapman gerekenler

### 1. AdMob hesabı ve uygulama kayıtları
- [admob.google.com](https://admob.google.com) üzerinde bir AdMob hesabı oluştur (yoksa).
- Konsolda **iki ayrı uygulama** ekle — biri iOS biri Android, ikisi de `docs/app-metadata.md`'deki kilitli kimliklerle eşleşmeli:
  - iOS bundle identifier: `com.avk.stitchwish`
  - Android package name: `com.avk.stitchwish`
- Uygulamalar henüz store'da yayında değilse "Uygulamanız App Store/Play Store'da yayında mı?" sorusuna hayır de; app.json'daki App ID doğrulaması sonradan yapılabilir.

### 2. Rewarded ad unit oluştur (sadece Rewarded)
- Her iki uygulama için de **yalnızca Rewarded** formatında bir ad unit oluştur. ADR-0033 gereği banner/interstitial/AI Credit reklamı yok — sadece oyuncunun kendi başlattığı Rewarded Ad.
- Ad unit isimlendirmesi öneri: `stitch_wish_rewarded_ios`, `stitch_wish_rewarded_android`.

### 3. Gerçek ID'leri ortam değişkenlerine yaz
Konsoldan alacağın gerçek App ID ve Ad Unit ID'leri, test ID'lerinin yerine `app/.env` (local) ve deploy pipeline'daki (EAS ortam değişkenleri) karşılıklarına yaz:
- `EXPO_PUBLIC_ADMOB_ANDROID_APP_ID`
- `EXPO_PUBLIC_ADMOB_IOS_APP_ID`
- `EXPO_PUBLIC_ADMOB_ANDROID_REWARDED_AD_UNIT_ID`
- `EXPO_PUBLIC_ADMOB_IOS_REWARDED_AD_UNIT_ID`

Test ID'lerini yalnızca local/development build'lerde bırak; TestFlight/internal track ve production build'lerinden önce gerçek ID'lere geçilmiş olmalı.

### 4. UMP (User Messaging Platform) consent mesajı
- AdMob konsolunda **Privacy & messaging** bölümünden bir consent mesajı (GDPR/EEA-UK) oluştur.
- ADR-0033 ve `docs/app-metadata.md`'deki gizlilik duruşuna göre: ilk sürüm **non-personalized / no-IDFA** reklam dağıtımı kullanıyor, yani App Tracking Transparency (ATT) izni istenmiyor. Consent mesajı ayarlarında kişiselleştirilmemiş reklamlara uygun seçenekleri işaretle.

### 5. Server-Side Verification (SSV) — şimdilik atla
- AdMob konsolunda Rewarded ad unit ayarlarında bir "Ad Reward" callback URL'i girme alanı var. **Bu adımı backend SSV endpoint'i implement edilene kadar boş bırak** — henüz backend'de bu callback'i karşılayan bir uç nokta yok (bkz. ADR-0033: imza doğrulama, idempotent coin grant).
- Backend implementasyonu tamamlandığında callback URL'ini (`https://<backend-domain>/v1/admob/ssv` gibi) ve varsa paylaşılan bir doğrulama parametresini konsola gireceğiz.

### 6. Store gizlilik beyanları
- **Apple App Store**: App Privacy bölümünde AdMob'un topladığı veri kategorilerini (reklam verisi, cihaz tanımlayıcıları vb.) beyan et. Non-personalized ads kullanıldığı için "Data Used to Track You" kısmına dikkat — ADR gereği cross-app tracking yapılmıyor.
- **Google Play**: Data Safety formunda AdMob SDK'sının topladığı veri kategorilerini işaretle.
- Bu beyanlar App Store/Play Console'da manuel doldurulur, kod tarafında yapılacak bir şey yok.

### 7. Kimlikleri kayda geçir
- Gerçek App ID / Ad Unit ID'ler ve ortamlar netleşince, `docs/app-metadata.md`'deki AdMob satırının "Configuration to record" kısmına bu **public** kimlikleri ekleyelim (asla secret/API key değil — App ID ve Ad Unit ID zaten public değerlerdir). Bunu istersen ben doldurabilirim, sen ID'leri paylaş yeter.

## Sıra

1 → 2 → 3 önce (test modundan çıkmak ve gerçek reklam göstermek için şart).
4 (UMP) store submission'dan önce şart.
5 (SSV) backend işi bitene kadar bekleyebilir.
6 store'a gönderim öncesi şart.
7 dokümantasyon — istediğin an yapılabilir.
