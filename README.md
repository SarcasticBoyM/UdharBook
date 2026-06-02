# Payment Follow-up & Credit Tracking

Web app for tracking customer outstanding balances, payment follow-ups, and collection activities.

## Features

- Excel upload (.xlsx) with validation and upsert by contact number
- Customer database with follow-up status, notes, and call history
- Dashboard with summary cards, charts, and alerts
- Pending payments list with search, sort, filter, pagination
- Click-to-call (mobile) / copy number (desktop) + WhatsApp with pre-filled message
- Follow-up logging with status history
- Customer detail page with timeline
- Reports: Outstanding, Follow-up, Aging (Excel + CSV)
- Roles: Admin (full access) and Staff (no delete / no import)
- Dark mode, mobile-responsive UI
- Bulk WhatsApp and bulk follow-up scheduling

## Tech Stack

- Next.js 15 (App Router) + TypeScript
- SQLite + Prisma (switch to PostgreSQL by changing `provider` and `DATABASE_URL`)
- Tailwind CSS + Recharts
- Session auth (JWT cookie)

## Prerequisites

- [Node.js](https://nodejs.org/) 18+ (includes npm)
- Optional: Git

## Setup

```powershell
cd C:\Users\Admin\Desktop\app
copy .env.example .env
npm install
npx prisma db push
npm run db:seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### Default logins

| Role  | Email              | Password  |
|-------|--------------------|-----------|
| Admin | admin@shop.local   | admin123  |
| Staff | staff@shop.local   | staff123  |

Change passwords after first login in production.

## Excel import format

| Party Name | Contact Number | Outstanding Balance Amount |
|------------|----------------|------------------------------|
| ABC Traders | 9876543210    | 15000                        |

- Contact: 10-digit Indian mobile or with country code
- Duplicate contact numbers update the existing customer

## PostgreSQL (production)

1. Set `DATABASE_URL` to your Postgres connection string
2. In `prisma/schema.prisma`, change `provider` from `sqlite` to `postgresql`
3. Run `npx prisma migrate dev`

## Deploy (Vercel)

1. Push repo to GitHub
2. Import project on Vercel
3. Add env vars: `DATABASE_URL`, `SESSION_SECRET`, `HIGH_BALANCE_THRESHOLD`
4. Use Vercel Postgres or Neon for database
5. Build command: `npm run build`

## Project structure

```
src/app/          # Pages and API routes
src/components/   # UI components
src/lib/          # DB, auth, excel, phone, whatsapp
prisma/           # Schema and seed
```

## API overview

| Endpoint | Description |
|----------|-------------|
| POST `/api/auth/login` | Login |
| GET `/api/dashboard/stats` | Dashboard metrics |
| GET/POST `/api/customers` | List / create |
| POST `/api/customers/import` | Excel import (admin) |
| POST `/api/follow-ups` | Log call |
| GET `/api/reports/[type]` | Export reports |

## Security / npm audit

Do **not** run `npm audit fix --force` (it can downgrade Next.js and break the app).

After pulling updates, reinstall dependencies:

```cmd
cd C:\Users\Admin\Desktop\app
npm install
npm audit
```

The project removes the vulnerable `xlsx` package and uses ExcelJS for imports. `package.json` `overrides` pin safer `postcss` and `uuid` versions for nested dependencies.

## License

Private / internal use for your business.
