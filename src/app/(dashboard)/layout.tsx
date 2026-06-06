import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Sidebar } from "@/components/Sidebar";
import { getOnboardingState } from "@/lib/onboarding";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login?session=expired");
  const onboarding = await getOnboardingState(session);
  if (onboarding.needsOnboarding) redirect("/onboarding");

  return (
    <div className="flex min-h-screen">
      <Sidebar userName={session.name} role={session.role} />
      <main className="flex-1 overflow-auto p-4 md:p-8">{children}</main>
    </div>
  );
}
