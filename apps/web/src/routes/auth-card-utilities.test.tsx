// @vitest-environment jsdom
/**
 * THE CENSUS SUCCESSOR FOR THE AUTH SURFACE — spec #420 Seam E, slice 1.
 *
 * `.auth`, `.auth-card`, `.auth-card label`, `.auth-card input`, `.auth-card button`,
 * `.auth-card button:disabled` and `.error` are gone from `styles.css`, and the elements
 * they styled carry the utilities that reproduce them. Two channels prove two different
 * things and neither covers the other's ground: this file is the RENDERED DOM channel,
 * asserting that the element references the utility. That the rule is emitted is the scan
 * guards' claim, and that it won the cascade and computed to the right value is the Chrome
 * checklist's — recorded in the slice's commit body, because jsdom will not resolve a
 * `var()` through a cascade and would answer every colour question with an empty string.
 *
 * PER CLASS, `toContain`, NEVER FULL-STRING EQUALITY (Seam E). The old census pinned the
 * whole `class` attribute, which made every utility in it load-bearing and every addition
 * a test edit. What is load-bearing here is the subset below: the declarations the deleted
 * rules carried, one utility each.
 *
 * THE MARGIN TRAP IS THE POINT OF `m-0`. Preflight is off (D2), so the UA's `1em` top and
 * bottom margins on a `<p>` are live. `.error` zeroed all four edges; dropping the rule
 * without `m-0` moves the error line by two lines and every test still passes.
 *
 * THE DELETED CLASS NAMES ARE ASSERTED ABSENT, with one deliberate exception this file
 * states out loud rather than leaves to a reader: `error` SURVIVES on `card notice error`
 * elements, because `.notice.error h1` still selects through it and that rule is slice 2's.
 * It is gone from the login page's error paragraph, whose only styling came from `.error`.
 *
 * `login-submit-button.test.tsx` is untouched and asserts the button; the sign-in button
 * carries NO utility from this file by design, because the whole slice is that the package
 * `Button` stopped being overridden.
 *
 * Every value below is authored. No account, no credential, no captured response.
 */
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { classCensus, render, screen, userEvent } from "@numisma/components/testkit/render.testkit.tsx";
import { Route } from "./login.tsx";
import { CARD_SURFACE } from "@numisma/components";

/**
 * Never settles by default, so the pending arm cannot race the assertions below. The
 * error test overrides it once with a REJECTED CREDENTIAL SHAPE — `{ error: { message } }`
 * is what Better Auth's client returns on a bad sign-in, and `login.tsx` turns that into
 * the thrown error the paragraph renders. The message is authored.
 */
const signInEmail = vi.fn((_credentials: unknown) => new Promise<never>(() => {}));

vi.mock("../lib/auth-client.ts", () => ({
  authClient: { signIn: { email: (credentials: unknown) => signInEmail(credentials) } },
}));

const LoginPage = Route.options.component as () => ReactElement;

/** Mount the sign-in page under the two contexts it reads, and wait for the form. */
async function renderLoginPage() {
  const rootRoute = createRootRoute({ component: () => <LoginPage /> });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/login"] }),
  });
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: "Sign in" });
  return result;
}

