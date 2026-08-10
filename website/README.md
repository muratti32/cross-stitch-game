# Stitch Wish — Public Website

Marketing, legal, and store-compliance pages for Stitch Wish: Cross Stitch (ADR-0041).

## Stack

- **Vite + React + TypeScript**
- **React Router v7** — client-side routing
- **Cloudflare Pages** — target deployment (static SPA)

## Pages and URLs

| URL | Purpose |
|---|---|
| `/` | Game landing page (Hero → Features → Screenshots → CTA) |
| `/privacy-policy` | Privacy Policy — required by App Store, Google Play, AdMob |
| `/account-deletion` | Account Deletion form — required by App Store, Google Play, AdMob |
| `/support` | Support page — required store compliance URL |
| `/app-ads.txt` | AdMob authorized seller declaration for Google Play verification |
| Footer link | Subtle "Operator Console →" link → `VITE_ADMIN_CONSOLE_URL` |

## Running locally

```bash
cp .env.example .env      # already done; edit VITE_API_URL when backend is ready
npm install
npm run dev               # http://localhost:5173
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `VITE_API_URL` | No (shows warning banner when empty) | Game Backend API base URL for account deletion |
| `VITE_ADMIN_CONSOLE_URL` | No (defaults to `http://localhost:3001`) | Operator console URL shown in footer |

## Deployment (Cloudflare Pages)

1. Connect the `website/` directory as the Cloudflare Pages project root.
2. Build command: `npm run build`
3. Output directory: `dist`
4. Set `VITE_API_URL` and `VITE_ADMIN_CONSOLE_URL` in the Cloudflare Pages environment variables.
5. The `public/_redirects` file handles SPA routing: `/* /index.html 200`.

The `public/app-ads.txt` file is copied to the site root by the build and must
be reachable at `https://stitchwish.avkdesign.net/app-ads.txt`.

## Wiring up Account Deletion

When the Game Backend implements `POST /v1/account/deletion-request`, set
`VITE_API_URL` in the deployment environment. The form will automatically
become functional and the warning banner will disappear.

## Verification

```bash
npx tsc --noEmit
npm run build
```
