import { getServerSession } from "next-auth";
import { authOptions } from "@/utils/auth";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/SignOutButton";
import { UserList } from "@/components/UserList";
import { ThemeSelector } from "@/components/utils/ThemeSelector";

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
        <ThemeSelector />
        <h1 className="text-2xl font-bold">Protected Page</h1>
        <p>Welcome, {session.user?.name ?? session.user?.email}!</p>
        <UserList />{" "}
        {/* UserList is still a Client Component, rendered by this Server Component */}
        <SignOutButton /> {/* Render the SignOutButton Client Component */}
      </main>
    </>
  );
}
