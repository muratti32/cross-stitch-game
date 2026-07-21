# Serve the public-facing website as a separate Vite + React SPA

The game needs a public website to satisfy AdMob, App Store, and Google Play requirements (Privacy Policy, Account Deletion, Support URL, marketing URL) and to serve as the game's landing page. We chose a separate Vite + React SPA in `website/` rather than adding routes to the Next.js operator console (`admin-console/`).

## Considered Options

**A. Add public routes to the existing `admin-console/` Next.js app** — rejected because the operator console is an MFA-protected internal tool; mixing public and protected surfaces in one deployment complicates security posture, Content-Security-Policy, and cookie scope. A future reader would rightly question why a public privacy policy and a protected admin dashboard share the same origin.

**B. Separate Next.js app** — rejected in favour of Vite because the public site has no server-rendering or API-proxy requirements. Next.js adds build complexity and a Node.js runtime dependency for a site that is entirely stateless HTML, CSS, and client-side fetch.

**C. Vite + React SPA (chosen)** — statically exported, deployable to Cloudflare Pages with a single `_redirects` rule. The Account Deletion page makes a direct client-side fetch to the Game Backend API (`VITE_API_URL`); no server runtime is needed. React Router v7 handles client-side routing.

## Consequences

- URL structure (`/privacy-policy`, `/account-deletion`, `/support`) is committed once submitted to stores and must not change without setting up redirects.
- `VITE_API_URL` and `VITE_ADMIN_CONSOLE_URL` must be set at build time for the Cloudflare Pages deployment.
- The Account Deletion endpoint on the Game Backend must be implemented before the account-deletion form is enabled in production.
