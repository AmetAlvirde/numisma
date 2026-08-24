import type { ReactNode } from "react";

/**
 * The page chrome both surfaces share (D11). Extracted out of the old dashboard
 * route when `/` became the glance and the composition page moved to
 * `/big-picture`: the move must leave ONE page's worth of chrome, not two copies
 * free to drift.
 *
 * `.dashboard` IS DELETED (spec #420 slice 2) and this is the whole of it: a capped
 * centred column, 16px in from the edge, its cards 16px apart. Login spells the same
 * six utilities plus its own full-height centring, which is what `.dashboard, .auth`
 * used to say — two call sites, no shared rule, and neither one implicit.
 *
 * `my-0` IS NOT DECORATION. `margin: 0 auto` set all four edges and preflight is off,
 * so `mx-auto` alone would leave the UA's own `main` margins standing.
 */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto my-0 flex max-w-[760px] flex-col gap-4 p-4">
      {children}
    </main>
  );
}
