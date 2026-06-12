import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireShopId } from "@/lib/tenant";
import { isShopAdminRole, normalizeFixedRole } from "@/lib/operational-roles";
import { notifyTaskAssigned, notifyTaskCompleted } from "@/lib/notifications";
import { taskPriorities, taskReferenceUrl, taskStatuses, taskTypeLabels, taskTypes } from "@/lib/tasks";

const createSchema = z.object({
  shopId: z.string().optional(),
  assignedToId: z.string().min(1),
  customerId: z.string().min(1).optional().nullable(),
  taskType: z.enum(taskTypes),
  title: z.string().trim().min(1).max(160).optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
  priority: z.enum(taskPriorities).default("MEDIUM"),
  dueDate: z.string().datetime(),
  sourceEntityType: z.string().trim().max(60).optional().nullable(),
  sourceEntityId: z.string().trim().max(120).optional().nullable(),
  referenceUrl: z.string().trim().max(500).refine((value) => value.startsWith("/"), "Reference URL must be app-local.").optional().nullable(),
});

const patchSchema = z.object({
  id: z.string().min(1),
  status: z.enum(taskStatuses).optional(),
  progressNotes: z.string().trim().max(2000).optional().nullable(),
});

const taskInclude = {
  customer: { select: { id: true, partyName: true, outstandingBalance: true, contactNumber: true } },
  assignedTo: { select: { id: true, name: true, role: true } },
  assignedBy: { select: { id: true, name: true, role: true } },
} satisfies Prisma.TaskInclude;

function canAssign(role: string) {
  return isShopAdminRole(role) || role === "SUPER_ADMIN";
}

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

  const shopId = requireShopId(request, session);
  const { searchParams } = new URL(request.url);
  const view = searchParams.get("view");

  if (view === "staff") {
    if (!canAssign(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const staff = await prisma.user.findMany({
      where: {
        shopId,
        disabledAt: null,
        role: { in: ["SALES_PERSON", "ACCOUNT_STAFF", "SALES_PERSON_CUM_ACCOUNTS"] },
      },
      select: { id: true, name: true, role: true, jobTitle: true },
      orderBy: { name: "asc" },
    });
    return NextResponse.json({ staff });
  }

  const status = searchParams.get("status");
  const where: Prisma.TaskWhereInput = {
    shopId,
    ...(!canAssign(session.role) ? { assignedToId: session.id } : {}),
    ...(status && taskStatuses.includes(status as (typeof taskStatuses)[number]) ? { status } : {}),
  };
  const tasks = await prisma.task.findMany({
    where,
    include: taskInclude,
    orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
    take: 300,
  });
  return NextResponse.json({ tasks, view: canAssign(session.role) ? "ALL" : "MINE" });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canAssign(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = createSchema.parse(await request.json());
    const shopId = shopIdForCreate(request, session, body.shopId);
    const dueDate = new Date(body.dueDate);
    const assignedTo = await prisma.user.findFirst({
      where: { id: body.assignedToId, shopId, disabledAt: null },
      select: { id: true, name: true, role: true },
    });
    if (!assignedTo || !isAssignableRole(assignedTo.role)) {
      return NextResponse.json({ error: "Select an active operational staff member from this shop." }, { status: 400 });
    }

    const customer = body.customerId
      ? await prisma.customer.findFirst({
          where: { id: body.customerId, shopId },
          select: { id: true, partyName: true },
        })
      : null;
    if (body.customerId && !customer) return NextResponse.json({ error: "Customer not found for this shop." }, { status: 404 });

    const task = await prisma.task.create({
      data: {
        shopId,
        customerId: customer?.id,
        assignedToId: assignedTo.id,
        assignedById: session.id,
        taskType: body.taskType,
        title: body.title || taskTypeLabels[body.taskType],
        notes: body.notes || null,
        priority: body.priority,
        dueDate,
        sourceEntityType: body.sourceEntityType || null,
        sourceEntityId: body.sourceEntityId || null,
        referenceUrl: body.referenceUrl || taskReferenceUrl({
          customerId: customer?.id,
          sourceEntityType: body.sourceEntityType,
          sourceEntityId: body.sourceEntityId,
        }),
      },
      include: taskInclude,
    });

    await notifyTaskAssigned({
      shopId,
      taskId: task.id,
      assignedToId: assignedTo.id,
      taskTypeLabel: taskTypeLabels[body.taskType],
      customerName: customer?.partyName,
      dueDate,
      assignedByName: session.name,
    });
    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? "Invalid task details." : "Could not assign task." }, { status: 400 });
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
      include: taskInclude,
    });
    if (!existing) return NextResponse.json({ error: "Task not found." }, { status: 404 });

    const admin = canAssign(session.role);
    if (!admin && existing.assignedToId !== session.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (body.status === "CANCELLED" && !admin) return NextResponse.json({ error: "Only Shop Admin can cancel tasks." }, { status: 403 });
    if (!admin && body.status && !["IN_PROGRESS", "COMPLETED"].includes(body.status)) {
      return NextResponse.json({ error: "Staff can start or complete assigned tasks." }, { status: 400 });
    }

    const completedNow = body.status === "COMPLETED" && existing.status !== "COMPLETED";
    const task = await prisma.task.update({
      where: { id: existing.id },
      data: {
        ...(body.status ? { status: body.status } : {}),
        ...(body.progressNotes !== undefined ? { progressNotes: body.progressNotes || null } : {}),
        ...(completedNow ? { completedAt: new Date() } : {}),
        ...(body.status && body.status !== "COMPLETED" ? { completedAt: null } : {}),
      },
      include: taskInclude,
    });

    if (completedNow) {
      await notifyTaskCompleted({
        shopId,
        taskId: task.id,
        assignedById: task.assignedById,
        taskTypeLabel: taskTypeLabels[task.taskType as keyof typeof taskTypeLabels] ?? task.title,
        customerName: task.customer?.partyName,
        completedByName: session.name,
      });
    }
    return NextResponse.json({ task });
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? "Invalid task update." : "Could not update task." }, { status: 400 });
  }
}
