# Sentry Kurulumu — Yapman Gerekenler

Bu oturumda `avk-corp/stitch-wish` Sentry projesi oluşturuldu ve istemci
(`app/`) tarafı koda bağlandı (bkz. `docs/app-metadata.md` ve ADR-0035).
Kodla yapılamayan, senin Sentry ve EAS panellerinden elle yapman gereken
adımlar aşağıda.

## 1. Source map upload için `SENTRY_AUTH_TOKEN` secret'ı ekle

Native build sırasında (EAS build, Android/iOS) source map yüklemesi
`SENTRY_AUTH_TOKEN` ortam değişkenini otomatik olarak arıyor
(`@sentry/react-native/expo` plugin'i bunu `app.json`'a gömmüyor, kasıtlı).

- Sentry'de: **Settings → Developer Settings → Auth Tokens** üzerinden
  `org:read` + `project:releases` (release ve source map yükleme) scope'larına
  sahip bir **User Auth Token** oluştur.
- EAS'ta: `eas secret:create --scope project --name SENTRY_AUTH_TOKEN --value <token> --type string`
  ya da Expo dashboard → Project → Environment variables → **Secret** olarak ekle.
  development, preview, production build profillerinin hepsinde erişilebilir olmalı.

## 2. `EXPO_PUBLIC_SENTRY_DSN` ve `EXPO_PUBLIC_SENTRY_ENVIRONMENT`'ı EAS ortamlarına ekle

DSN gizli değil (public client key) ama diğer public config değerleri gibi
(Firebase, Google client id) EAS Environment Variables panelinden
yönetiliyor — `eas.json` içine gömülmüyor (development profili hariç, orada
zaten `EXPO_PUBLIC_SENTRY_ENVIRONMENT=development` satır içi eklendi).

Expo dashboard → Project → Environment variables altında **development**,
**preview**, **production** ortamlarının her birine ekle:

```
EXPO_PUBLIC_SENTRY_DSN=https://db510f486cefb9acc100dcf093b38029@o4507810077212672.ingest.de.sentry.io/4511767430168656
EXPO_PUBLIC_SENTRY_ENVIRONMENT=preview      # preview ortamı için
EXPO_PUBLIC_SENTRY_ENVIRONMENT=production   # production ortamı için
```

(development ortamı için DSN'i de eklemen yeterli, environment zaten
`eas.json`'da satır içi tanımlı.)

Yerel `expo start` ile çalıştırırken `app/.env` dosyasındaki değerler
kullanılıyor — onlar zaten eklendi, ekstra bir şey yapmana gerek yok.

## 3. Sentry projesinde alert owner ata

`avk-corp/stitch-wish` projesinde henüz kimse crash/performans
alarmlarına atanmadı. Sentry → Project Settings → Alerts altında en az bir
issue alert kuralı oluştur ve sorumlu kişiyi/ekibi ata (ADR-0035 ve
`docs/app-metadata.md` bunu gerektiriyor).

## 4. Native projeyi yeniden derle / prebuild al

`app.json`'a eklenen `@sentry/react-native/expo` config plugin'i native
Android/iOS proje dosyalarını değiştiriyor. Eğer elle düzenlenmiş bir
`android/` veya `ios/` klasörün varsa `npx expo prebuild --clean` çalıştır;
yoksa bir sonraki `eas build` veya `expo run:ios`/`expo run:android`
sırasında otomatik uygulanır.

## 5. Kurulumu doğrula

Bir development build'de kasıtlı bir hata fırlatıp (örn. geçici bir
`throw new Error('sentry test')`) Sentry dashboard'unda event olarak
göründüğünü doğrula, sonra test kodunu geri al. Ayrıca:

- Event'lerde `email`, `prompt`, `pattern`, `artwork`, `photo`, token gibi
  alanların gerçekten `[Scrubbed]` göründüğünü kontrol et
  (`app/src/observability/sentry.ts` içindeki `beforeSend`/`beforeBreadcrumb`).
- `event.user.id`'nin opak guest/account id olduğunu, e-posta olmadığını
  doğrula.

## 6. Kapsam dışı bırakılan, ileride yapılacak iş

ADR-0031'deki stitch/undo latency yüzdelikleri ve gesture frame pacing gibi
özel performans span'leri bu kurulumda eklenmedi — Sentry tracing açık
(`tracesSampleRate`), ama bu metrikleri ölçen custom span'lerin ilgili
gesture/renderer koduna eklenmesi ayrı bir geliştirme görevi.
