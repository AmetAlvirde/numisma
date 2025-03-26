/**
 * dashboard-layout.tsx - Main layout component for the dashboard
 *
 * This component provides the basic structure for the dashboard, including:
 * - A responsive grid layout
 * - A collapsible sidebar
 * - A header with user information
 * - A main content area
 * - A footer
 *
 * The layout is designed to be mobile-first and uses CSS Grid for responsive behavior.
 * It follows the Numisma design system and accessibility guidelines.
 */

"use client";

import { ReactNode } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";
import { DashboardSidebar } from "./dashboard-sidebar";

interface DashboardLayoutProps {
  /** The main content to be displayed in the dashboard */
  children: ReactNode;
  /** The user's name to display in the header */
  userName: string;
  /** The user's avatar URL */
  avatarUrl?: string;
}

export function DashboardLayout({
  children,
  userName,
  avatarUrl,
}: DashboardLayoutProps) {
  return (
    <div className="relative min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center">
          {/* Mobile menu button */}
          <Sheet>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="mr-2 md:hidden"
                aria-label="Toggle menu"
              >
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[240px] sm:w-[280px]">
              <DashboardSidebar />
            </SheetContent>
          </Sheet>

          {/* Logo */}
          <div className="mr-4 hidden md:flex">
            <a className="mr-6 flex items-center space-x-2" href="/">
              <span className="hidden font-bold sm:inline-block">Numisma</span>
            </a>
          </div>

          {/* User info */}
          <div className="flex flex-1 items-center justify-between space-x-2 md:justify-end">
            <div className="w-full flex-1 md:w-auto md:flex-none">
              {/* Search will go here */}
            </div>
            <nav className="flex items-center space-x-2">
              {/* User menu will go here */}
            </nav>
          </div>
        </div>
      </header>

      {/* Main layout */}
      <div className="flex min-h-[calc(100vh-3.5rem)]">
        {/* Sidebar - hidden on mobile */}
        <aside className="hidden w-[240px] flex-shrink-0 border-r md:block">
          <DashboardSidebar />
        </aside>

        {/* Main content */}
        <main className="flex-1">
          <div className="h-full">{children}</div>
        </main>
      </div>

      {/* Footer */}
      <footer className="border-t">
        <div className="container flex flex-col items-center justify-between gap-4 py-6 md:h-24 md:flex-row md:py-0">
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
        </div>
      </footer>
    </div>
  );
}
