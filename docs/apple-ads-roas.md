# Apple Ads ROAS

## Tanım

Apple Ads geri dönüşü yalnızca Apple Search Ads'e atfedilen RevenueCat net proceeds geliriyle hesaplanır:

```text
ROAS = Apple Ads'e atfedilen net RevenueCat geliri / Apple Ads harcaması
ROAS yüzdesi = ROAS * 100
```

Örnek: `$2,500 / $1,000 = 2.5x = %250`.

Brüt satış yerine App Store komisyonu sonrası net proceeds kullanılmalıdır. RevenueCat ve Apple Ads verileri aynı para birimine çevrilmeden tek raporda birleştirilmemelidir.

## Uygulama tarafı

`app/src/commerce/revenueCat.ts`, RevenueCat yapılandırıldıktan sonra yalnızca iOS'ta aşağıdaki çağrıyı yapar:

```ts
await Purchases.enableAdServicesAttributionTokenCollection();
```

Bu çağrı iOS 14.3 ve üzerindeki AdServices akışını kullanır. Attribution başarısız olursa ticaret akışı kapanmaz; hata loglanır ve sonraki SDK yaşam döngüsünde yeniden denenebilir.

## RevenueCat kurulumu

RevenueCat dashboard'da her environment için:

1. `Integrations → Apple AdServices` bölümünden `Add Apple Search Ads integration` ile bağlantıyı kurun.
2. Apple Ads Advanced kullanılıyorsa RevenueCat'in Apple ile yetkilendirme akışını tamamlayın. En az `Read Only` yetkisi ve ilgili tüm campaign group kapsamı gerekir.
3. Uygulama sürümünü gerçek iOS cihazda veya gerçek dağıtım build'inde doğrulayın. TestFlight/debug attribution değerleri placeholder veya boş olabilir.
4. Yeni kurulum veya yeni campaign için attribution verilerinin oluşması için yedi güne kadar bekleyin.

RevenueCat Charts'ta en az şu kırılımlar kullanılmalıdır:

- `Attribution source = Apple Search Ads`
- Apple Search Ads campaign
- Apple Search Ads ad group
- Apple Search Ads keyword
- Trial, subscription, MRR/ARR, revenue ve cohort/lifetime value ölçümleri

RevenueCat Apple Ads harcamasını sağlamaz; yalnızca attribution ve abonelik/gelir davranışını sağlar.

## Harcama ve raporlama hattı

Günlük veya haftalık rapor şu iki kaynağı birleştirir:

1. Apple Ads Campaign Management API raporları: spend, `campaignId`, `adGroupId`, mümkünse `keywordId`, rapor tarihi.
2. RevenueCat Scheduled Data Export veya doğrulanmış RevenueCat event/webhook akışı: attribution source, `campaignId`, `adGroupId`, `keywordId`, cohort/install tarihi, revenue tarihi ve net proceeds.

Her iki kaynakta aynı attribution granularity kullanılmalıdır. Campaign toplamı ile ad group/keyword detayları aynı rapora birlikte toplanırsa gelir veya harcama iki kez sayılabilir.

Apple Ads Campaign Management API v5 için günlük raporlar UTC ile alınmalıdır. Campaign, ad group ve keyword düzeyleri sırasıyla `/reports/campaigns/{campaignId}`, `/adgroups` ve `/keywords` rapor uçlarıyla alınır; harcama `localSpend` alanından okunur. Apple Ads hesabının yerel para birimi ile RevenueCat rapor para birimi aynı değilse satırlar join edilmeden önce belirlenen FX kaynağıyla USD'ye normalize edilmelidir. API raporları paginated olduğu için `offset`/`limit` ilerlemesi ve aynı tarih aralığının yeniden çekilmesi idempotent olmalıdır.

Eşleştirme anahtarı:

```text
(cohortDate, campaignId, adGroupId?, keywordId?)
```

`backend/src/marketing/apple-ads-roas.ts` bu normalize edilmiş iki veri setini birleştirir. RevenueCat gelirinde cohort gününden itibaren gün 0 dahil olmak üzere 7, 30 veya 90 günlük pencere kullanılır; pencere sınırındaki gün dahil değildir. Harcama olmayan attribution satırlarında ROAS `null` döner ve veri kalitesi alarmı olarak ele alınmalıdır.

Her cohort için raporlanacak alanlar:

```text
cohortDate, cohortWindowDays, campaignId, adGroupId, keywordId,
spendUsd, netRevenueUsd, roas, roasPercent
```

## Operasyonel durum

- [x] iOS RevenueCat SDK'sında AdServices attribution token collection çağrısı.
- [x] 7/30/90 cohort ROAS hesaplama sözleşmesi ve birim testleri.
- [ ] RevenueCat production Apple AdServices bağlantısının dashboard'da yetkilendirilmesi.
- [ ] Apple Ads API read-only credential ve campaign reporting erişiminin secret manager'a eklenmesi.
- [ ] RevenueCat export/webhook alıcısının net proceeds ve attribution ID'lerini kalıcı rapor tablosuna yazması.
- [ ] Günlük reconciliation: eksik ID, currency dönüşümü, duplicate satır, spend/revenue coverage ve 7/30/90 cohort kapanış kontrolleri.

Kaynaklar: [RevenueCat Apple Search Ads](https://www.revenuecat.com/docs/integrations/attribution/apple-search-ads), [Apple Ads API](https://developer.apple.com/documentation/apple_ads/calling-the-apple-search-ads-api).
