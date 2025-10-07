import { getServerSession } from "next-auth";
import { authOptions } from "@/utils/auth";
import { redirect } from "next/navigation";
import { AuthenticatedLayout } from "@/components/auth/authenticated-layout";
import { HomeHeader } from "@/components/home/home-header/home-header";
import { PinnedPortfolioOverview } from "@/components/home/pinned-portfolio-overview/pinned-portfolio-overview";
import { RecentPositions } from "@/components/home/recent-positions/recent-positions";
import { RecentJournal } from "@/components/home/recent-journal/recent-journal";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { AccountHeader } from "@/components/account-header/account-header";
import { PerformanceMetric } from "@/components/home/performance-metric/performance-metric";
import { AreaChart } from "@/components/home/area-chart/area-chart";
import { ActionItem } from "@/components/home/action-item/action-item";
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
        <h2 className="text-2xl font-semibold">Trading Desk/Floor</h2>
        <section className="my-6">
          <ActionItem
            layout="stats-condensed"
            type="tempo|active-trade|closed-trade|paper-trade|journal-entry|journal-prompt"
            data=""
          />
          <br />
          <br />
          <br />
          <br />
        </section>
      </main>
    </AuthenticatedLayout>
  );
}
