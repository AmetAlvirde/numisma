"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Session } from "next-auth";
import { usePortfolio } from "@/components/providers/portfolio-provider";
import Link from "next/link";

export function AccountHeader({ session }: { session: Session }) {
  const { pinnedPortfolio, isLoading, isError, hasPinnedPortfolio } =
    usePortfolio();

  // Determine display name based on state
  let displayName: string;
  if (isLoading) {
    displayName = "Loading...";
  } else if (isError || !hasPinnedPortfolio) {
    displayName = "Portfolio";
  } else {
    displayName = pinnedPortfolio?.name ?? "Portfolio";
  }

  const portfolioId = pinnedPortfolio?.id;

  return (
    <div>
      <section className="flex" id="account-header">
        <div className="grow">
          {portfolioId ? (
            <Link href={`/portfolios/${portfolioId}`}>
              <h2 className="text-2xl font-semibold hover:underline">
                {displayName}
              </h2>
            </Link>
          ) : (
            <h2 className="text-2xl font-semibold">{displayName}</h2>
          )}
          <p className="text-md text-muted-foreground">
            Welcome back, <span className="font-bold">Amet!</span>
          </p>
          <p className="text-sm text-muted-foreground font-mono">25W40X</p>
        </div>
        <Avatar className="h-16 w-16 m-2">
          <AvatarImage
            src={session.user?.image || ""}
            alt={session.user?.name || "User"}
          />
          <AvatarFallback>
            {session.user?.name?.charAt(0).toUpperCase() || "U"}
          </AvatarFallback>
        </Avatar>
      </section>
    </div>
  );
}
