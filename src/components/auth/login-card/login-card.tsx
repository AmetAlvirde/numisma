"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface LoginCardProps {
  onSubmit: (email: string, password: string) => Promise<void>;
  error: string | null;
  isLoading?: boolean; // Optional loading state prop
}

export const LoginCard: React.FC<LoginCardProps> = ({
  onSubmit,
  error,
  isLoading,
}) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await onSubmit(email, password);
  };

  return (
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
          disabled={isLoading}
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
          disabled={isLoading}
        />
      </div>
      <Button type="submit" className="mt-4" disabled={isLoading}>
        {isLoading ? "Signing In..." : "Sign In"}
      </Button>
    </form>
  );
};
