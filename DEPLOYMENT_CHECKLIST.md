# Production Deployment Checklist

Complete checklist for deploying the Payment Follow-up application to production on Vercel.

## Pre-Deployment Verification (Local)

- [ ] All tests pass locally
- [ ] No console warnings or errors
- [ ] `npm run lint` passes without issues
- [ ] `npm run build` succeeds
- [ ] All features working in dev environment
- [ ] Mobile responsiveness verified on device
- [ ] Authentication flows tested
- [ ] Admin user creation tested
- [ ] All API endpoints tested

## GitHub Repository Setup

- [ ] Repository created on GitHub
- [ ] Code committed and pushed
- [ ] `.env.local` added to `.gitignore` ✅ (already in place)
- [ ] No secrets or API keys in code
- [ ] Documentation files in repository

## Vercel Configuration

### Project Creation

- [ ] Vercel account created
- [ ] Project created connected to GitHub repository
- [ ] Build command verified: `prisma generate && next build`
- [ ] Output directory: `.next` (default)
- [ ] Node.js version: 18+ selected

### Environment Variables

In Vercel Dashboard → Project Settings → Environment Variables:

- [ ] `DATABASE_URL` = production database URL
- [ ] `SESSION_SECRET` = 32+ character random string
- [ ] `HIGH_BALANCE_THRESHOLD` = amount (optional, default 50000)
- [ ] `NODE_ENV` = production (auto-set by Vercel, verify)

Generate SESSION_SECRET:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Database Setup

### PostgreSQL (Recommended for Production)

- [ ] PostgreSQL instance created (AWS RDS, Heroku, Supabase, etc.)
- [ ] Database created
- [ ] Database user created with proper permissions
- [ ] Connection string obtained
- [ ] Database URL format verified: `postgresql://user:password@host:port/database`
- [ ] Backups configured in database provider

### Database Migration

- [ ] Schema migrated: `npx prisma db push`
- [ ] Tables created successfully
- [ ] Initial data seeded if needed
- [ ] Admin user created with strong password

## Security Configuration

- [ ] SESSION_SECRET never committed to git
- [ ] Session secret is 32+ characters minimum
- [ ] Database URL never in code
- [ ] No secrets in error messages
- [ ] HTTPS enabled (auto by Vercel) ✅
- [ ] Vercel project access limited to team members

## Password Security

- [ ] Demo user password changed
  - Admin: `admin@shop.local` → change password
  - Staff: `staff@shop.local` → change password
- [ ] Strong passwords used (12+ chars, mixed case, numbers, symbols)

## Testing & Validation

### Authentication Testing

- [ ] Login with admin credentials works
- [ ] Login with staff credentials works
- [ ] Invalid credentials rejected
- [ ] Session persists across page reloads
- [ ] Logout clears session

### Authorization Testing

- [ ] Admin can access `/admin/users`
- [ ] Staff cannot access `/admin/users`
- [ ] Admin can create users via API
- [ ] Staff cannot create users via API
- [ ] API returns 403 for unauthorized access

### User Management Testing

- [ ] Admin can create new users
- [ ] Admin can reset user passwords
- [ ] Admin can delete users
- [ ] Admin cannot delete their own account
- [ ] Users can log in after creation
- [ ] Deleted users cannot log in

### Mobile Testing

- [ ] Mobile responsive on iPhone 12/13/14
- [ ] Mobile responsive on Android devices
- [ ] Tablet view works (iPad)
- [ ] Landscape orientation supported
- [ ] Touch interactions work correctly

### Browser Testing

- [ ] Chrome/Edge (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest)
- [ ] Mobile Safari
- [ ] Chrome Mobile

## Post-Deployment

### Verification

- [ ] Production URL accessible
- [ ] Login page loads
- [ ] Admin can log in with correct credentials
- [ ] Dashboard displays data
- [ ] All pages load without errors
- [ ] Dark mode works
- [ ] Mobile menu works
- [ ] Admin user management accessible

### Monitoring

- [ ] Error tracking configured (Sentry, LogRocket)
- [ ] Database monitoring enabled
- [ ] Application logs accessible
- [ ] Performance metrics tracked
- [ ] Uptime monitoring configured
- [ ] Database backups configured

## Documentation & Handoff

- [ ] QUICK_START.md reviewed
- [ ] SETUP.md verified and accurate
- [ ] DEPLOYMENT.md reviewed
- [ ] AUTHENTICATION.md reviewed
- [ ] Team training completed
- [ ] Support contacts documented

## Rollback Plan

If deployment issues occur:

```bash
# Revert to previous deployment
vercel rollback

# Or manually redeploy from previous commit
git checkout <previous-commit>
git push origin main
```

## Success Criteria

✅ Deployment is successful when:

- [ ] Production app loads without errors
- [ ] All users can log in with correct credentials
- [ ] Admin can create and manage users
- [ ] All features work as expected
- [ ] Mobile responsiveness verified
- [ ] Database is performing well
- [ ] Backups are being created
- [ ] Team is trained on deployment

---

**Deployment checklist version 1.0**
Last updated: June 2, 2026