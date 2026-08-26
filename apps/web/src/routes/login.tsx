import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { Button, CARD_SURFACE } from "@numisma/components";

import { authClient } from "../lib/auth-client.ts";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

/**
 * The one id the error paragraph and both fields have to agree on.
 *
 * A literal spelled three times is a literal that goes out of agreement in two of the
 * three places without anything going red: `aria-describedby` pointing at an id nothing
 * carries is not an error in the DOM, it simply describes nothing, which is the state
 * this page was already in before spec #451 S5.
 */
const ERROR_ID = "login-error";

function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);

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
            line-height the deleted rules never set, and this is a parity migration.

            THE LABEL STOPPED WRAPPING ITS FIELD (spec #451 S5). A wrapping label is a
            valid association and the weaker one, and it is the half a refactor drops
            without noticing; `htmlFor`/`id` is the association several screen readers
            actually announce, and it is the first `htmlFor` in this repo. Unwrapping is
            also what lets the password toggle sit beside its field: a `<button>` inside
            a `<label>` is interactive content inside a label, and the label's own
            activation behaviour then has two candidates.

            `.auth-card label`'s STACK moved with the wrap, onto the element that now
            holds the pair — `flex flex-col gap-1.5`, the same three declarations
            against the same two children. The label keeps the two that are about type.
            The rendered box does not move. */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="login-email"
            className="text-[0.85rem] text-[var(--nms-muted-foreground)]"
          >
            Email
          </label>
          {/* THE COLOURS ARE THE PACKAGE'S NAMES NOW (spec #451 §4.2), AND TWO OF THEM
              ARE NOT THE NAME THE ENGLISH SUGGESTS. `--nms-input` is the boundary and
              NOT `--nms-border`, which is the card's hairline at 1.20 against this
              field until S3 split the two. `--nms-foreground` is the type and NOT
              `--nms-muted`, which is a recessed SURFACE in the package's vocabulary
              where the app's `--muted` was secondary TEXT. Both wrong names compile,
              emit a rule and paint.

              THE FOCUS RING IS NEW, AND THESE WERE THE LAST TWO CONTROLS WITHOUT ONE.
              Sixteen `focus-visible` treatments ship in `@numisma/components`, so the
              buttons, the card link and the rung rows are handled; these two inputs
              fell through to whatever the user agent draws. The shape is the fill
              path's rung row verbatim; the colour is `--nms-ring`, which is what every
              `Button` variant rings with and which `contrast.ts` already pairs against
              both this card and the page behind it.

              THE STRING IS SPELLED TWICE ON PURPOSE. It reads as duplication and it is
              the enumerated rewrite of spec #451 §3 gate 2: nine `var(--x)`
              occurrences, each becoming one named `--nms-*` read, countable in the
              file. Hoisting it to one constant would halve a count the gate checks.
              `auth-card-utilities.test.tsx` loops over BOTH inputs, so the two cannot
              drift without going red. */}
          <input
            id="login-email"
            className="rounded-lg border border-[var(--nms-input)] bg-[var(--nms-background)] p-2.5 text-[1rem] text-[var(--nms-foreground)] focus-visible:outline-2 focus-visible:outline-[var(--nms-ring)] focus-visible:outline-offset-2"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-describedby={ERROR_ID}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="login-password"
            className="text-[0.85rem] text-[var(--nms-muted-foreground)]"
          >
            Password
          </label>
          <div className="flex items-center gap-2">
            <input
              id="login-password"
              className="min-w-0 grow rounded-lg border border-[var(--nms-input)] bg-[var(--nms-background)] p-2.5 text-[1rem] text-[var(--nms-foreground)] focus-visible:outline-2 focus-visible:outline-[var(--nms-ring)] focus-visible:outline-offset-2"
              type={passwordVisible ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-describedby={ERROR_ID}
              required
            />
            {/* THE TYPE SWAPS; THE FIELD DOES NOT REMOUNT, AND THAT IS THE WHOLE
                CORRECTNESS CLAIM. The value lives in `password` above, so React
                updates one attribute and keeps the element — a toggle that rendered
                two different `<input>`s instead would clear what was typed at exactly
                the moment the operator reached for it because they were unsure what
                they had typed, and an empty password field looks like an empty
                password field. `login-submit-button.test.tsx` types once and toggles
                twice.

                IT LIVES HERE AND NOT IN `@numisma/components`. There is one password
                field in this app. It becomes a package primitive when there are two.

                IT IS THE PACKAGE `Button` FOR ITS COLOUR AND ITS RING, not for its
                geometry: `outline` at `sm` is the quietest thing the package ships
                that is still a control, and reaching for it keeps this route from
                spelling a tenth `--nms-*` read for a button the package can already
                paint. `type="button"` is spelled out for the same reason the submit
                button below spells `type="submit"` — the two defaults disagree, and
                a bare `<button>` in a `<form>` submits it. */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={passwordVisible}
              aria-label={passwordVisible ? "Hide password" : "Show password"}
              onClick={() => setPasswordVisible((visible) => !visible)}
            >
              {passwordVisible ? "Hide" : "Show"}
            </Button>
          </div>
        </div>
        {signIn.isError ? (
          // A FAILED SIGN-IN USED TO BE SILENT (SC 4.1.3). The paragraph appeared, the
          // operator's focus was still on the submit button, and nothing said why the
          // page had not moved. `role="alert"` makes it a live region; `aria-live` is
          // spelled alongside it because the role's implicit politeness is the thing a
          // reader has to go and look up, and both fields point at this id, so the
          // reason is re-read when focus returns to the field that caused it.
          //
          // `m-0` IS LOAD-BEARING. `.error` zeroed all four margin edges and preflight
          // is off, so dropping the rule without it hands the paragraph the UA's `1em`
          // top and bottom back and the form grows two lines — silently, with the suite
          // green.
          //
          // `--nms-destructive`, NOT `--nms-neg`. `apps/web` resolves both to the same
          // hex, so this is the read where the wrong name is invisible on screen:
          // `--nms-neg` is data, the sign of a number, and a failed sign-in is the
          // affordance of a control (spec #451 §4.2).
          <p
            id={ERROR_ID}
            role="alert"
            aria-live="assertive"
            className="m-0 text-[var(--nms-destructive)]"
          >
            {signIn.error.message}
          </p>
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
