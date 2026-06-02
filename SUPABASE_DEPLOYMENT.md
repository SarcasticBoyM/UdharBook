# Supabase PostgreSQL Deployment

## 1. Create Supabase database

1. Create a Supabase project.
2. Open Project Settings > Database.
3. Copy both connection strings:
   - Transaction pooler URL for `DATABASE_URL`
   - Direct connection URL for `DIRECT_URL`

Use the pooler URL for the app because Vercel is serverless. Use the direct URL for Prisma migrations.

## 2. Environment variables

Set these locally and in Vercel:

```text
DATABASE_URL="postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1&sslmode=require"
DIRECT_URL="postgresql://postgres:PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres?sslmode=require"
SESSION_SECRET="use-a-long-random-production-secret"
HIGH_BALANCE_THRESHOLD=50000
```

## 3. Local commands

```powershell
npm install
$env:DATABASE_URL="your-supabase-pooler-url"
$env:DIRECT_URL="your-supabase-direct-url"
npm run prisma:generate
npm run prisma:migrate:deploy
npm run seed
npm run build
```

## 4. Vercel setup

1. Import the GitHub repo in Vercel.
2. Add the environment variables above.
3. Deploy from `main`.

Vercel build command:

```text
npm run build
```

After the first deployment, run the production migration and seed once from your machine:

```powershell
$env:DATABASE_URL="your-supabase-pooler-url"
$env:DIRECT_URL="your-supabase-direct-url"
npm run prisma:migrate:deploy
npm run seed
```

## 5. Default users

```text
Admin: admin@shop.local / admin123
Staff: staff@shop.local / staff123
```

Change these passwords after first production login.

## 6. Production test checklist

- Login works for admin and staff.
- Logout clears the session.
- Dashboard loads.
- Add/edit/delete customer works.
- Follow-up logging works.
- Excel import creates and updates customers.
- Reports export successfully.
- Mobile pages remain usable and tables/long lists scroll correctly.
