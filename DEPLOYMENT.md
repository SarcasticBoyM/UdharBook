# UdharBook Deployment

## Vercel

1. Connect the GitHub repository to Vercel.
2. Set the environment variables from `ENV_SETUP.md`.
   For School Transport maps, set `NEXT_PUBLIC_MAPPLS_MAP_SDK_KEY` to a browser-safe Mappls static Web Maps SDK key. Allow the Vercel/production hostname in the key's Mappls domain whitelist; preview hostnames must also be allowed if maps are required in previews. Redeploy after changing a `NEXT_PUBLIC_` variable.
3. Ensure Supabase allows the Vercel deployment region to connect.
4. Run database migrations before or during deployment:

```bash
npm run prisma:migrate:deploy
```

5. Seed the admin user with a strong password:

```bash
ADMIN_EMAIL="owner@example.com" ADMIN_PASSWORD="long-random-password" npm run prisma:seed
```

6. Deploy:

```bash
npm run build
```

Vercel runs `postinstall`, which generates Prisma Client automatically.

## Notes

- Use the Supabase direct database URL for `DIRECT_URL`.
- Use the Supabase pooled URL for `DATABASE_URL`.
- Keep `SESSION_SECRET` at least 32 random characters in production.
- The app is PWA-ready through `/manifest.webmanifest`, `/icon.svg`, and `/sw.js`.
- If Prisma migration fails locally with a Windows TLS credential error, run migrations from Vercel, Supabase-compatible CI, WSL, or another machine with working PostgreSQL TLS.
