import { useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { authClient } from "../lib/auth-client.ts";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const signIn = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.signIn.email({ email, password });
      if (error) {
        throw new Error(error.message ?? "Sign in failed");
      }
    },
    onSuccess: () => {
      router.navigate({ to: "/" });
    },
  });

  return (
    <main className="auth">
      <form
        className="card auth-card"
        onSubmit={(event) => {
          event.preventDefault();
          signIn.mutate();
        }}
      >
        <h1>Sign in</h1>
        <label>
          Email
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {signIn.isError ? (
          <p className="error">{signIn.error.message}</p>
        ) : null}
        <button type="submit" disabled={signIn.isPending}>
          {signIn.isPending ? "Signing in…" : "Sign in"}
        </button>
        <p className="muted">
          No account? <Link to="/signup">Create one</Link>
        </p>
      </form>
    </main>
  );
}
