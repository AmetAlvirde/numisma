import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { Button, CARD_SURFACE } from "@numisma/components";

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
    // THE UTILITIES ARE THE STYLING NOW (spec #420 slice 1). `.auth`, `.auth-card` and
    // their descendant rules are gone from `styles.css`; what was `.dashboard, .auth`'s
    // capped centred column plus `.auth`'s full-height centring is spelled out here.
    // `my-0` is not decoration: `margin: 0 auto` set all four edges and preflight is off,
    // so only `mx-auto` would leave the UA free on the other two.
    <main className="mx-auto my-0 flex min-h-dvh max-w-[760px] flex-col justify-center gap-4 p-4">
      <form
        className={`${CARD_SURFACE} flex flex-col gap-3`}
        onSubmit={(event) => {
          event.preventDefault();
          signIn.mutate();
        }}
      >
        <h1>Sign in</h1>
        {/* `text-[0.85rem]` and `text-[1rem]` are arbitrary values where `text-sm` and
            `text-base` would nearly do, on purpose: those utilities also set a
            line-height the deleted rules never set, and this is a parity migration. */}
        <label className="flex flex-col gap-1.5 text-[0.85rem] text-[var(--muted)]">
          Email
          <input
            className="rounded-lg border border-[var(--line)] bg-[var(--bg)] p-2.5 text-[1rem] text-[var(--text)]"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label className="flex flex-col gap-1.5 text-[0.85rem] text-[var(--muted)]">
          Password
          <input
            className="rounded-lg border border-[var(--line)] bg-[var(--bg)] p-2.5 text-[1rem] text-[var(--text)]"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {signIn.isError ? (
          // `m-0` IS LOAD-BEARING. `.error` zeroed all four margin edges and preflight
          // is off, so dropping the rule without it hands the paragraph the UA's `1em`
          // top and bottom back and the form grows two lines — silently, with the suite
          // green.
          <p className="m-0 text-[var(--neg)]">{signIn.error.message}</p>
        ) : null}
        {/* THE PACKAGE `Button`, and `type="submit"` IS LOAD-BEARING. Base UI's
            button hands the element `type: "button"` by default and merges
            external props last, so the attribute below is what keeps this a
            submit control — drop it and the form still renders, still looks
            right, and no click ever submits it. `login-submit-button.test.tsx`
            holds that, along with the pending arm.

            IT CARRIES NO CLASS OF THIS APP'S, AND THAT IS THE SLICE. `.auth-card
            button` was unlayered and Tailwind's output sits in `layer(utilities)`,
            so from #417 until spec #420 slice 1 the hand-written file's fill,
            radius and padding won over the package's. That rule is now deleted
            with NO replacement: the package `Button`'s own geometry (`h-9 px-4` and
            its arbitrary min-radius class, which `tailwind-scan.test.ts` uses as the
            package's scan sentinel and which therefore must NOT be spelled out in
            this tree) and its `disabled:opacity-50` are what render. Colour did not
            move — the literal `#3b6cf0` the
            house rule painted is the value `--accent` holds — and adding a house
            utility here would re-open the override this slice closed. */}
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
