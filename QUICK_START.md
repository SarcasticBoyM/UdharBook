# Quick Start Guide

Get the Payment Follow-up application up and running in minutes.

## 🚀 Local Development (5 minutes)

### Prerequisites
- Node.js 18+ installed
- npm or yarn

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Setup Database
```bash
# Create database and tables
npx prisma db push

# Seed with demo data (optional)
npm run db:seed
```

### Step 3: Start Development Server
```bash
npm run dev
```

### Step 4: Open Application
- **URL**: http://localhost:3000
- **Login Page**: Automatic redirect
- **Admin**: admin@shop.local / admin123
- **Staff**: staff@shop.local / staff123

## 📱 Test Features

### Login & Authentication
1. Go to login page
2. Enter demo credentials
3. Verify session persists on page reload
4. Test logout

### Mobile Responsiveness
1. Open DevTools (F12)
2. Toggle device toolbar (mobile view)
3. Test different screen sizes:
   - iPhone 12 (390px)
   - iPad (768px)
   - Desktop (1024px+)

### Admin Panel
1. Log in as admin@shop.local
2. Click "User Management" in sidebar
3. Create new user
4. Reset password
5. Delete user

### Dashboard
1. View statistics
2. Check responsive layout
3. Test dark mode toggle
4. Verify touch interactions

## 🌐 Deploy to Vercel (10 minutes)

### Step 1: Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR-USERNAME/repo-name.git
git push -u origin main
```

### Step 2: Connect to Vercel
1. Go to https://vercel.com
2. Click "New Project"
3. Import GitHub repository
4. Configure project settings
5. Add environment variables:

```
DATABASE_URL=postgresql://user:password@host:port/db
SESSION_SECRET=<32-character-random-string>
NODE_ENV=production
```

### Step 3: Deploy
1. Click "Deploy"
2. Wait for build to complete
3. Access production URL

### Step 4: Verify Production
1. Access production URL
2. Test login with admin credentials
3. Verify database connection
4. Check all features work

## 📚 Important Files

- **`SETUP.md`** - Detailed setup guide
- **`DEPLOYMENT.md`** - Production deployment
- **`AUTHENTICATION.md`** - Auth system details
- **`REQUIREMENTS_FULFILLMENT.md`** - Requirements checklist

## 🔑 Environment Variables

### Development (`.env.local`)
```
DATABASE_URL="file:./dev.db"
SESSION_SECRET="development-only-min-32-chars-xyz"
HIGH_BALANCE_THRESHOLD="50000"
```

### Production (Vercel)
```
DATABASE_URL="postgresql://user:password@host/db"
SESSION_SECRET="<secure-32-char-string>"
NODE_ENV="production"
```

Generate SESSION_SECRET:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## ⚙️ Available Commands

```bash
# Development
npm run dev          # Start dev server on :3000

# Build & Production
npm run build        # Build for production
npm start            # Start production server

# Code Quality
npm run lint         # Run ESLint
npm run type-check   # Run TypeScript check

# Database
npx prisma db push  # Push schema to database
npx prisma db seed  # Seed database
npx prisma studio   # Open Prisma Studio
```

## 🐛 Common Issues

### Port 3000 Already in Use
```bash
npm run dev -- -p 3001
```

### Database Connection Error
1. Check `DATABASE_URL` in `.env.local`
2. Verify database is running
3. For SQLite: ensure `dev.db` file exists

### Can't Log In
1. Run `npx prisma db seed` to ensure demo users exist
2. Check `.env.local` has `SESSION_SECRET`
3. Clear browser cookies and try again

### Build Fails
1. Ensure `node_modules/` is deleted
2. Run `npm install` again
3. Check for TypeScript errors: `npm run type-check`

## 📖 Next Steps

1. **Customize** - Update demo users and company info
2. **Test** - Verify all features work
3. **Deploy** - Follow DEPLOYMENT.md
4. **Monitor** - Set up error tracking
5. **Backup** - Configure database backups

## 🔒 Security Checklist

Before going to production:

- [ ] Change admin password from `admin123`
- [ ] Generate secure SESSION_SECRET (32+ characters)
- [ ] Use PostgreSQL (not SQLite) in production
- [ ] Enable HTTPS (Vercel does this automatically)
- [ ] Configure database backups
- [ ] Set up error tracking (Sentry)
- [ ] Review all environment variables
- [ ] Test authentication flow
- [ ] Verify role-based access control
- [ ] Delete any demo/test data

## 📊 Verification Checklist

After deployment, verify:

- [ ] Can log in with admin credentials
- [ ] Can log in with staff credentials
- [ ] Can create new users (admin only)
- [ ] Can reset passwords (admin only)
- [ ] Can delete users (admin only)
- [ ] Dashboard displays correctly
- [ ] Mobile menu works
- [ ] All links working
- [ ] No console errors
- [ ] Database connected

## 💡 Tips

1. **Dark Mode**: Click moon icon in top-right
2. **Mobile Menu**: Click hamburger on mobile
3. **Admin Panel**: Available at `/admin/users` (admin only)
4. **Demo Data**: Seeded automatically, safe to delete
5. **API Testing**: Use Postman/Insomnia with JWT auth

## 🆘 Need Help?

Check these files for detailed information:

- **Setup issues**: See SETUP.md
- **Deployment issues**: See DEPLOYMENT.md
- **Authentication issues**: See AUTHENTICATION.md
- **Feature details**: See FEATURES.md
- **All requirements**: See REQUIREMENTS_FULFILLMENT.md

## 📞 Support

For issues:
1. Check troubleshooting section in relevant doc
2. Review application logs in Vercel
3. Check database connection
4. Verify environment variables
5. Review browser console for errors

---

**You're ready to go!** 🎉

Start with `npm install && npm run dev` and open http://localhost:3000