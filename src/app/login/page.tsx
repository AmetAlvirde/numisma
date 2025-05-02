"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type NextPage } from "next";
import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation"; // Use next/navigation for App Router
import { useState, useEffect } from "react";

const LoginPage: NextPage = () => {
  const { status } = useSession();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Redirect if already authenticated
  useEffect(() => {
    if (status === "authenticated") {
      router.replace("/"); // Redirect to home if already logged in
    }
  }, [status, router]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null); // Clear previous errors

    try {
      const result = await signIn("credentials", {
        redirect: false, // Prevent NextAuth.js from redirecting automatically
        email,
        password,
      });

      // signIn with redirect:false returns result object
      // If redirection is handled by NextAuth, this part might not be reached
      // or `result.url` will be the target URL.
      // If there's an error, it's usually handled by redirecting to an error page or reflected in result.error
      if (result?.error) {
        setError(result.error);
        console.error("Sign-in error:", result.error);
      } else if (result?.ok) {
        // Redirect manually after successful sign-in
        // NextAuth usually handles callbackUrl via middleware, but let's be explicit
        router.push("/"); // Redirect to the root page
      } else {
        setError("An unknown error occurred during sign-in.");
      }
    } catch (error) {
      console.error("Sign-in exception:", error);
      setError("An unexpected error occurred. Please try again.");
    }
  };

  // If authenticated, redirect to home (should ideally be handled by middleware)
  if (status === "authenticated") {
    router.replace("/"); // Use replace to avoid adding login to history
    return <div>Redirecting...</div>; // Or a loading indicator
  }

  if (status === "loading") {
    return <div>Loading...</div>; // Show loading state
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center">
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-4 p-8 border rounded shadow-md w-full max-w-sm"
      >
        <h1 className="text-2xl font-bold mb-4 text-center">Sign In</h1>
        {error && <p className="text-red-500 text-center">{error}</p>}
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
            className="border-2 border-gray-300 focus:border-blue-500 my-2 p-2 w-full rounded"
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
            className="border-2 border-gray-300 focus:border-blue-500 my-2 p-2 w-full rounded"
          />
        </div>
        <Button type="submit" className="mt-4">
          Sign In
        </Button>
      </form>
    </main>
  );
};

export default LoginPage;
