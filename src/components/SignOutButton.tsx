"use client";

import React from "react";
import { signOut } from "next-auth/react";
// Assuming you have a ShadCN Button component installed and configured
// If not, we can use a standard HTML button
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  return (
    <Button
      variant="outline"
      onClick={() => signOut({ callbackUrl: "/api/auth/signin" })} // Redirect to signin page after sign out
    >
      Sign Out
    </Button>
  );
}
