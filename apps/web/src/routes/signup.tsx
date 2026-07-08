import { useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { authClient } from "../lib/auth-client.ts";

export const Route = createFileRoute("/signup")({
  component: SignupPage,
});

function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const signUp = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.signUp.email({
        name: name || email,
        email,
        password,
      });
      if (error) {
        throw new Error(error.message ?? "Sign up failed");
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
          signUp.mutate();
        }}
      >
        <h1>Create account</h1>
        <label>
          Name
          <input
            type="text"
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
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
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={8}
            required
          />
        </label>
        {signUp.isError ? (
          <p className="error">{signUp.error.message}</p>
        ) : null}
        <button type="submit" disabled={signUp.isPending}>
          {signUp.isPending ? "Creating…" : "Create account"}
        </button>
        <p className="muted">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </main>
  );
}
