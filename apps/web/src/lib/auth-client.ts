/**
 * Better Auth browser client. Talks to the /api/auth/* handler on the same
 * origin, so no baseURL is needed. Used by the login page (single-tenant: open
 * signup is disabled, so there is no signup page — see src/lib/auth.ts).
 */
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();
