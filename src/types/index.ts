import type { CustomerStatus, FollowUpPriority, FollowUpStatus, UserRole } from "@prisma/client";

export type { CustomerStatus, FollowUpPriority, FollowUpStatus, UserRole };

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  shopId: string | null;
  shopName?: string | null;
}

export interface ImportSummary {
  /** Rows that had at least a name or contact value */
  totalProcessed: number;
  created: number;
  updated: number;
  /** Invalid or duplicate-in-file rows */
  skipped: number;
  errors: { row: number; message: string }[];
}

export interface DashboardStats {
  totalCustomers: number;
  totalOutstanding: number;
  pendingFollowup: number;
  todayFollowups: number;
  overdueFollowups: number;
  highOutstanding: number;
  recoveryAmount: number;
  staffActivity: { name: string; count: number }[];
  statusDistribution: { status: string; count: number }[];
  collectionProgress: { month: string; collected: number }[];
  outstandingSummary: { label: string; amount: number }[];
}
