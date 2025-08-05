import { getServerSession } from "next-auth";
import { authOptions } from "@/utils/auth";
import { redirect } from "next/navigation";
import { AuthenticatedLayout } from "@/components/auth/authenticated-layout";
import { HomeHeader } from "@/components/home/home-header/home-header";
import { PinnedPortfolioOverview } from "@/components/home/pinned-portfolio-overview/pinned-portfolio-overview";
import { RecentPositions } from "@/components/home/recent-positions/recent-positions";
import { RecentJournal } from "@/components/home/recent-journal/recent-journal";
import { ErrorBoundary } from "@/components/ui/error-boundary";

// Just export default async function
export default async function Home() {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/api/auth/signin");
  }

  return (
    <AuthenticatedLayout>
      <main className="flex min-h-screen flex-col items-center justify-start p-6 space-y-4 min-w-sm">
        <HomeHeader title="Overview" session={session} />

        <div className="w-full max-w-6xl flex items-start justify-between">
          <h1 className="text-2xl font-bold mb-2">Primary focus</h1>
        </div>
        <PinnedPortfolioOverview />

        <div className="w-full max-w-6xl flex items-start justify-between">
          <h1 className="text-2xl font-bold mb-2">Action required</h1>
        </div>
        <ErrorBoundary
          title="Recent Positions Error"
          description="There was an error loading your recent positions."
          showRetryButton={true}
          showHomeButton={false}
          resetKeys={["recent-positions"]}
        >
          <RecentPositions />
        </ErrorBoundary>

        <div className="w-full max-w-6xl flex items-start justify-between">
          <h1 className="text-2xl font-bold mb-2">Context and insights</h1>
        </div>
        <ErrorBoundary
          title="Recent Journal Error"
          description="There was an error loading your recent journal entries."
          showRetryButton={true}
          showHomeButton={false}
          resetKeys={["recent-journal"]}
        >
          <RecentJournal />
        </ErrorBoundary>
      </main>
    </AuthenticatedLayout>
  );
}
