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
    <div className="flex min-h-screen min-w-0 overflow-x-hidden">
      <Sidebar userName={session.name} role={session.role} />
      <main className="min-w-0 w-full flex-1 overflow-x-hidden overflow-y-auto p-4 pt-16 md:p-8">{children}</main>
    </div>
  );
}
