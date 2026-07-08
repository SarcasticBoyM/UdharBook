import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireShopId } from "@/lib/tenant";
import { canAccessTasks, canAssignTasks, normalizeFixedRole } from "@/lib/operational-roles";
import { notifyTaskAssigned, notifyTaskCompleted, notifyTaskReassigned } from "@/lib/notifications";
import {
  isScheduledFollowUpTaskType,
  taskPriorities,
  taskReferenceUrl,
  taskStatuses,
  taskTypeLabels,
  taskTypes,
} from "@/lib/tasks";
import { createTaskWithFollowUp, TaskFollowUpSyncError, updateTaskWithFollowUp } from "@/lib/task-follow-up-sync";

const createSchema = z.object({
  shopId: z.string().optional(),
  assignedToId: z.string().min(1),
  customerId: z.string().min(1).optional().nullable(),
  taskType: z.enum(taskTypes),
  title: z.string().trim().min(1).max(160),
  notes: z.string().trim().max(2000).optional().nullable(),
  priority: z.enum(taskPriorities).default("MEDIUM"),
  dueDate: z.string().datetime(),
  sourceEntityType: z.string().trim().max(60).optional().nullable(),
  sourceEntityId: z.string().trim().max(120).optional().nullable(),
  referenceUrl: z.string().trim().max(500).refine((value) => value.startsWith("/"), "Reference URL must be app-local.").optional().nullable(),
  idempotencyKey: z.string().trim().min(8).max(160).optional().nullable(),
});
const idempotencyKeySchema = z.string().trim().min(8).max(160);

const patchSchema = z.object({
  id: z.string().min(1),
  assignedToId: z.string().min(1).optional(),
  status: z.enum(taskStatuses).optional(),
  progressNotes: z.string().trim().max(2000).optional().nullable(),
  dueDate: z.string().datetime().optional(),
});

const taskSelect = {
  id: true,
  title: true,
  notes: true,
  progressNotes: true,
  taskType: true,
  priority: true,
  status: true,
  dueDate: true,
  createdAt: true,
  referenceUrl: true,
  assignedToId: true,
  assignedById: true,
  linkedFollowUpId: true,
  customer: { select: { id: true, partyName: true, outstandingBalance: true, contactNumber: true } },
  assignedTo: { select: { id: true, name: true, role: true } },
  assignedBy: { select: { id: true, name: true, role: true } },
  linkedFollowUp: { select: { id: true, followUpType: true, status: true, nextFollowUpDateTime: true, cancelledAt: true } },
} satisfies Prisma.TaskSelect;

function isAssignableRole(role: string) {
  const normalized = normalizeFixedRole(role);
  return ["SALES_PERSON", "ACCOUNT_STAFF", "SALES_PERSON_CUM_ACCOUNTS"].includes(String(normalized));
}

