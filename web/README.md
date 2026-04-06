# IAASE Dashboard (web)

Next.js (App Router) dashboard for Marketplace listings:
- `/` public list (no URL/description)
- `/item/[listing_id]` gated details + “Open on Facebook”
- `/login` shared-password login
- `/logout` clears session

## Deal scoring

If `deal_metrics` is present in the DB, the public list will show:
- Deal score (A/B/C only)
- % below market (vs comps median)
- Confidence
- Estimated profit (simple conservative estimate)

## Local dev

```bash
cd web
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

## Vercel

- Set Vercel Project Root to `web/`
- Add env vars (server-only):
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `WEB_AUTH_PASSWORD`
  - `WEB_AUTH_SECRET`
  - `WEB_AUTH_COOKIE_NAME` (optional)

## Security

- Never expose `SUPABASE_SERVICE_ROLE_KEY` in the browser (don’t use `NEXT_PUBLIC_*`).
- The shared-password cookie is `httpOnly` and signed (HS256 via `jose`).
