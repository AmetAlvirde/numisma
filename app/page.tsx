"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="container mx-auto py-16">
      <div className="max-w-2xl mx-auto text-center space-y-8">
        <h1 className="text-4xl font-bold">Welcome to Numisma</h1>
        <p className="text-xl text-muted-foreground">
          Your personal portfolio management tool for tracking and analyzing
          your positions.
        </p>
        <div className="flex gap-4 justify-center">
          <Link href="/dashboard">
            <Button size="lg">View Dashboard</Button>
          </Link>
          <Link href="/positions/new">
            <Button size="lg" variant="outline">
              Create Position
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
