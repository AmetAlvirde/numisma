"use client";

import { signOut } from "next-auth/react";
import { ThemeSelector } from "@/components/utils/theme-selector";
import { Button } from "@/components/ui/button";
import {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
} from "@/components/ui/navigation-menu";

export function Navbar() {
  return (
    <nav className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center justify-between px-4 max-w-7xl mx-auto">
        {/* Left side: Brand/Logo */}
        <div className="flex items-center">
          <span className="text-lg font-semibold">Numisma</span>
        </div>

        {/* Center: Navigation Menu (hidden for now, ready for future items) */}
        <NavigationMenu className="hidden md:flex">
          <NavigationMenuList>
            <NavigationMenuItem>
              {/* Future navigation items can be added here */}
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>

        {/* Right side: User actions wrapped in NavigationMenu structure */}
        <NavigationMenu>
          <NavigationMenuList>
            <NavigationMenuItem>
              <div className="flex items-center gap-2">
                <ThemeSelector />
                <Button
                  variant="outline"
                  onClick={() => signOut({ callbackUrl: "/api/auth/signin" })}
                >
                  Sign Out
                </Button>
              </div>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>
      </div>
    </nav>
  );
}
