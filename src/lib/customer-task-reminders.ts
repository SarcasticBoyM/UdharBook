import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { notifyCustomerTaskDue } from "@/lib/notifications";
import { taskTypeLabels, normalizeTaskType } from "@/lib/tasks";

const ACTIVE_TASK_STATUSES = ["PENDING", "IN_PROGRESS"];
const CLOSED_FOLLOW_UP_STATUSES = ["PAID", "COMPLETED", "WRONG_NUMBER"] as const;

export async function processDueCustomerTaskReminders(options: {
  recipientUserId?: string;
  shopId?: string;
  limit?: number;
}) {
  const now = new Date();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const tasks = await prisma.task.findMany({
    where: {
      ...(options.shopId ? { shopId: options.shopId } : {}),
      ...(options.recipientUserId ? { assignedToId: options.recipientUserId } : {}),
      status: { in: ACTIVE_TASK_STATUSES },
      dueDate: { lte: now },
      customer: { isArchived: false },
      linkedFollowUp: {
        is: {
          completedAt: null,
          cancelledAt: null,
          supersededAt: null,
          status: { notIn: [...CLOSED_FOLLOW_UP_STATUSES] },
          reminderEnabled: true,
        },
      },
      assignedTo: { disabledAt: null },
    },
    select: {
      id: true,
      shopId: true,
      taskType: true,
      title: true,
      notes: true,
      progressNotes: true,
      dueDate: true,
      assignedToId: true,
      customer: { select: { id: true, partyName: true } },
      linkedFollowUp: { select: { id: true, nextFollowUpDateTime: true } },
    },
    orderBy: { dueDate: "asc" },
    take: limit,
  });

  let queued = 0;
  let failed = 0;
  const reminders = [];
  for (const task of tasks) {
    const followUp = task.linkedFollowUp;
    if (!task.customer || !followUp || !followUp.nextFollowUpDateTime) continue;
    if (followUp.nextFollowUpDateTime.getTime() !== task.dueDate.getTime()) {
      failed += 1;
      logger.warn("customer_task_due_timestamp_mismatch", {
        eventType: "CUSTOMER_TASK_DUE",
        shopId: task.shopId,
        entityType: "TASK",
        entityId: task.id,
      });
      continue;
    }
    const normalizedType = normalizeTaskType(task.taskType);
    const taskTypeLabel = normalizedType ? taskTypeLabels[normalizedType] : task.title;
    const result = await notifyCustomerTaskDue({
      shopId: task.shopId,
      taskId: task.id,
      followUpId: followUp.id,
      recipientUserId: task.assignedToId,
      taskTypeLabel,
      customerName: task.customer.partyName,
      reminderAt: task.dueDate,
      notes: task.progressNotes ?? task.notes,
    });
    if (result.success || result.retryQueued) {
      queued += 1;
      reminders.push({
        id: followUp.id,
        taskId: task.id,
        customerId: task.customer.id,
        partyName: task.customer.partyName,
        amount: 0,
        scheduledAt: task.dueDate,
        callbackNote: task.progressNotes ?? task.notes,
        missed: task.dueDate < now,
        notificationQueued: result.success,
      });
    } else {
      failed += 1;
    }
  }

  return { checkedAt: now, scanned: tasks.length, queued, failed, reminders };
}
