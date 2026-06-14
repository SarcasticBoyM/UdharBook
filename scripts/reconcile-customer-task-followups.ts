import { prisma } from "../src/lib/db";
import { isScheduledFollowUpTaskType } from "../src/lib/tasks";
import { reconcileTaskFollowUp } from "../src/lib/task-follow-up-sync";

async function main() {
  const apply = process.argv.includes("--apply");
  const tasks = await prisma.task.findMany({
    where: {
      status: { in: ["PENDING", "IN_PROGRESS"] },
    },
    select: {
      id: true,
      shopId: true,
      customerId: true,
      assignedToId: true,
      linkedFollowUpId: true,
      taskType: true,
      dueDate: true,
      customer: { select: { id: true, shopId: true, isArchived: true } },
      assignedTo: { select: { id: true, shopId: true, disabledAt: true } },
      linkedFollowUp: {
        select: {
          id: true,
          shopId: true,
          customerId: true,
          supersededAt: true,
          cancelledAt: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const summary = {
    mode: apply ? "apply" : "dry-run",
    totalScanned: tasks.length,
    eligible: 0,
    alreadyLinked: 0,
    invalid: 0,
    skipped: 0,
    wouldCreate: 0,
    created: 0,
    errors: 0,
  };

  const invalid = (taskId: string, reason: string) => {
    summary.invalid += 1;
    console.warn(`[invalid] ${taskId}: ${reason}`);
  };

  for (const task of tasks) {
    if (!isScheduledFollowUpTaskType(task.taskType)) {
      summary.skipped += 1;
      continue;
    }
    if (!task.customerId || !task.customer) {
      invalid(task.id, "missing customer");
      continue;
    }
    summary.eligible += 1;

    const hasReliableTime = task.dueDate.getUTCHours() !== 18 || task.dueDate.getUTCMinutes() !== 30;
    if (task.customer.shopId !== task.shopId) {
      invalid(task.id, "customer belongs to another shop");
      continue;
    }
    if (task.customer.isArchived) {
      invalid(task.id, "customer is archived");
      continue;
    }
    if (!task.assignedTo || task.assignedTo.shopId !== task.shopId || task.assignedTo.disabledAt) {
      invalid(task.id, "assignee is missing, disabled, or belongs to another shop");
      continue;
    }
    if (!hasReliableTime) {
      invalid(task.id, "due date has no reliable reminder time");
      continue;
    }

    if (task.linkedFollowUpId) {
      const linked = task.linkedFollowUp;
      if (
        !linked
        || linked.shopId !== task.shopId
        || linked.customerId !== task.customerId
        || linked.supersededAt
        || linked.cancelledAt
      ) {
        invalid(task.id, "linked follow-up is missing, inactive, or belongs to another customer/shop");
        continue;
      }
      summary.alreadyLinked += 1;
      continue;
    }

    summary.wouldCreate += 1;
    if (!apply) continue;
    try {
      const result = await prisma.$transaction((tx) => reconcileTaskFollowUp(tx, task.id));
      if (result.created) summary.created += 1;
      else summary.skipped += 1;
    } catch (error) {
      summary.errors += 1;
      console.error(JSON.stringify({
        event: "customer_task_follow_up_reconciliation_failed",
        taskId: task.id,
        error: error instanceof Error ? error.message : "UNKNOWN",
      }));
    }
  }

  console.log([
    "Customer Task / Follow-up reconciliation",
    `Mode: ${summary.mode}`,
    `Total scanned: ${summary.totalScanned}`,
    `Eligible: ${summary.eligible}`,
    `Already linked: ${summary.alreadyLinked}`,
    `Invalid: ${summary.invalid}`,
    `Skipped: ${summary.skipped}`,
    `Would create: ${summary.wouldCreate}`,
    `Created: ${summary.created}`,
    `Errors: ${summary.errors}`,
  ].join("\n"));
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
