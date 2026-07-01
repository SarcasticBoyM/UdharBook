# UdharBook

UdharBook is a production-ready credit follow-up SaaS for small businesses and finance teams. It tracks customer balances, reminders, payments, notes, WhatsApp follow-ups, Excel imports, and recovery reporting.

## Features

- Admin/staff authentication with hashed passwords and protected sessions
- Customer balance tracking with Active, Pending, High Risk, and Cleared statuses
- Dashboard totals, overdue alerts, today reminders, monthly recovery graph, and recent activity
- Customer search, filters, pagination, payment entries, notes, and history timelines
- WhatsApp reminder buttons with auto-generated payment messages
- Reminder scheduling, follow-up priorities, browser notifications, and overdue views
- Excel import validation, duplicate prevention, downloadable error reports, and Excel exports
- PWA manifest, installable app branding, app icon, splash metadata, and offline app-shell caching
- Prisma schema indexes, API validation, rate limiting, security headers, logging, and environment validation
- Dark mode and mobile-responsive finance-style UI

## Quick Start

```bash
npm install
npm run prisma:generate
npm run dev
```

Open `http://localhost:3000`.

Phone push notifications require HTTPS in production (localhost is allowed for development), the three VAPID environment variables from `.env.example`, and the push-subscription migration. Generate a key pair with `npx web-push generate-vapid-keys`. The scheduled due-reminder endpoint is protected by `CRON_SECRET` and configured in `vercel.json` to run every five minutes.

## Production Checks

```bash
npm run lint
npm run build
npm run prisma:migrate:deploy
ADMIN_PASSWORD="use-a-strong-password" npm run prisma:seed
```

For hosted Supabase databases, the seed requires `ADMIN_PASSWORD` and will not create default credentials.

## Default Local Login

Local-only seed fallback:

| Role | Email | Password |
| --- | --- | --- |
| Admin | admin@udharbook.local | admin12345 |

For production, set `ADMIN_EMAIL` and `ADMIN_PASSWORD` before running the seed.
