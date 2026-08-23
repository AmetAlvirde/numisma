// @vitest-environment jsdom
/**
 * THE FIRST REAL ADOPTION — the sign-in submit button renders through the package
 * `Button` (spec #412, Slice 5).
 *
 * This is a PROVENANCE AND STYLING change, and the whole risk of it is that the
 * provenance arrives and the behavior leaves with it. `@numisma/components`' `Button`
 * wraps Base UI's, and Base UI's button hands the element `type: "button"` by default —
 * the merge puts external props last, so an explicit `type="submit"` wins, and dropping
 * that one attribute turns the sign-in form into a form no click submits. Nothing about
 * the rendered page looks different when that happens, so this file asserts it.
 *
 * The four claims, each one a way the swap can regress silently:
 *
 *   1. THE ELEMENT IS THE PACKAGE'S. `data-slot="button"` is the package's marker and
 *      `bg-primary` is the class the token contract paints through. A hand-written
 *      `<button>` restored here would look identical until the palette moved.
 *   2. IT STILL SUBMITS. `type="submit"`, and a click runs the sign-in mutation.
 *   3. ITS ACCESSIBLE NAME AND PENDING COPY ARE UNCHANGED — "Sign in", then
 *      "Signing in…" while the request is in flight.
 *   4. IT IS DISABLED WHILE PENDING, on the element and not merely in a class. Base UI
 *      can express a disabled button as `aria-disabled` on a non-native element; this
 *      one is native and owes the real attribute, or the operator double-submits.
 *
 * IT MOUNTS UNDER A MEMORY ROUTER AND A QUERY CLIENT, because the page reads both:
 * `useRouter` for the post-sign-in navigate, `useMutation` for the request. The auth
 * client is the one thing stubbed — a real `signIn.email` would reach the network — and
 * it is stubbed with a promise that never settles, which is what makes the pending arm
 * observable at all.
 *
 * Every value below is authored. No account, no credential and no captured response has
 * been near this file.
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

import { render, screen, userEvent } from "../render.testkit.tsx";
import { Route } from "./login.tsx";

/** Never settles, so the pending arm stays on screen long enough to assert. */
const signInEmail = vi.fn((_credentials: unknown) => new Promise<never>(() => {}));

vi.mock("../lib/auth-client.ts", () => ({
  authClient: { signIn: { email: (credentials: unknown) => signInEmail(credentials) } },
}));


/**
 * The page component, reached through the route's own options rather than through a
 * second export. A route file that exports anything besides `Route` opts that export out
 * of TanStack's code splitting and says so on every dev start; this reads the component
 * the router itself would render, which is also the more honest subject.
 */
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
      {/* The router's type is registered against the app's route tree; this authored
          tree is not that tree, which is the one place a test-local router says so. */}
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: "Sign in" });
  return result;
}

describe("the sign-in submit button", () => {
  it("is the package Button, carrying its slot marker and its themed fill", async () => {
    await renderLoginPage();
    const button = screen.getByRole("button", { name: "Sign in" });

    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("data-slot")).toBe("button");
    expect(button.className.split(/\s+/)).toContain("bg-primary");
  });

  it("keeps submitting the form — the attribute Base UI would otherwise default away", async () => {
    await renderLoginPage();
    expect(
      screen.getByRole("button", { name: "Sign in" }).getAttribute("type"),
    ).toBe("submit");
  });

  it("goes disabled with the pending copy once the request is in flight", async () => {
    signInEmail.mockClear();
    await renderLoginPage();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Email"), "operator@example.test");
    await user.type(screen.getByLabelText("Password"), "authored-secret");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    const pending = await screen.findByRole("button", { name: "Signing in…" });
    expect((pending as HTMLButtonElement).disabled).toBe(true);
    expect(signInEmail).toHaveBeenCalledTimes(1);
  });
});
