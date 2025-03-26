/**
 * dashboard-sidebar.tsx - Sidebar component for the dashboard
 *
 * This component provides the sidebar navigation for the dashboard, including:
 * - Main navigation links
 * - Portfolio management section
 * - Settings and other utility links
 *
 * The sidebar is designed to be responsive and follows the Numisma design system.
 */

"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  LayoutDashboard,
  Wallet,
  LineChart,
  Settings,
  HelpCircle,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

interface NavItem {
  title: string;
  href: string;
  icon: React.ReactNode;
  items?: NavItem[];
}

const mainNav: NavItem[] = [
  {
    title: "Dashboard",
    href: "/dashboard",
    icon: <LayoutDashboard className="h-4 w-4" />,
  },
  {
    title: "Portfolios",
    href: "/portfolios",
    icon: <Wallet className="h-4 w-4" />,
    items: [
      {
        title: "All Portfolios",
        href: "/portfolios",
        icon: <ChevronRight className="h-4 w-4" />,
      },
      {
        title: "Create Portfolio",
        href: "/portfolios/new",
        icon: <ChevronRight className="h-4 w-4" />,
      },
    ],
  },
  {
    title: "Analytics",
    href: "/analytics",
    icon: <LineChart className="h-4 w-4" />,
  },
];

const utilityNav: NavItem[] = [
  {
    title: "Settings",
    href: "/settings",
    icon: <Settings className="h-4 w-4" />,
  },
  {
    title: "Help",
    href: "/help",
    icon: <HelpCircle className="h-4 w-4" />,
  },
];

interface DashboardSidebarProps {
  /** Whether the sidebar is collapsed */
  isCollapsed?: boolean;
}

export function DashboardSidebar({
  isCollapsed = false,
}: DashboardSidebarProps) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);

  // Only render the component after it's mounted on the client
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return (
    <ScrollArea className="h-[calc(100vh-3.5rem)] py-6 pr-6 lg:py-8">
      <nav className="flex flex-col gap-4">
        {/* Main navigation */}
        <div className="space-y-1">
          <h4 className="px-2 text-xs font-semibold text-muted-foreground">
            Main
          </h4>
          {mainNav.map(item => (
            <div key={item.href}>
              <Button
                variant={pathname === item.href ? "secondary" : "ghost"}
                className={cn(
                  "w-full justify-start gap-2",
                  isCollapsed && "justify-center"
                )}
                asChild
              >
                <Link href={item.href}>
                  {item.icon}
                  {!isCollapsed && <span>{item.title}</span>}
                </Link>
              </Button>
              {item.items && !isCollapsed && (
                <div className="ml-4 mt-2 space-y-1">
                  {item.items.map(subItem => (
                    <Button
                      key={subItem.href}
                      variant={
                        pathname === subItem.href ? "secondary" : "ghost"
                      }
                      className="w-full justify-start gap-2"
                      asChild
                    >
                      <Link href={subItem.href}>
                        {subItem.icon}
                        <span>{subItem.title}</span>
                      </Link>
                    </Button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Utility navigation */}
        <div className="space-y-1">
          <h4 className="px-2 text-xs font-semibold text-muted-foreground">
            Utilities
          </h4>
          {utilityNav.map(item => (
            <Button
              key={item.href}
              variant={pathname === item.href ? "secondary" : "ghost"}
              className={cn(
                "w-full justify-start gap-2",
                isCollapsed && "justify-center"
              )}
              asChild
            >
              <Link href={item.href}>
                {item.icon}
                {!isCollapsed && <span>{item.title}</span>}
              </Link>
            </Button>
          ))}
        </div>
      </nav>
    </ScrollArea>
  );
}
