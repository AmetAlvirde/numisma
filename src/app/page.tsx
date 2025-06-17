import { getServerSession } from "next-auth";
import { authOptions } from "@/utils/auth";
import { redirect } from "next/navigation";
import { AuthenticatedLayout } from "@/components/layouts/authenticated-layout";
import { PageHeader } from "@/components/page-header/page-header";
import { PortfolioOverview } from "@/components/portfolio-overview/portfolio-overview";
import { RecentPositions } from "@/components/recent-positions/recent-positions";
import { RecentJournal } from "@/components/recent-journal/recent-journal";

// Helper function to get quarter and week
function getCurrentPeriod() {
  const now = new Date();
  const quarter = Math.ceil((now.getMonth() + 1) / 3);

  // Calculate week number
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const pastDaysOfYear = (now.getTime() - startOfYear.getTime()) / 86400000;
  const week = Math.ceil((pastDaysOfYear + startOfYear.getDay() + 1) / 7);

  return `Q${quarter}/W${week}`;
}

// Just export default async function
export default async function Home() {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/api/auth/signin");
  }

  const currentPeriod = getCurrentPeriod();

  console.log(session);
  return (
    <AuthenticatedLayout>
      <main className="flex min-h-screen flex-col items-center justify-start p-6 space-y-4">
        {/* Header Section */}
        <PageHeader
          currentPeriod={currentPeriod}
          title="Overview"
          session={session}
        />

        {/* Portfolio Overview */}
        <PortfolioOverview />

        {/* Recent Positions */}
        <div className="w-full max-w-6xl flex items-start justify-between">
          <h1 className="text-2xl font-bold mb-2">Recent Positions</h1>
        </div>
        <RecentPositions />

        {/* Journal Entries */}
        <div className="w-full max-w-6xl flex items-start justify-between">
          <h1 className="text-2xl font-bold mb-2">Recent Journal</h1>
        </div>
        <RecentJournal />
      </main>
    </AuthenticatedLayout>
  );
}
