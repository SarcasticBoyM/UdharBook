"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarClock,
  FileBarChart,
  LayoutDashboard,
  LogOut,
  Moon,
  Sun,
  Upload,
  Users,
  WalletCards,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "./ThemeProvider";

const links = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/upload", label: "Upload Excel", icon: Upload },
  { href: "/follow-ups", label: "Follow-ups", icon: CalendarClock },
  { href: "/reports", label: "Reports", icon: FileBarChart },
];

export function Sidebar({ userName, role }: { userName: string; role: string }) {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  const isAdmin = role === "ADMIN";
  const navLinks = links.filter((link) => isAdmin || link.href !== "/upload");

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  return (
    <aside className="flex w-20 shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 md:w-64">
      <div className="border-b border-slate-200 p-3 dark:border-slate-700 md:p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600 text-white">
            <WalletCards className="h-5 w-5" />
          </div>
          <div className="hidden md:block">
            <h1 className="text-lg font-bold text-brand-700 dark:text-brand-400">UdharBook</h1>
            <p className="mt-1 text-xs text-slate-500">
              {userName} | {role}
            </p>
          </div>
        </div>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {navLinks.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            title={label}
            className={cn(
              "flex items-center justify-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition md:justify-start",
              pathname === href
                ? "bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300"
                : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
            )}
          >
            <Icon className="h-5 w-5" />
            <span className="hidden md:inline">{label}</span>
          </Link>
        ))}
      </nav>
      <div className="space-y-1 border-t border-slate-200 p-3 dark:border-slate-700">
        <button
          type="button"
          onClick={toggle}
          title={theme === "dark" ? "Light mode" : "Dark mode"}
          className="flex w-full items-center justify-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800 md:justify-start"
        >
          {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          <span className="hidden md:inline">{theme === "dark" ? "Light mode" : "Dark mode"}</span>
        </button>
        <button
          type="button"
          onClick={logout}
          title="Logout"
          className="flex w-full items-center justify-center gap-3 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 md:justify-start"
        >
          <LogOut className="h-5 w-5" />
          <span className="hidden md:inline">Logout</span>
        </button>
      </div>
    </aside>
  );
}
