# Deployment Guide

Deploy the Payment Follow-up application to production on Vercel.

## Prerequisites

- Node.js 18+ installed
- GitHub account with repository access
- Production database URL (PostgreSQL recommended)

## Production Deployment on Vercel

### Step 1: Create Vercel Project

1. Go to https://vercel.com/new
2. Import your GitHub repository
3. Configure project settings

### Step 2: Configure Environment Variables

In Vercel Dashboard → Project Settings → Environment Variables:

**Required Variables:**

| Variable | Value | Notes |
|----------|-------|-------|
| `DATABASE_URL` | PostgreSQL connection string | Use persistent database, not SQLite |
| `SESSION_SECRET` | 32+ character random string | Generate with `openssl rand -base64 32` |
| `HIGH_BALANCE_THRESHOLD` | `50000` | Adjust based on your needs |
| `NODE_ENV` | `production` | Auto-set by Vercel |

### Step 3: Deploy

Push to GitHub - Vercel auto-deploys on push.

```bash
git push origin main
```

### Step 4: Verify Deployment

1. Production app loads
2. Login with admin credentials
3. Create users via admin panel
4. Verify all features work

## Security Checklist

- [x] SESSION_SECRET set to 32+ random characters
- [x] Database connection uses TLS/SSL
- [x] Environment variables not committed to git
- [x] API routes check user authentication
- [x] Admin routes verify ADMIN role
- [x] Passwords hashed with bcrypt
- [x] Input validation on all forms
- [x] CSRF protection via same-site cookies

## Troubleshooting

### Build Failures

**Error: "prisma generate failed"**
```bash
rm -rf node_modules
npm install
```

**Error: "DATABASE_URL not set"**
- Verify environment variable in Vercel Dashboard
- Settings → Environment Variables

### Users Cannot Login
- Verify SESSION_SECRET is correct
- Check browser cookies are not blocked
- Clear browser cache

## Support

For more details, see [DEPLOYMENT_CHECKLIST.md](./DEPLOYMENT_CHECKLIST.md)
