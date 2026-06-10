import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { normalizeFixedRole } from "@/lib/operational-roles";
import { TradeCalculator } from "./trade-calculator";

export default async function TradeCalculatorPage() {
  const session = await getSession();
  if (!session) redirect("/login?session=expired");

  const role = normalizeFixedRole(session.role);
  if (role !== "SHOP_ADMIN" && role !== "SUPER_ADMIN") {
    redirect("/");
  }

  return <TradeCalculator />;
}
