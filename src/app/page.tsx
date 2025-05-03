import { getServerSession } from "next-auth";
import { authOptions } from "@/utils/auth";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/sign-out-button";
import { UserList } from "@/components/user-list";
import { ThemeSelector } from "@/components/utils/theme-selector";
import { ThemeDebugDisplay } from "@/components/utils/theme-debug-display";

// Just export default async function
export default async function Home() {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/api/auth/signin");
  }

  return (
    <>
      {/* <Head> - Metadata should be handled via generateMetadata export in App Router */}
      {/*   <title>Auth & tRPC Demo</title> */}
      {/*   <meta name="description" content="NextAuth.js + tRPC Integration" /> */}
      {/*   <link rel="icon" href="/favicon.ico" /> */}
      {/* </Head> */}
      <main className="flex min-h-screen flex-col items-center justify-start p-12 space-y-4">
        <ThemeDebugDisplay />
        <h1 className="text-2xl font-bold">Protected Page</h1>
        <p>Welcome, {session.user?.name ?? session.user?.email}!</p>
        <p>pick your theme:</p>
        <ThemeSelector />
        <UserList />
        <SignOutButton />
      </main>
    </>
  );
}
