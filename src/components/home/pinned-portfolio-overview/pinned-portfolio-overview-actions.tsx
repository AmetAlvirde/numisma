"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Plus, ArrowRightLeft } from "lucide-react";

interface PinnedPortfolioOverviewActionsProps {
  isDropdownOpen: boolean;
  onDropdownOpenChange: (open: boolean) => void;
  onChangePinnedPortfolio: () => void;
  onAddPinnedPortfolio: () => void;
}

export function PinnedPortfolioOverviewActions({
  isDropdownOpen,
  onDropdownOpenChange,
  onChangePinnedPortfolio,
  onAddPinnedPortfolio,
}: PinnedPortfolioOverviewActionsProps) {
  return (
    <DropdownMenu open={isDropdownOpen} onOpenChange={onDropdownOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" type="button">
          <MoreHorizontal className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[200px]">
        <DropdownMenuItem
          onClick={e => {
            e.preventDefault();
            onChangePinnedPortfolio();
          }}
        >
          <ArrowRightLeft className="mr-2 h-4 w-4" />
          <span>Change pinned portfolio</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={e => {
            e.preventDefault();
            onAddPinnedPortfolio();
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          <span>Add pinned portfolio</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
