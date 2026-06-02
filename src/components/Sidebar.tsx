"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Upload,
  CalendarClock,
  FileBarChart,
  LogOut,
  Moon,
  Sun,
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
  const navLinks = links.filter((l) => isAdmin || l.href !== "/upload");

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  return (
    <aside className="flex w-64 flex-col border-r border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <div className="border-b border-slate-200 p-5 dark:border-slate-700">
        <h1 className="text-lg font-bold text-brand-700 dark:text-brand-400">Payment Follow-up</h1>
        <p className="mt-1 text-xs text-slate-500">
          {userName} · {role}
        </p>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {navLinks.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
              pathname === href
                ? "bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300"
                : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
            )}
          >
            <Icon className="h-5 w-5" />
            {label}
          </Link>
        ))}
      </nav>
      <div className="space-y-1 border-t border-slate-200 p-3 dark:border-slate-700">
        <button
          type="button"
          onClick={toggle}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </button>
        <button
          type="button"
          onClick={logout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
        >
          <LogOut className="h-5 w-5" />
          Logout
        </button>
      </div>
    </aside>
  );
}
