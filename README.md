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

Phone push notifications require HTTPS in production (localhost is allowed for development), the three VAPID environment variables from `.env.example`, and the `20260701120000_web_push_subscriptions` migration. Deploy pending production migrations with `npm run prisma:migrate:deploy` (or `npx prisma migrate deploy`) using `DATABASE_URL`; do not use `prisma db push` as the normal production migration path. Generate a key pair with `npx web-push generate-vapid-keys`.

School Van Live Tracking uses the Mappls Web Maps SDK. Configure this browser-safe variable locally and in Vercel:

```env
NEXT_PUBLIC_MAPPLS_MAP_SDK_KEY=your_mappls_web_sdk_key
```

Add `app.qrvcard.in` to the domain whitelist in the Mappls console, then redeploy Vercel after adding or changing the variable. Use a Map SDK/static key/access token, not a client secret. Apply `20260702120000_school_van_live_tracking_mvp` with `prisma migrate deploy`.

If a school user was created before the school-role enum/session fix and was accidentally stored as `ACCOUNT_STAFF`, correct that specific account after deploying the migration:

```sql
UPDATE "User" SET "role" = 'SCHOOL_DRIVER'::"UserRole" WHERE "email" = 'driver@school.example';
```

## Reminder scheduler

`GET` or `POST /api/notifications/due` processes due follow-up, order follow-up, and task reminders. Automated requests require `CRON_SECRET` using either:

```text
Authorization: Bearer <CRON_SECRET>
```

or `https://your-domain.example/api/notifications/due?secret=<CRON_SECRET>`. Prefer the Authorization header where the scheduler supports custom headers, because query strings may appear in provider logs.

Vercel Hobby only supports daily cron execution, so `vercel.json` intentionally contains no frequent schedule. Configure cron-job.org, EasyCron, or a scheduled GitHub Actions workflow to call this endpoint every five minutes. Vercel Pro deployments may instead add a Vercel Cron schedule such as `*/5 * * * *`. Invalid credentials, or automated calls when `CRON_SECRET` is missing, receive `401 Unauthorized`.

## Production Checks

`DATABASE_URL` is required for Prisma Client generation, migrations, and app runtime. `DIRECT_URL` is optional and is not referenced by the Prisma datasource.

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
