# Docker Cheat Sheet

Bu proje `docker-compose.yml` ile 7 servis çalıştırıyor: `postgres`, `redis`, `conversion-engine`, `migrate` (bir kerelik, migration çalışıp çıkar), `api`, `worker`, `admin-console`.

| Servis | Port | Not |
|---|---|---|
| api | 3000 | NestJS backend |
| admin-console | 3001 | Operator console (Next.js) |
| conversion-engine | 8000 | Python servisi |
| postgres | 5432 | |
| redis | 6379 | |

Named volume'lar (container silinse de kalıcı): `postgres-data`, `redis-data`, `backend-node-modules`, `admin-console-node-modules`.

## Başka projeye geçerken (bu projeyi kapatmak)

```bash
docker compose down
```

Container'ları durdurur ve siler. Named volume'lar **silinmez** — Postgres verisi, `node_modules` cache'i kalır. Portlar (3000/3001/5432/6379/8000) boşalır, başka projenin container'ları çakışmadan ayağa kalkabilir.

Geri dönünce:

```bash
docker compose up -d
```

Volume'lar durduğu yerden devam eder, `npm ci` tekrar gerekmez.

## Sadece kısa süreliğine ara vermek (aynı gün içinde)

```bash
docker compose stop
```

`down`'dan farkı: container'lar silinmez, sadece durur. `docker compose start` ile daha hızlı geri döner. Ama portları/kaynağı serbest bırakmaz — başka bir proje aynı portu kullanacaksa bu işine yaramaz, `down` gerekir.

## Tam sıfırlama (Postgres/Redis verisini de sil)

```bash
docker compose down -v
```

⚠️ Named volume'ları da siler — Postgres'teki tüm veri (patterns, sessions, accounts) ve `node_modules` cache'i gider. Sadece "temiz baştan kurulum" istediğinde kullan. Sıradan proje değiştirme senaryosunda **kullanma**.

## Durum kontrolü

```bash
docker compose ps        # hangi servisler ayakta
docker compose logs -f api worker   # canlı log
```

## package.json değişince (yeni npm paketi eklendi)

`node_modules` named volume'da olduğu için host'ta `npm install` yapman container'a yansımaz:

```bash
docker compose exec api npm ci
docker compose restart api worker
```

`docker-compose.yml` dosyasının kendisi değiştiyse (yeni servis/port/volume) `down/up` şart değil, `docker compose up -d` farkı algılayıp günceller.
