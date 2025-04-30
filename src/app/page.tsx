"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type NextPage } from "next";
// import Head from "next/head"; // Note: Head component works differently in App Router, might need adjustment
import { signIn, signOut, useSession } from "next-auth/react";
import { useState } from "react";

const Home: NextPage = () => {
  const { data: session, status } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    // Basic sign-in attempt, assumes Credentials provider
    await signIn("credentials", {
      redirect: false, // Prevent redirect on failure/success for now
      email,
      password,
    });
    // Clear fields after attempt
    setEmail("");
    setPassword("");
  };

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

          {status === "loading" && <p>Loading...</p>}

          {status === "unauthenticated" && (
            <form onSubmit={handleSignIn} className="flex flex-col gap-4">
              <h2 className="text-2xl font-bold">Sign In</h2>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="border-2 border-gray-200 my-2"
                />
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="border-2 border-gray-200 my-2"
                />
              </div>
              <Button type="submit">Sign In</Button>
            </form>
          )}

          {status === "authenticated" && session?.user && (
            <div className="flex flex-col items-center gap-4">
              <p className="text-xl">
                Signed in as {session.user.email ?? session.user.name}
              </p>
              <button
                onClick={() => void signOut()}
                className="rounded-full bg-white/10 px-10 py-3 font-semibold no-underline transition hover:bg-white/20"
              >
                Sign Out
              </button>
            </div>
          )}
        </div>
      </main>
    </>
  );
};

export default Home;
