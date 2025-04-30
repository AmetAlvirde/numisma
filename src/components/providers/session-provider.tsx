"use client";

import type { Session } from "next-auth";
import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  session: Session | null; // Accept session as a prop
}

export function NextAuthProvider({ children, session }: Props) {
  return <SessionProvider session={session}>{children}</SessionProvider>;
}
