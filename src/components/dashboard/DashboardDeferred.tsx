"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { DashboardStats } from "@/types";
import { formatCurrency, formatDate } from "@/lib/utils";
import { StatCards } from "@/components/dashboard/StatCards";

const DashboardCharts = dynamic(
  () => import("@/components/dashboard/Charts").then((module) => module.DashboardCharts),
  { loading: () => <DashboardSectionSkeleton className="h-[340px]" /> },
);

type DeferredDashboardData = {
  stats: DashboardStats;
  highBalanceCustomers: { id: string; partyName: string; outstandingBalance: number }[];
  recentActivity: { id: string; action: string; createdAt: string; customer: { id: string; partyName: string } | null }[];
};

export function DashboardDeferred({ initialStats }: { initialStats: DashboardStats }) {
  const [data, setData] = useState<DeferredDashboardData | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch("/api/dashboard/stats?scope=secondary", { signal: controller.signal });
        if (!response.ok) return;
        setData(await response.json() as DeferredDashboardData);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.error("dashboard_secondary_load_failed", error);
        }
      }
    };
    const timerId = globalThis.setTimeout(() => void load(), 250);
    return () => {
      controller.abort();
      globalThis.clearTimeout(timerId);
    };
  }, []);

  const stats = data?.stats ?? initialStats;
  return (
    <>
      <div className="mt-6">
        <StatCards stats={stats} secondaryLoading={!data} />
      </div>

      {data ? <DashboardCharts stats={data.stats} /> : <DashboardSectionSkeleton className="mt-6 h-[560px]" />}

      {data ? (
        <>
          {data.highBalanceCustomers.length > 0 && (
            <div className="card mt-6">
              <h3 className="font-semibold">High Risk Outstanding Customers</h3>
              <ul className="mt-3 space-y-2">
                {data.highBalanceCustomers.map((customer) => (
                  <li key={customer.id} className="flex justify-between text-sm">
                    <Link href={`/customers/${customer.id}`} className="text-brand-600 hover:underline">{customer.partyName}</Link>
                    <span className="font-medium">{formatCurrency(customer.outstandingBalance)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="card mt-6">
            <h3 className="font-semibold">Recent Activity</h3>
            <ul className="mt-3 space-y-3 text-sm">
              {data.recentActivity.length === 0 ? <li className="text-slate-500">No activity yet</li> : data.recentActivity.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2 last:border-0 dark:border-slate-800">
                  <span><span className="font-medium">{item.action.replace(/_/g, " ")}</span>{item.customer && <>{" for "}<Link href={`/customers/${item.customer.id}`} className="text-brand-600 hover:underline">{item.customer.partyName}</Link></>}</span>
                  <span className="text-xs text-slate-500">{formatDate(item.createdAt)}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : <DashboardSectionSkeleton className="mt-6 h-52" />}
    </>
  );
}

function DashboardSectionSkeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-lg border border-slate-200 bg-slate-100/70 dark:border-slate-800 dark:bg-slate-900 ${className}`} />;
}
