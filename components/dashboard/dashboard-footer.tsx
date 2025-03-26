/**
 * dashboard-footer.tsx - Footer component for the dashboard
 *
 * This component provides the footer section of the dashboard, including:
 * - Copyright information
 * - Links to important resources
 * - Version information
 *
 * The footer is designed to be responsive and follows the Numisma design system.
 */

"use client";

import { Separator } from "@/components/ui/separator";

export function DashboardFooter() {
  return (
    <footer className="border-t py-6 md:py-0">
      <div className="container flex flex-col items-center justify-between gap-4 md:h-24 md:flex-row">
        <div className="flex flex-col items-center gap-4 px-8 md:flex-row md:gap-2 md:px-0">
          <p className="text-center text-sm leading-loose text-muted-foreground md:text-left">
            Built by{" "}
            <a
              href="https://mycelium.institute"
              target="_blank"
              rel="noreferrer"
              className="font-medium underline underline-offset-4"
            >
              Mycelium Institute
            </a>
            . The source code is available on{" "}
            <a
              href="https://github.com/mycelium-institute/numisma"
              target="_blank"
              rel="noreferrer"
              className="font-medium underline underline-offset-4"
            >
              GitHub
            </a>
            .
          </p>
        </div>
        <div className="flex items-center space-x-4">
          <Separator orientation="vertical" className="h-6" />
          <a
            href="/privacy"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Privacy
          </a>
          <a
            href="/terms"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Terms
          </a>
          <span className="text-sm text-muted-foreground">Version 1.0.0</span>
        </div>
      </div>
    </footer>
  );
}
