import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@numisma/components";

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
      // Normalized because phone keyboards and autofill are the reason this
      // form fails where a desktop succeeds: iOS/Android suggestion bars append
      // a trailing space, and some Android keyboards still capitalize the first
      // letter even in a type="email" field. The stored account email is
      // lowercase, so a capital or a stray space reads as "no such user".
      //
      // The PASSWORD is deliberately left untouched: whitespace and case are
      // significant there, and silently trimming a password would reject a
      // legitimate one.
      const { error } = await authClient.signIn.email({
        email: email.trim().toLowerCase(),
        password,
      });
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
        {/* THE PACKAGE `Button`, and `type="submit"` IS LOAD-BEARING. Base UI's
            button hands the element `type: "button"` by default and merges
            external props last, so the attribute below is what keeps this a
            submit control — drop it and the form still renders, still looks
            right, and no click ever submits it. `login-submit-button.test.tsx`
            holds that, along with the pending arm.

            SHARED PROPERTIES STILL COME FROM `styles.css`. `.auth-card button`
            is unlayered and Tailwind's output sits in `layer(utilities)`, so the
            fill, radius and padding below are the hand-written file's, by
            design (spec #412 Seam C). What the package's tokens govern here is
            everything that rule does not set — the focus ring above all. */}
        <Button type="submit" disabled={signIn.isPending}>
          {signIn.isPending ? "Signing in…" : "Sign in"}
        </Button>
        {/* Single-tenant (ADR-007): no self-service signup. The one account is
            established by `pnpm --filter @numisma/web auth:seed`, so there is no
            "Create one" link and no /signup route. */}
      </form>
    </main>
  );
}
