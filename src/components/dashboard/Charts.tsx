"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import type { DashboardStats } from "@/types";
import { formatCurrency } from "@/lib/utils";
import { formatStatus } from "@/lib/status-colors";

const COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6"];

export function DashboardCharts({ stats }: { stats: DashboardStats }) {
  const statusData = stats.statusDistribution.map((s) => ({
    name: formatStatus(s.status as Parameters<typeof formatStatus>[0]),
    value: s.count,
  }));

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-2">
      <div className="card">
        <h3 className="mb-4 font-semibold">Outstanding by Aging</h3>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={stats.outstandingSummary}>
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip formatter={(v: number) => formatCurrency(v)} />
            <Bar dataKey="amount" fill="#2563eb" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="card">
        <h3 className="mb-4 font-semibold">Customer Status Distribution</h3>
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
              {statusData.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Legend />
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>
      {stats.collectionProgress.length > 0 && (
        <div className="card lg:col-span-2">
          <h3 className="mb-4 font-semibold">Monthly Recovery</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={stats.collectionProgress}>
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip formatter={(v: number) => formatCurrency(v)} />
              <Bar dataKey="collected" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="card lg:col-span-2">
        <h3 className="mb-4 font-semibold">Staff Activity Today</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {stats.staffActivity.length === 0 ? (
            <p className="text-sm text-slate-500">No staff activity logged today.</p>
          ) : (
            stats.staffActivity.map((item) => (
              <div key={item.name} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <p className="text-sm font-medium">{item.name}</p>
                <p className="mt-1 text-2xl font-bold">{item.count}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
