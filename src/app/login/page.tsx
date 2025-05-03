"use client";

import { LoginCard } from "@/components/auth/login-card/login-card";
import { type NextPage } from "next";
import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";

const LoginPage: NextPage = () => {
  const { status } = useSession();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Redirect if already authenticated
  useEffect(() => {
    if (status === "authenticated") {
      router.replace("/");
    }
  }, [status, router]);

  const handleLoginSubmit = async (email: string, password: string) => {
    setError(null);
    setIsLoading(true);
    try {
      const result = await signIn("credentials", {
        redirect: false,
        email,
        password,
      });

      if (result?.error) {
        setError(result.error);
        console.error("Sign-in error:", result.error);
      } else if (result?.ok) {
        router.push("/");
      } else {
        setError("An unknown error occurred during sign-in.");
      }
    } catch (error) {
      console.error("Sign-in exception:", error);
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  if (status === "loading") {
    return <div>Loading...</div>;
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center">
      <LoginCard
        onSubmit={handleLoginSubmit}
        error={error}
        isLoading={isLoading}
      />
    </main>
  );
};

export default LoginPage;
