import { getServerSession } from "next-auth";
import { authOptions } from "@/utils/auth";
import { redirect } from "next/navigation";
import { AuthenticatedLayout } from "@/components/auth/authenticated-layout";
// import { ErrorBoundary } from "@/components/ui/error-boundary";
import { AccountHeader } from "@/components/account-header/account-header";
import { PerformanceMetric } from "@/components/home/performance-metric/performance-metric";
import { AreaChart } from "@/components/home/area-chart/area-chart";
import { ActionItem } from "@/components/home/action-item/action-item";
import { ScrollableRow } from "@/components/scrollable-row/scrollable-row";
import { HomeSection } from "@/components/home-section/home-section";
// Just export default async function
export default async function Home() {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/api/auth/signin");
  }

  return (
    <AuthenticatedLayout>
      <main className="min-h-screen px-6 pt-8 min-w-sm">
        <AccountHeader session={session} />
        <section className="performance-metrics my-6">
          <h2 className="text-3xl font-semibold">Market Cap</h2>
          <div className="my-6 flex justify-between">
            <PerformanceMetric value="28.2K" lastCloseTimeFrame="1D" />
            <PerformanceMetric value="+4.8%" lastCloseTimeFrame="1W" />
          </div>
        </section>
        <section className="my-6">
          <AreaChart />
        </section>

        <section className="my-6">
          <HomeSection title="Trading Desk/Floor" />
          <HomeSection title="Active trades" />
          <HomeSection title="Tempos" />
          <HomeSection title="Trade journal" />
        </section>
      </main>
    </AuthenticatedLayout>
  );
}
