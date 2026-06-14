import type { FollowUpPriority, FollowUpStatus, Prisma } from "@prisma/client";
import {
  CHEQUE_COLLECTION_FOLLOW_UP,
  FOLLOW_UP_VISIT,
  INVOICE_DELIVERY_FOLLOW_UP,
  ORDER_FOLLOW_UP,
  PAYMENT_FOLLOW_UP,
} from "@/lib/follow-up-types";
import {
  isScheduledFollowUpTaskType,
  normalizeTaskType,
  taskTypeLabels,
  type TaskType,
} from "@/lib/tasks";

type DbClient = Prisma.TransactionClient;
type TaskStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

export class TaskFollowUpSyncError extends Error {
  constructor(
    public code:
      | "CUSTOMER_REQUIRED"
      | "CUSTOMER_ARCHIVED"
      | "ASSIGNEE_INVALID"
      | "REMINDER_TIME_REQUIRED"
      | "IDEMPOTENCY_KEY_REQUIRED"
      | "CROSS_SHOP_ACCESS"
      | "FOLLOW_UP_INVALID"
      | "TASK_FOLLOW_UP_SYNC_FAILED",
    message: string,
  ) {
    super(message);
  }
}

export function followUpTypeForTask(value: string): string | null {
  const taskType = normalizeTaskType(value);
  if (!taskType || !isScheduledFollowUpTaskType(taskType)) return null;
  if (taskType === "PAYMENT_COLLECTION" || taskType === "PAYMENT_FOLLOW_UP") return PAYMENT_FOLLOW_UP;
  if (taskType === "ORDER_FOLLOW_UP") return ORDER_FOLLOW_UP;
  if (taskType === "FOLLOW_UP_VISIT") return FOLLOW_UP_VISIT;
  if (taskType === "CHEQUE_COLLECTION") return CHEQUE_COLLECTION_FOLLOW_UP;
  if (taskType === "INVOICE_HARD_COPY_DELIVERY") return INVOICE_DELIVERY_FOLLOW_UP;
  return null;
}

export function taskStatusToFollowUpStatus(status: TaskStatus): FollowUpStatus {
  if (status === "IN_PROGRESS") return "FOLLOW_UP_REQUIRED";
  if (status === "COMPLETED") return "COMPLETED";
  return "PENDING";
}

function followUpPriority(priority: string): FollowUpPriority {
  return ["LOW", "MEDIUM", "HIGH", "URGENT"].includes(priority)
    ? priority as FollowUpPriority
    : "MEDIUM";
}

function validDate(value: Date) {
  return !Number.isNaN(value.getTime());
}

async function validateCustomerAndAssignee(
  tx: DbClient,
  input: { shopId: string; customerId: string; assignedToId: string },
) {
  const [customer, assignedTo] = await Promise.all([
    tx.customer.findFirst({
      where: { id: input.customerId, shopId: input.shopId },
      select: { id: true, partyName: true, isArchived: true },
    }),
    tx.user.findFirst({
      where: { id: input.assignedToId, shopId: input.shopId, disabledAt: null },
      select: { id: true },
    }),
  ]);
  if (!customer) throw new TaskFollowUpSyncError("CROSS_SHOP_ACCESS", "Customer is not available in this shop.");
  if (customer.isArchived) throw new TaskFollowUpSyncError("CUSTOMER_ARCHIVED", "Archived customers cannot receive new operational tasks.");
  if (!assignedTo) throw new TaskFollowUpSyncError("ASSIGNEE_INVALID", "Select an active staff member from this shop.");
  return customer;
}

export type CreateTaskWithFollowUpInput = {
  shopId: string;
  customerId?: string | null;
  assignedToId: string;
  assignedById: string;
  taskType: TaskType;
  title: string;
  notes?: string | null;
  priority: string;
  dueDate: Date;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  referenceUrl?: string | null;
  idempotencyKey?: string | null;
};

