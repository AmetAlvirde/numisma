import { getServerSession } from "next-auth";
import { authOptions } from "@/utils/auth";
import { redirect } from "next/navigation";
import { UserList } from "@/components/user-list";
import { ThemeDebugDisplay } from "@/components/utils/theme-debug-display";
import { AuthenticatedLayout } from "@/components/layouts/authenticated-layout";

// Just export default async function
export default async function Home() {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/api/auth/signin");
  }

  return (
    <AuthenticatedLayout>
      <main className="flex min-h-screen flex-col items-center justify-start p-12 space-y-4">
        <h1 className="text-2xl font-bold">Welcome Home</h1>
        <p>Welcome, {session.user?.name ?? session.user?.email}!</p>
      </main>
    </AuthenticatedLayout>
  );
}
