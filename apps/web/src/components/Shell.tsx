import type { ReactNode } from "react";

/**
 * The page chrome both surfaces share (D11). Extracted out of the old dashboard
 * route when `/` became the glance and the composition page moved to
 * `/big-picture`: the move must leave ONE page's worth of chrome, not two copies
 * free to drift.
 */
export function Shell({ children }: { children: ReactNode }) {
  return <main className="dashboard">{children}</main>;
}
