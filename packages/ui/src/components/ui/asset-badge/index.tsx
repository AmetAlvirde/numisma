// src/components/ui/asset-badge/asset-badge.tsx
import React from "react";
import { cn } from "@/lib/utils";

interface AssetBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  ticker: string;
  assetType?: string;
  iconUrl?: string;
}

export const AssetBadge = React.forwardRef<HTMLDivElement, AssetBadgeProps>(
  ({ ticker, assetType = "crypto", iconUrl, className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-sm font-medium",
          className
        )}
        {...props}
      >
        {iconUrl ? (
          <img src={iconUrl} alt={ticker} className="h-4 w-4 rounded-full" />
        ) : (
          <div className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold">
            {ticker.slice(0, 1)}
          </div>
        )}
        <span>{ticker}</span>
      </div>
    );
  }
);
AssetBadge.displayName = "AssetBadge";

// src/components/ui/asset-badge/index.ts
// export * from "./asset-badge";