export async function createTaskWithFollowUp(tx: DbClient, input: CreateTaskWithFollowUpInput) {
  if (!validDate(input.dueDate)) {
    throw new TaskFollowUpSyncError("REMINDER_TIME_REQUIRED", "A valid due date and reminder time are required.");
  }
  const eligible = isScheduledFollowUpTaskType(input.taskType);
  if (eligible && !input.customerId) {
    throw new TaskFollowUpSyncError("CUSTOMER_REQUIRED", "Select a customer for this task type.");
  }
  if (eligible && !input.idempotencyKey) {
    throw new TaskFollowUpSyncError("IDEMPOTENCY_KEY_REQUIRED", "A request idempotency key is required.");
  }

  if (input.idempotencyKey) {
    const existing = await tx.task.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { linkedFollowUp: true },
    });
    if (existing) {
      if (existing.shopId !== input.shopId || existing.assignedById !== input.assignedById) {
        throw new TaskFollowUpSyncError("CROSS_SHOP_ACCESS", "Task request belongs to another shop.");
      }
      return { task: existing, followUp: existing.linkedFollowUp, created: false };
    }
  }

  const customer = input.customerId
    ? await validateCustomerAndAssignee(tx, {
        shopId: input.shopId,
        customerId: input.customerId,
        assignedToId: input.assignedToId,
      })
    : null;

  const mappedFollowUpType = followUpTypeForTask(input.taskType);
  let followUp = null;
  if (eligible && customer && mappedFollowUpType) {
    const sourceFollowUp = input.sourceEntityType === "FOLLOW_UP" && input.sourceEntityId
      ? await tx.followUp.findFirst({
          where: {
            id: input.sourceEntityId,
            shopId: input.shopId,
            customerId: customer.id,
            supersededAt: null,
            cancelledAt: null,
          },
        })
      : null;
    if (input.sourceEntityType === "FOLLOW_UP" && input.sourceEntityId && !sourceFollowUp) {
      throw new TaskFollowUpSyncError("FOLLOW_UP_INVALID", "The selected follow-up is no longer active.");
    }

    followUp = sourceFollowUp
      ? await tx.followUp.update({
          where: { id: sourceFollowUp.id },
          data: {
            status: sourceFollowUp.completedAt ? "PENDING" : sourceFollowUp.status,
            completedAt: null,
            assignedToId: input.assignedToId,
            priority: followUpPriority(input.priority),
            nextFollowUpDateTime: input.dueDate,
            nextFollowupDate: input.dueDate,
            scheduledAt: input.dueDate,
            reminderEnabled: true,
            manualReminder: true,
            reminderSentAt: null,
            followUpType: mappedFollowUpType,
            reminderNotes: input.notes || sourceFollowUp.reminderNotes,
          },
        })
      : await tx.followUp.create({
          data: {
            shopId: input.shopId,
            customerId: customer.id,
            status: "PENDING",
            priority: followUpPriority(input.priority),
            notes: input.notes || input.title,
            reminderNotes: input.notes || input.title,
            sourceModule: "ADMIN_MANUAL",
            followUpType: mappedFollowUpType,
            summary: input.title,
            detailedNotes: input.notes || input.title,
            activitySource: "customer-task-sync",
            nextFollowupDate: input.dueDate,
            nextFollowUpDateTime: input.dueDate,
            scheduledAt: input.dueDate,
            reminderEnabled: true,
            manualReminder: true,
            assignedToId: input.assignedToId,
            createdById: input.assignedById,
          },
        });
  }

  const task = await tx.task.create({
    data: {
      shopId: input.shopId,
      customerId: customer?.id,
      assignedToId: input.assignedToId,
      assignedById: input.assignedById,
      taskType: input.taskType,
      title: input.title || taskTypeLabels[input.taskType],
      notes: input.notes || null,
      priority: input.priority,
      dueDate: input.dueDate,
      linkedFollowUpId: followUp?.id,
      idempotencyKey: input.idempotencyKey || null,
      sourceEntityType: input.sourceEntityType || null,
      sourceEntityId: input.sourceEntityId || null,
      referenceUrl: input.referenceUrl || null,
    },
  });

  return { task, followUp, created: true };
}

export async function updateTaskWithFollowUp(
  tx: DbClient,
  input: {
    taskId: string;
    shopId: string;
    assignedToId?: string;
    status?: TaskStatus;
    progressNotes?: string | null;
    dueDate?: Date;
  },
) {
  const existing = await tx.task.findFirst({
    where: { id: input.taskId, shopId: input.shopId },
    include: { linkedFollowUp: true },
  });
  if (!existing) throw new TaskFollowUpSyncError("TASK_FOLLOW_UP_SYNC_FAILED", "Task not found.");
  if (input.dueDate && !validDate(input.dueDate)) {
    throw new TaskFollowUpSyncError("REMINDER_TIME_REQUIRED", "A valid due date and reminder time are required.");
  }

  const completedNow = input.status === "COMPLETED" && existing.status !== "COMPLETED";
  const cancelledNow = input.status === "CANCELLED";
  const dueDate = input.dueDate ?? existing.dueDate;
  const assignedToId = input.assignedToId ?? existing.assignedToId;
  if (existing.customerId) {
    await validateCustomerAndAssignee(tx, {
      shopId: input.shopId,
      customerId: existing.customerId,
      assignedToId,
    });
  }

  const task = await tx.task.update({
    where: { id: existing.id },
    data: {
      ...(input.status ? { status: input.status } : {}),
      ...(input.assignedToId ? { assignedToId } : {}),
      ...(input.progressNotes !== undefined ? { progressNotes: input.progressNotes || null } : {}),
      ...(input.dueDate ? { dueDate } : {}),
      ...(completedNow ? { completedAt: new Date() } : {}),
      ...(input.status && input.status !== "COMPLETED" ? { completedAt: null } : {}),
    },
  });

  if (existing.linkedFollowUp) {
    await tx.followUp.update({
      where: { id: existing.linkedFollowUp.id },
      data: cancelledNow
        ? {
            cancelledAt: existing.linkedFollowUp.cancelledAt ?? new Date(),
            reminderEnabled: false,
            reminderSentAt: null,
          }
        : {
            status: taskStatusToFollowUpStatus((input.status ?? task.status) as TaskStatus),
            assignedToId,
            notes: input.progressNotes === undefined ? existing.linkedFollowUp.notes : input.progressNotes || existing.linkedFollowUp.notes,
            completedAt: completedNow ? task.completedAt : input.status && input.status !== "COMPLETED" ? null : existing.linkedFollowUp.completedAt,
            nextFollowUpDateTime: completedNow ? null : dueDate,
            nextFollowupDate: completedNow ? null : dueDate,
            scheduledAt: completedNow ? null : dueDate,
            reminderEnabled: !completedNow,
            manualReminder: !completedNow,
            reminderSentAt: input.dueDate ? null : existing.linkedFollowUp.reminderSentAt,
            rescheduledAt: input.dueDate ? new Date() : existing.linkedFollowUp.rescheduledAt,
          },
    });
  }

  return { task, completedNow };
}

