/**
 * Session-gated dashboard server function (Deliverable E).
 *
 * Runs SERVER-SIDE ONLY. It (1) checks the Better Auth session and redirects to
 * /login when unauthenticated, then (2) reads the latest snapshot through the
 * READ-ONLY projection pool. The read credential and raw `pg` access live only
 * in this server function — they never reach the browser bundle.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { redirect } from "@tanstack/react-router";
import { auth } from "./auth.ts";
import {
  getLatestSnapshot,
  getReaderPool,
  type LatestSnapshot,
} from "../projection/contract.ts";

export const getDashboard = createServerFn({ method: "GET" }).handler(
  async (): Promise<LatestSnapshot> => {
    // getRequest() yields the underlying web Request; its `.headers` is a real
    // Headers carrying the incoming cookie. (getRequestHeaders() returns a
    // Headers instance too — do NOT Object.entries() it, that yields nothing.)
    const { headers } = getRequest();
    const session = await auth.api.getSession({ headers });
    if (!session) {
      throw redirect({ to: "/login" });
    }
    return getLatestSnapshot(getReaderPool());
  },
);
