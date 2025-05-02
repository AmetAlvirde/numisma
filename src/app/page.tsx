// REMOVE "use client";

// import { Button } from "@/components/ui/button"; // Remove unused import
// import { Input } from "@/components/ui/input";
// import { Label } from "@/components/ui/label";
// import { NextPage } from "next"; // Remove type, not needed for Server Component default export
// import Head from "next/head";
// import { signOut, useSession } from "next-auth/react"; // Remove client hook import
// import { useState } from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "./api/auth/[...nextauth]/route";
import { redirect } from "next/navigation";
// import { SignOutButton } from "@/components/auth/SignOutButton";
import { UserList } from "@/components/UserList";

// Just export default async function
export default async function Home() {
  const session = await getServerSession(authOptions);

  if (!session) {
    // Redirect to login page if not authenticated
    redirect("/api/auth/signin"); // Adjust if your signin page is different
  }

  return (
    <>
      {/* <Head> - Metadata should be handled via generateMetadata export in App Router */}
      {/*   <title>Auth & tRPC Demo</title> */}
      {/*   <meta name="description" content="NextAuth.js + tRPC Integration" /> */}
      {/*   <link rel="icon" href="/favicon.ico" /> */}
      {/* </Head> */}
      <main className="flex min-h-screen flex-col items-center justify-start p-12 space-y-4">
        <h1 className="text-2xl font-bold">Protected Page</h1>
        <p>Welcome, {session.user?.name ?? session.user?.email}!</p>
        <UserList />{" "}
        {/* UserList is still a Client Component, rendered by this Server Component */}
        {/* <SignOutButton /> Remove usage */}
      </main>
    </>
  );
}

// Remove named export if it exists
// export default Home;
