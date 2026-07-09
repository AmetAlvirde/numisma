import { createFileRoute } from "@tanstack/react-router";
import { auth } from "../../../lib/auth.ts";

/** Better Auth request handler — mounts /api/auth/* onto the auth instance. */
export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => auth.handler(request),
      POST: ({ request }) => auth.handler(request),
    },
  },
});
