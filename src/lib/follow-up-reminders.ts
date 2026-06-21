import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { ORDER_FOLLOW_UP } from "@/lib/follow-up-types";
import { createNotification } from "@/lib/notifications";

const CLOSED_STATUSES = ["PAID", "COMPLETED", "WRONG_NUMBER"] as const;

export async function processDueScheduledFollowUpReminders(options: {
  recipientUserId?: string;
  shopId?: string;
  limit?: number;
}) {
  const now = new Date();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const due = await prisma.followUp.findMany({
    where: {
      ...(options.shopId ? { shopId: options.shopId } : {}),
      ...(options.recipientUserId
        ? {
            OR: [
              { assignedToId: options.recipientUserId },
              { assignedToId: null, createdById: options.recipientUserId },
            ],
          }
        : {}),
      manualReminder: true,
      reminderEnabled: true,
      reminderSentAt: null,
      supersededAt: null,
      cancelledAt: null,
      completedAt: null,
      status: { notIn: [...CLOSED_STATUSES] },
      nextFollowUpDateTime: { lte: now },
      linkedTask: null,
      NOT: { followUpType: ORDER_FOLLOW_UP },
      customer: { isArchived: false, outstandingBalance: { gt: 0 } },
    },
    select: {
      id: true,
      shopId: true,
      customerId: true,
      assignedToId: true,
      createdById: true,
      nextFollowUpDateTime: true,
      notes: true,
      reminderNotes: true,
      followUpType: true,
      customer: {
        select: {
          partyName: true,
          outstandingBalance: true,
        },
      },
      assignedTo: { select: { id: true, disabledAt: true } },
      createdBy: { select: { id: true, disabledAt: true } },
    },
    orderBy: { nextFollowUpDateTime: "asc" },
    take: limit,
  });

  const reminders = [];
  let queued = 0;
  let failed = 0;

  for (const followUp of due) {
    const reminderAt = followUp.nextFollowUpDateTime;
    if (!reminderAt) continue;
    if (followUp.customer.outstandingBalance <= 0) continue;
    const recipientUserId =
      followUp.assignedTo && !followUp.assignedTo.disabledAt
        ? followUp.assignedTo.id
        : followUp.createdBy && !followUp.createdBy.disabledAt
          ? followUp.createdBy.id
          : null;
    if (!recipientUserId) {
      failed += 1;
      logger.warn("scheduled_follow_up_due_recipient_unavailable", {
        eventType: "FOLLOW_UP_DUE",
        shopId: followUp.shopId,
        entityType: "FOLLOW_UP",
        entityId: followUp.id,
      });
      continue;
    }

    const reminderLabel = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(reminderAt);
    const occurrence = reminderAt.toISOString();
    const result = await createNotification({
      shopId: followUp.shopId,
      target: { type: "USER", userId: recipientUserId },
      type: "FOLLOW_UP_DUE",
      title: "Follow-up Due",
      message: [
        `Customer: ${followUp.customer.partyName}`,
        `Reminder: ${reminderLabel}`,
        followUp.reminderNotes || followUp.notes ? `Note: ${followUp.reminderNotes ?? followUp.notes}` : "",
      ].filter(Boolean).join("\n"),
      entityType: "FOLLOW_UP",
      entityId: followUp.id,
      actionUrl: `/today-follow-ups?followUpId=${encodeURIComponent(followUp.id)}`,
      metadata: {
        customerName: followUp.customer.partyName,
        customerId: followUp.customerId,
        reminderAt: occurrence,
        followUpType: followUp.followUpType,
        notes: followUp.reminderNotes ?? followUp.notes,
      },
      idempotencyKey: [
        followUp.shopId,
        "FOLLOW_UP_DUE",
        followUp.id,
        occurrence,
        recipientUserId,
      ].join(":"),
    });

    const durable = result.success || result.retryQueued;
    if (durable) {
      const marked = await prisma.followUp.updateMany({
        where: {
          id: followUp.id,
          manualReminder: true,
          reminderEnabled: true,
          reminderSentAt: null,
          nextFollowUpDateTime: reminderAt,
          supersededAt: null,
          cancelledAt: null,
        },
        data: { reminderSentAt: now, remindedAt: now },
      });
      if (marked.count) {
        queued += 1;
        reminders.push({
          id: followUp.id,
          customerId: followUp.customerId,
          partyName: followUp.customer.partyName,
          amount: followUp.customer.outstandingBalance,
          scheduledAt: reminderAt,
          callbackNote: followUp.reminderNotes ?? followUp.notes,
          missed: reminderAt < now,
          notificationQueued: result.success,
        });
      }
    } else {
      failed += 1;
    }
  }

  return { checkedAt: now, scanned: due.length, queued, failed, reminders };
}
