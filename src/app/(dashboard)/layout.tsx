import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Sidebar } from "@/components/Sidebar";
import { getOnboardingState } from "@/lib/onboarding";
import { prisma } from "@/lib/db";
import { normalizeOperationalRoles } from "@/lib/operational-roles";
import { logger } from "@/lib/logger";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login?session=expired");
  const onboarding = await getOnboardingState(session);
  if (onboarding.needsOnboarding) redirect("/onboarding");
  const roleAssignments = session.role === "SUPER_ADMIN"
    ? []
    : await prisma.userRoleAssignment.findMany({
        where: { userId: session.id, shopId: session.shopId },
        select: { role: true },
      }).catch((error) => {
        logger.error("layout_role_assignment_lookup_failed_fallback_legacy_role", {
          userId: session.id,
          role: session.role,
          shopId: session.shopId,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        return [];
      });
  const operationalRoles = normalizeOperationalRoles(session.role, roleAssignments);

  return (
    <div className="flex min-h-screen">
      <Sidebar userName={session.name} role={session.role} operationalRoles={operationalRoles} />
      <main className="w-full flex-1 overflow-auto p-4 pt-16 md:p-8">{children}</main>
    </div>
  );
}
