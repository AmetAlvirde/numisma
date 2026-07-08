/**
 * Better Auth browser client. Talks to the /api/auth/* handler on the same
 * origin, so no baseURL is needed. Used by the login + signup pages.
 */
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();