function shopIdForCreate(request: Request, session: Awaited<ReturnType<typeof getSession>>, requested?: string) {
  if (!session) throw new Error("UNAUTHORIZED");
  if (session.role === "SUPER_ADMIN" && requested) return requested;
  return requireShopId(request, session);
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canAccessTasks(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const shopId = requireShopId(request, session);
  const { searchParams } = new URL(request.url);
  const view = searchParams.get("view");
  const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? 100)));

  if (view === "staff") {
    if (!canAssignTasks(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const users = await prisma.user.findMany({
      where: {
        shopId,
        disabledAt: null,
      },
      select: { id: true, name: true, role: true, jobTitle: true },
      orderBy: { name: "asc" },
    });
    const staff = users.filter((user) => isAssignableRole(user.role));
    return NextResponse.json({ success: true, staff });
  }

  const status = searchParams.get("status");
  const ownershipWhere: Prisma.TaskWhereInput = {
    shopId,
    ...(!canAssignTasks(session.role)
      ? { assignedToId: session.id }
      : view === "assigned-by-me"
        ? { assignedById: session.id }
        : {}),
  };
  const where: Prisma.TaskWhereInput = {
    ...ownershipWhere,
    ...(status && taskStatuses.includes(status as (typeof taskStatuses)[number]) ? { status } : {}),
  };
  const [tasks, pending, inProgress, completed, cancelled] = await prisma.$transaction([
    prisma.task.findMany({
      where,
      select: taskSelect,
      orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
      take: limit,
    }),
    prisma.task.count({ where: { ...ownershipWhere, status: "PENDING" } }),
    prisma.task.count({ where: { ...ownershipWhere, status: "IN_PROGRESS" } }),
    prisma.task.count({ where: { ...ownershipWhere, status: "COMPLETED" } }),
    prisma.task.count({ where: { ...ownershipWhere, status: "CANCELLED" } }),
  ]);
  return NextResponse.json({
    success: true,
    tasks,
    counts: {
      pending,
      inProgress,
      completed,
      cancelled,
    },
    view: canAssignTasks(session.role) ? (view === "assigned-by-me" ? "ASSIGNED_BY_ME" : "ALL") : "MINE",
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canAssignTasks(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = createSchema.parse(await request.json());
    const shopId = shopIdForCreate(request, session, body.shopId);
    const bodyKey = body.idempotencyKey?.trim() || null;
    const headerKey = request.headers.get("Idempotency-Key")?.trim() || null;
    if (bodyKey && headerKey && bodyKey !== headerKey) {
      return NextResponse.json({
        success: false,
        code: "IDEMPOTENCY_KEY_CONFLICT",
        error: "Request idempotency keys do not match.",
      }, { status: 400 });
    }
    const idempotencyKey = bodyKey || headerKey;
    if (idempotencyKey) idempotencyKeySchema.parse(idempotencyKey);
    if (isScheduledFollowUpTaskType(body.taskType) && body.customerId && !idempotencyKey) {
      return NextResponse.json({
        success: false,
        code: "IDEMPOTENCY_KEY_REQUIRED",
        error: "A request idempotency key is required.",
      }, { status: 400 });
    }

    const dueDate = new Date(body.dueDate);
    const assignedTo = await prisma.user.findFirst({
      where: { id: body.assignedToId, shopId, disabledAt: null },
      select: { id: true, name: true, role: true },
    });
    if (!assignedTo || !isAssignableRole(assignedTo.role)) {
      return NextResponse.json({ error: "Select an active operational staff member from this shop." }, { status: 400 });
    }

    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
        const synced = await createTaskWithFollowUp(tx, {
          shopId,
          customerId: body.customerId,
          assignedToId: assignedTo.id,
          assignedById: session.id,
          taskType: body.taskType,
          title: body.title,
          notes: body.notes || null,
          priority: body.priority,
          dueDate,
          sourceEntityType: body.sourceEntityType || null,
          sourceEntityId: body.sourceEntityId || null,
          referenceUrl: body.referenceUrl || taskReferenceUrl({
            customerId: body.customerId,
            sourceEntityType: body.sourceEntityType,
            sourceEntityId: body.sourceEntityId,
          }),
          idempotencyKey,
        });
        const task = await tx.task.findUniqueOrThrow({ where: { id: synced.task.id }, select: taskSelect });
        return { task, followUp: synced.followUp, created: synced.created };
      });
    } catch (error) {
      if (idempotencyKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await prisma.task.findFirst({
          where: {
            shopId,
            assignedById: session.id,
            idempotencyKey,
          },
          select: taskSelect,
        });
        if (existing) {
          result = { task: existing, followUp: existing.linkedFollowUp, created: false };
        } else {
          return NextResponse.json({
            success: false,
            code: "IDEMPOTENCY_CONFLICT",
            error: "The task request conflicted with another operation.",
          }, { status: 409 });
        }
      } else {
        throw error;
      }
    }

    const notification = result.created
      ? await notifyTaskAssigned({
          shopId,
          taskId: result.task.id,
          assignedToId: assignedTo.id,
          assignedById: session.id,
          taskTypeLabel: taskTypeLabels[body.taskType],
          customerName: result.task.customer?.partyName,
          dueDate,
          assignedByName: session.name,
        })
      : undefined;
    return NextResponse.json({
      success: true,
      task: result.task,
      data: result.task,
      followUpSync: {
        linked: Boolean(result.task.linkedFollowUpId),
        followUpId: result.task.linkedFollowUpId,
        created: Boolean(result.followUp && result.created && body.sourceEntityType !== "FOLLOW_UP"),
      },
      idempotentReplay: !result.created,
      ...(notification ? { notification } : {}),
    }, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({
        error: "Invalid task details.",
        details: error.issues.map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`),
      }, { status: 400 });
    }
    if (error instanceof TaskFollowUpSyncError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Could not assign task.",
    }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = patchSchema.parse(await request.json());
    const shopId = requireShopId(request, session);
    const existing = await prisma.task.findFirst({
      where: { id: body.id, shopId },
      select: taskSelect,
    });
    if (!existing) return NextResponse.json({ error: "Task not found." }, { status: 404 });

    const admin = canAssignTasks(session.role);
    if (!admin && existing.assignedToId !== session.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (body.assignedToId && !admin) return NextResponse.json({ error: "Only Shop Admin can reassign tasks." }, { status: 403 });
    if (body.status === "CANCELLED" && !admin) return NextResponse.json({ error: "Only Shop Admin can cancel tasks." }, { status: 403 });
    if (!admin && body.status && !["IN_PROGRESS", "COMPLETED"].includes(body.status)) {
      return NextResponse.json({ error: "Staff can start or complete assigned tasks." }, { status: 400 });
    }

    const reassignedTo = body.assignedToId && body.assignedToId !== existing.assignedToId
      ? await prisma.user.findFirst({
          where: { id: body.assignedToId, shopId, disabledAt: null },
          select: { id: true, role: true },
        })
      : null;
    if (body.assignedToId && body.assignedToId !== existing.assignedToId && (!reassignedTo || !isAssignableRole(reassignedTo.role))) {
      return NextResponse.json({ error: "Select an active operational staff member from this shop." }, { status: 400 });
    }

    const completedNow = body.status === "COMPLETED" && existing.status !== "COMPLETED";
    const reassignedNow = Boolean(reassignedTo);
    const task = await prisma.$transaction(async (tx) => {
      await updateTaskWithFollowUp(tx, {
        taskId: existing.id,
        shopId,
        assignedToId: reassignedTo?.id,
        status: body.status,
        progressNotes: body.progressNotes,
        dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
      });
      return tx.task.findUniqueOrThrow({ where: { id: existing.id }, select: taskSelect });
    });

    const notification = completedNow
      ? await notifyTaskCompleted({
        shopId,
        taskId: task.id,
        assignedById: task.assignedById,
        taskTypeLabel: taskTypeLabels[task.taskType as keyof typeof taskTypeLabels] ?? task.title,
        customerName: task.customer?.partyName,
        completedByName: session.name,
      })
      : reassignedNow
        ? await notifyTaskReassigned({
            shopId,
            taskId: task.id,
            assignedToId: task.assignedToId,
            taskTypeLabel: taskTypeLabels[task.taskType as keyof typeof taskTypeLabels] ?? task.title,
            reassignedByName: session.name,
          })
        : undefined;
    return NextResponse.json({ success: true, task, data: task, ...(notification ? { notification } : {}) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({
        error: "Invalid task update.",
        details: error.issues.map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`),
      }, { status: 400 });
    }
    if (error instanceof TaskFollowUpSyncError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update task." }, { status: 500 });
  }
}
