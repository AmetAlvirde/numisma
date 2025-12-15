import { getServerSession } from "next-auth";
import { authOptions } from "@/utils/auth";
import { redirect } from "next/navigation";
import { AuthenticatedLayout } from "@/components/auth/authenticated-layout";
import { PortfolioDetailContent } from "./portfolio-detail-content";

interface PortfolioDetailPageProps {
  params: Promise<{ "portfolio-id": string }>;
}

export default async function PortfolioDetailPage({
  params,
}: PortfolioDetailPageProps) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/api/auth/signin");
  }

  const { "portfolio-id": portfolioId } = await params;

  return (
    <AuthenticatedLayout>
      <main className="container mx-auto px-4 py-8 max-w-6xl">
        <PortfolioDetailContent portfolioId={portfolioId} />
      </main>
    </AuthenticatedLayout>
  );
}

