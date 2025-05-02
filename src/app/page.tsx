"use client";

import { Button } from "@/components/ui/button";
// import { Input } from "@/components/ui/input"; // No longer needed
// import { Label } from "@/components/ui/label"; // No longer needed
import { type NextPage } from "next";
// import Head from "next/head"; // Note: Head component works differently in App Router, might need adjustment
import { signOut, useSession } from "next-auth/react";
// import { useState } from "react"; // No longer needed for email/password

const Home: NextPage = () => {
  const { data: session } = useSession({
    required: true, // Ensure session is loaded before rendering, redirect handled by middleware
  });
  // const [email, setEmail] = useState(""); // No longer needed
  // const [password, setPassword] = useState(""); // No longer needed

  // const handleSignIn = async (e: React.FormEvent) => { // No longer needed
  //   e.preventDefault();
  //   // Basic sign-in attempt, assumes Credentials provider
  //   await signIn("credentials", {
  //     redirect: false, // Prevent redirect on failure/success for now
  //     email,
  //     password,
  //   });
  //   // Clear fields after attempt
  //   setEmail("");
  //   setPassword("");
  // };

  // If session is required and not loaded yet, useSession will handle it (or middleware)
  // This part is mainly for type safety now, ensuring session is not null
  if (!session?.user) {
    // Can show a loading state or return null, though middleware should prevent this state mostly
    return <p>Loading session...</p>;
  }

  return (
    <>
      {/* <Head> - Metadata should be handled via generateMetadata export in App Router */}
      {/*   <title>Auth & tRPC Demo</title> */}
      {/*   <meta name="description" content="NextAuth.js + tRPC Integration" /> */}
      {/*   <link rel="icon" href="/favicon.ico" /> */}
      {/* </Head> */}
      <main className="flex min-h-screen flex-col items-center justify-center">
        <div className="container flex flex-col items-center justify-center gap-12 px-4 py-16 ">
          <h1 className="text-5xl font-extrabold tracking-tight sm:text-[5rem]">
            App name
          </h1>

          {/* {status === "loading" && <p>Loading...</p>} */}
          {/* Removed unauthenticated state and sign-in form */}

          {/* Display authenticated user info and sign out button directly */}
          <div className="flex flex-col items-center gap-4">
            <p className="text-xl">
              Signed in as {session.user.email ?? session.user.name}
            </p>
            <Button // Using Button component for consistency
              onClick={() => void signOut({ callbackUrl: "/login" })} // Redirect to login on sign out
              variant="outline"
            >
              Sign Out
            </Button>
          </div>
        </div>
      </main>
    </>
  );
};

export default Home;
