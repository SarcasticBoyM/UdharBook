"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarClock,
  CalendarCheck2,
  ClipboardList,
  Landmark,
  FileBarChart,
  Map,
  MapPinned,
  QrCode,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Sun,
  Upload,
  Users,
  WalletCards,
  Store,
  ShieldCheck,
  UserRoundCheck,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "./ThemeProvider";
import { ShopSwitcher } from "./ShopSwitcher";
import { canAccessModule, operationalRoleLabels } from "@/lib/operational-roles";
import type { OperationalRole } from "@prisma/client";

const links = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/today-follow-ups", label: "Today Follow-ups", icon: CalendarCheck2 },
  { href: "/cheques", label: "Cheque Collections", icon: Landmark },
  { href: "/field-staff", label: "Field Staff", icon: UserRoundCheck },
  { href: "/orders", label: "Order Desk", icon: ClipboardList },
  { href: "/live-tracking", label: "Live Tracking", icon: MapPinned, adminOnly: true },
  { href: "/daily-visits", label: "Daily Visits", icon: Map },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/upload", label: "Upload Excel", icon: Upload },
  { href: "/follow-ups", label: "Follow-up Reports", icon: CalendarClock, adminOnly: true },
  { href: "/reports", label: "Reports", icon: FileBarChart, adminOnly: true },
  { href: "/qrvcard", label: "Your QRVCard", icon: QrCode, adminOnly: true },
  { href: "/staff", label: "Staff Management", icon: ShieldCheck, adminOnly: true },
  { href: "/shops", label: "Onboard Shop", icon: Store, superOnly: true },
];

const platformLinks = [
  { href: "/", label: "Platform Dashboard", icon: LayoutDashboard },
  { href: "/shops", label: "Onboard Shop", icon: Store },
  { href: "/staff", label: "Staff Management", icon: ShieldCheck },
];

export function Sidebar({ userName, role, operationalRoles = [] }: { userName: string; role: string; operationalRoles?: OperationalRole[] }) {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const isAdmin = role === "SHOP_ADMIN";
  const isSuperAdmin = role === "SUPER_ADMIN";
  const navLinks = isSuperAdmin ? platformLinks : links.filter((link) => {
    if (link.superOnly) return isSuperAdmin;
    if (link.adminOnly && isAdmin) return true;
    return canAccessModule(role, operationalRoles, link.href);
  });
  const roleLabel = operationalRoles.length > 0
    ? operationalRoles.map((item) => operationalRoleLabels[item]).join(", ")
    : role;

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const closeOnDesktop = () => {
      if (media.matches) setMobileOpen(false);
    };
    closeOnDesktop();
    media.addEventListener("change", closeOnDesktop);
    return () => media.removeEventListener("change", closeOnDesktop);
  }, []);

  const sidebarContent = (mobile = false) => (
    <>
      <div className="border-b border-slate-200 p-4 dark:border-slate-700 md:p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600 text-white">
            <WalletCards className="h-5 w-5" />
          </div>
          <div className={cn(mobile ? "block min-w-0" : "hidden md:block")}>
            <h1 className="text-lg font-bold text-brand-700 dark:text-brand-400">UdharBook</h1>
            <p className="mt-1 truncate text-xs text-slate-500">
              {userName} | {roleLabel}
            </p>
            <ShopSwitcher enabled={false} />
          </div>
          {mobile && (
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
              className="ml-auto inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-200"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {navLinks.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            title={label}
            onClick={() => {
              if (mobile) setMobileOpen(false);
            }}
            className={cn(
              "flex min-h-12 items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition",
              mobile ? "justify-start" : "justify-center md:justify-start",
              pathname === href
                ? "bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300"
                : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
            )}
          >
            <Icon className="h-5 w-5 shrink-0" />
            <span className={cn(mobile ? "inline" : "hidden md:inline")}>{label}</span>
          </Link>
        ))}
      </nav>
      <div className="space-y-1 border-t border-slate-200 p-3 dark:border-slate-700">
        <button
          type="button"
          onClick={toggle}
          title={theme === "dark" ? "Light mode" : "Dark mode"}
          className={cn(
            "flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800",
            mobile ? "justify-start" : "justify-center md:justify-start"
          )}
        >
          {theme === "dark" ? <Sun className="h-5 w-5 shrink-0" /> : <Moon className="h-5 w-5 shrink-0" />}
          <span className={cn(mobile ? "inline" : "hidden md:inline")}>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
        </button>
        <button
          type="button"
          onClick={logout}
          title="Logout"
          className={cn(
            "flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20",
            mobile ? "justify-start" : "justify-center md:justify-start"
          )}
        >
          <LogOut className="h-5 w-5 shrink-0" />
          <span className={cn(mobile ? "inline" : "hidden md:inline")}>Logout</span>
        </button>
      </div>
    </>
  );

  return (
    <>
      <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-slate-200 bg-white/95 px-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 md:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-200"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <WalletCards className="h-5 w-5 text-brand-600" />
          <span className="text-sm font-bold text-brand-700 dark:text-brand-300">UdharBook</span>
        </div>
        <span className="h-10 w-10" aria-hidden="true" />
      </div>

      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-sm md:hidden"
            onClick={() => setMobileOpen(false)}
          />
          <aside
            className="fixed inset-y-0 left-0 z-50 flex w-[min(86vw,20rem)] shrink-0 flex-col border-r border-slate-200 bg-white shadow-2xl transition-transform duration-200 ease-out dark:border-slate-700 dark:bg-slate-900 md:hidden"
            onClick={(event) => event.stopPropagation()}
          >
            {sidebarContent(true)}
          </aside>
        </>
      )}

      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 md:flex">
        {sidebarContent(false)}
      </aside>
    </>
  );
}