export async function reconcileTaskFollowUp(tx: DbClient, taskId: string) {
  const task = await tx.task.findUnique({ where: { id: taskId } });
  if (!task || task.linkedFollowUpId || !task.customerId || !isScheduledFollowUpTaskType(task.taskType)) {
    return { linked: false, created: false };
  }
  if (!["PENDING", "IN_PROGRESS"].includes(task.status)) return { linked: false, created: false };
  const result = await createTaskFollowUpForExistingTask(tx, { ...task, customerId: task.customerId });
  return { linked: true, created: true, followUpId: result.id };
}

export async function syncLinkedTaskFromFollowUp(
  tx: DbClient,
  input: {
    previousFollowUpId?: string | null;
    followUpId: string;
    shopId: string;
    status: FollowUpStatus;
    reminderAt?: Date | null;
    notes?: string | null;
  },
) {
  const task = await tx.task.findFirst({
    where: {
      shopId: input.shopId,
      linkedFollowUpId: input.previousFollowUpId ?? input.followUpId,
    },
  });
  if (!task) return null;

  const completed = ["PAID", "COMPLETED", "WRONG_NUMBER"].includes(input.status);
  const nextStatus = completed
    ? "COMPLETED"
    : task.status === "IN_PROGRESS"
      ? "IN_PROGRESS"
      : "PENDING";
  return tx.task.update({
    where: { id: task.id },
    data: {
      linkedFollowUpId: input.followUpId,
      status: nextStatus,
      ...(input.reminderAt && !completed ? { dueDate: input.reminderAt } : {}),
      ...(input.notes ? { progressNotes: input.notes } : {}),
      ...(completed ? { completedAt: task.completedAt ?? new Date() } : { completedAt: null }),
    },
  });
}

export async function cancelLinkedTaskFromFollowUp(tx: DbClient, input: { followUpId: string; shopId: string }) {
  const task = await tx.task.findFirst({
    where: { shopId: input.shopId, linkedFollowUpId: input.followUpId },
  });
  if (!task || task.status === "COMPLETED") return null;
  return tx.task.update({
    where: { id: task.id },
    data: { status: "CANCELLED", completedAt: null },
  });
}

async function createTaskFollowUpForExistingTask(tx: DbClient, task: {
  id: string;
  shopId: string;
  customerId: string;
  assignedToId: string;
  assignedById: string;
  taskType: string;
  title: string;
  notes: string | null;
  priority: string;
  dueDate: Date;
  status: string;
}) {
  const customer = await validateCustomerAndAssignee(tx, task);
  const followUpType = followUpTypeForTask(task.taskType);
  if (!followUpType || !validDate(task.dueDate)) {
    throw new TaskFollowUpSyncError("REMINDER_TIME_REQUIRED", "Task has no valid reminder timestamp.");
  }
  const followUp = await tx.followUp.create({
    data: {
      shopId: task.shopId,
      customerId: customer.id,
      status: taskStatusToFollowUpStatus(task.status as TaskStatus),
      priority: followUpPriority(task.priority),
      notes: task.notes || task.title,
      reminderNotes: task.notes || task.title,
      sourceModule: "ADMIN_MANUAL",
      followUpType,
      summary: task.title,
      activitySource: "customer-task-reconciliation",
      nextFollowupDate: task.dueDate,
      nextFollowUpDateTime: task.dueDate,
      scheduledAt: task.dueDate,
      reminderEnabled: true,
      manualReminder: true,
      assignedToId: task.assignedToId,
      createdById: task.assignedById,
    },
  });
  await tx.task.update({ where: { id: task.id }, data: { linkedFollowUpId: followUp.id } });
  return followUp;
}