/** The class list of an element, as a set of names rather than one string. */
function classes(element: Element): string[] {
  return (element.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

describe("the auth surface's utilities", () => {
  it("puts `.auth`'s centred, capped column on the page's own `<main>`", async () => {
    const { container } = await renderLoginPage();
    const main = container.querySelector("main")!;

    // max-width 760px; margin 0 auto; padding 16px; flex column; gap 16px.
    for (const utility of [
      "max-w-[760px]",
      "mx-auto",
      "my-0",
      "p-4",
      "flex",
      "flex-col",
      "gap-4",
      // `.auth`'s own rule, on top of the `.dashboard, .auth` pair.
      "min-h-dvh",
      "justify-center",
    ]) {
      expect(classes(main)).toContain(utility);
    }
  });

  it("puts `.auth-card`'s column on the form, on the card surface", async () => {
    const { container } = await renderLoginPage();
    const form = container.querySelector("form")!;

    for (const utility of ["flex", "flex-col", "gap-3"]) {
      expect(classes(form)).toContain(utility);
    }
    // Slice 2 deleted `.card`. The form is one of the four surfaces that are NOT a
    // `Card` — it keeps its own element and imports the class string instead.
    for (const utility of CARD_SURFACE.split(" ")) {
      expect(classes(form)).toContain(utility);
    }
    expect(classes(form)).not.toContain("card");
  });

  it("puts `.auth-card label`'s stacked, muted label on both fields", async () => {
    const { container } = await renderLoginPage();
    const labels = [...container.querySelectorAll("label")];
    expect(labels).toHaveLength(2);

    for (const label of labels) {
      // THE STACK MOVED OFF THE LABEL AND NOTHING ELSE DID (spec #451 S5). The label
      // stopped wrapping its input, so `.auth-card label`'s `display:flex`,
      // `flex-direction:column` and `gap:6px` now sit on the element that holds the
      // pair; the two declarations that are about TYPE stay on the label itself. The
      // rendered box is the same box, which is why both halves are asserted here
      // rather than one half being dropped.
      //
      // The size is an arbitrary value rather than `text-sm`, which would also set a
      // line-height the rule never set.
      for (const utility of ["text-[0.85rem]", "text-[var(--nms-muted-foreground)]"]) {
        expect(classes(label)).toContain(utility);
      }
      for (const utility of ["flex", "flex-col", "gap-1.5"]) {
        expect(classes(label.parentElement!)).toContain(utility);
      }
    }
  });

  it("associates each label with its field explicitly, not by wrapping", async () => {
    // `htmlFor` appeared zero times in the repo before spec #451 S5. A wrapping label
    // is a valid association and a weaker one: several screen readers announce the
    // explicit pairing and not the implicit one, and the wrap is what a refactor drops
    // without noticing. The ids are asserted UNIQUE because two fields sharing one id
    // is the failure that leaves `getByLabelText` green and the second field unnamed.
    const { container } = await renderLoginPage();
    const labels = [...container.querySelectorAll("label")];

    const ids = labels.map((label) => {
      const target = label.getAttribute("for");
      expect(target).toBeTruthy();
      const field = container.querySelector(`#${target}`)!;
      expect(field.tagName).toBe("INPUT");
      expect(label.contains(field)).toBe(false);
      return target;
    });
    expect(new Set(ids).size).toBe(2);
  });

  it("puts `.auth-card input`'s box, the package tokens and a focus ring on both inputs", async () => {
    const { container } = await renderLoginPage();
    const inputs = [...container.querySelectorAll("input")];
    expect(inputs).toHaveLength(2);

    for (const input of inputs) {
      for (const utility of [
        "p-2.5",
        "rounded-lg",
        "border",
        // Spec #451 §4.2: app-side TSX paints with `--nms-*`. The border read is
        // `--nms-input` and NOT `--nms-border`, which is the hairline; S3 unaliased
        // the two so this edge could clear 3:1 without repainting eight surfaces.
        "border-[var(--nms-input)]",
        "bg-[var(--nms-background)]",
        // `--nms-foreground`, never `--nms-muted`: the app's `--muted` is muted TEXT
        // and the package's `--nms-muted` is a recessed SURFACE.
        "text-[var(--nms-foreground)]",
        "text-[1rem]",
        // These two were the only controls in the app falling through to the user
        // agent's focus ring. The shape is the package's own, off the fill path's
        // rung rows; the colour is `--nms-ring`, which is what every Button variant
        // rings with.
        "focus-visible:outline-2",
        "focus-visible:outline-[var(--nms-ring)]",
        "focus-visible:outline-offset-2",
      ]) {
        expect(classes(input)).toContain(utility);
      }
    }
  });

  it("leaves the submit button carrying the package's classes and none of the house's", async () => {
    await renderLoginPage();
    const button = screen.getByRole("button", { name: "Sign in" });

    // The whole slice: the house rule is gone and nothing replaced it, so the package
    // `Button`'s own geometry and fill are what render.
    expect(classes(button)).toContain("bg-primary");
    for (const houseUtility of [
      "bg-[var(--accent)]",
      "text-[var(--accent-text)]",
      "p-[11px]",
      "rounded-lg",
    ]) {
      expect(classes(button)).not.toContain(houseUtility);
    }
  });

  it("puts `.error`'s colour AND all four zeroed margins on the error paragraph", async () => {
    signInEmail.mockClear();
    signInEmail.mockImplementationOnce(
      () =>
        Promise.resolve({ error: { message: "Invalid email or password" } }) as never,
    );
    const { container } = await renderLoginPage();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Email"), "operator@example.test");
    await user.type(screen.getByLabelText("Password"), "authored-secret");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    const paragraph = await screen.findByText("Invalid email or password");
    expect(paragraph.tagName).toBe("P");
    // `--nms-destructive`, NOT `--nms-neg` (spec #451 §4.2). `apps/web` resolves both
    // to the same hex today, so this is the one read in the file where a wrong choice
    // is invisible on screen and wrong in the vocabulary: `--nms-neg` is data, the sign
    // of a number, and a failed sign-in is the affordance of a control.
    expect(classes(paragraph)).toContain("text-[var(--nms-destructive)]");
    expect(classes(paragraph)).toContain("m-0");
    expect(container.contains(paragraph)).toBe(true);
    // The paragraph's only styling came from `.error`, so the name goes with the rule.
    expect(classes(paragraph)).not.toContain("error");
  });

  it("announces a failed sign-in, and points both fields at what it says", async () => {
    // A FAILED SIGN-IN WAS SILENT (SC 4.1.3). The paragraph appeared, nothing said so,
    // and the operator's focus was still on the submit button. `role="alert"` is the
    // live region; `aria-live` is stated alongside it because the implicit politeness
    // of the role is exactly the thing a reader has to look up. Both fields point at
    // it, so the reason is re-read when focus returns to the field that caused it.
    signInEmail.mockClear();
    signInEmail.mockImplementationOnce(
      () =>
        Promise.resolve({ error: { message: "Invalid email or password" } }) as never,
    );
    const { container } = await renderLoginPage();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Email"), "operator@example.test");
    await user.type(screen.getByLabelText("Password"), "authored-secret");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    const paragraph = await screen.findByRole("alert");
    expect(paragraph.textContent).toBe("Invalid email or password");
    expect(paragraph.getAttribute("aria-live")).toBe("assertive");

    const described = paragraph.getAttribute("id")!;
    expect(described).toBeTruthy();
    for (const input of container.querySelectorAll("input")) {
      expect(input.getAttribute("aria-describedby")).toBe(described);
    }
  });

  it("reads no app-name colour anywhere on the page", async () => {
    // Spec #451 §4.2 and §8 signal 4: after the rewrite the second `:root` block in
    // `styles.css` is the app's one-way translation layer, and the ten app names are
    // implementation behind it. This is the RENDERED channel of that claim — the file
    // text is the wave's own check — and it catches the one thing a grep of the source
    // would not: an app name arriving on this page through an imported class string.
    const { container } = await renderLoginPage();
    const rendered = classCensus(container.firstElementChild!).join(" ");

    for (const appName of ["--bg", "--line", "--muted", "--text", "--neg"]) {
      expect([appName, rendered.includes(`var(${appName})`)]).toEqual([appName, false]);
    }
  });

  it("renders no `auth`, `auth-card` or `error` class name anywhere on the page", async () => {
    const { container } = await renderLoginPage();
    const rendered = new Set(
      classCensus(container.firstElementChild!).flatMap((attribute) =>
        attribute.split(/\s+/).filter(Boolean),
      ),
    );

    for (const deleted of ["auth", "auth-card", "error"]) {
      expect([...rendered]).not.toContain(deleted);
    }
  });
});
