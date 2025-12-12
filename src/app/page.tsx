import { getServerSession } from "next-auth";
import { authOptions } from "@/utils/auth";
import { redirect } from "next/navigation";
import { AuthenticatedLayout } from "@/components/auth/authenticated-layout";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { AccountHeader } from "@/components/account-header/account-header";
import { PerformanceMetric } from "@/components/home/performance-metric/performance-metric";
import { AreaChart } from "@/components/home/area-chart/area-chart";
import { HomeSection } from "@/components/home/home-section/home-section";
// Just export default async function
export default async function Home() {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/api/auth/signin");
  }

  return (
    <AuthenticatedLayout>
      <main className="min-h-screen px-6 pt-8 min-w-sm">
        <ErrorBoundary
          title="Account Header Error"
          description="There was an error loading your account header."
          showRetryButton={true}
          showHomeButton={false}
          resetKeys={["account-header"]}
        >
          <AccountHeader session={session} />
        </ErrorBoundary>
        <ErrorBoundary
          title="Performance Metrics Error"
          description="There was an error loading performance metrics."
          showRetryButton={true}
          showHomeButton={false}
          resetKeys={["performance-metrics"]}
        >
          <section className="performance-metrics my-6">
            <h2 className="text-3xl font-semibold">Market Cap</h2>
            <div className="my-6 flex justify-between">
              <PerformanceMetric value="28.2K" lastCloseTimeFrame="1D" />
              <PerformanceMetric value="+4.8%" lastCloseTimeFrame="1W" />
            </div>
          </section>
        </ErrorBoundary>
        <ErrorBoundary
          title="Area Chart Error"
          description="There was an error loading the area chart."
          showRetryButton={true}
          showHomeButton={false}
          resetKeys={["area-chart"]}
        >
          <section className="my-6">
            <AreaChart />
          </section>
        </ErrorBoundary>

        <section className="my-6">
          <ErrorBoundary
            title="Trading Desk/Floor Error"
            description="There was an error loading the trading desk/floor section."
            showRetryButton={true}
            showHomeButton={false}
            resetKeys={["trading-desk-floor"]}
          >
            <HomeSection title="Trading Desk/Floor" />
          </ErrorBoundary>
          <ErrorBoundary
            title="Active Trades Error"
            description="There was an error loading active trades."
            showRetryButton={true}
            showHomeButton={false}
            resetKeys={["active-trades"]}
          >
            <HomeSection title="Active trades" />
          </ErrorBoundary>
          <ErrorBoundary
            title="Tempos Error"
            description="There was an error loading tempos."
            showRetryButton={true}
            showHomeButton={false}
            resetKeys={["tempos"]}
          >
            <HomeSection title="Tempos" />
          </ErrorBoundary>
          <ErrorBoundary
            title="Trade Journal Error"
            description="There was an error loading the trade journal."
            showRetryButton={true}
            showHomeButton={false}
            resetKeys={["trade-journal"]}
          >
            <HomeSection title="Trade journal" />
          </ErrorBoundary>
        </section>
      </main>
    </AuthenticatedLayout>
  );
}
