"use client";

import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "@/utils/cn";

interface PositionSetupDiagramProps
  extends React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> {
  value?: number; // Progress value from 0 to 100
}

const PositionSetupDiagram = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  PositionSetupDiagramProps
>(({ className, value = 0, ...props }, ref) => {
  // Clamp value between 0 and 100
  const progress = Math.max(0, Math.min(100, value));

  // Calculate segment widths based on progress
  const redSegment = Math.min(progress, 20); // 0-20%
  const blueSegment = Math.max(0, Math.min(progress - 20, 40)); // 20-60%
  const greenSegment = Math.max(0, progress - 60); // 60-100%

  return (
    <ProgressPrimitive.Root
      ref={ref}
      className={cn(
        "relative h-4 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800",
        className
      )}
      {...props}
    >
      {/* Red segment: 0-20% */}
      {redSegment > 0 && (
        <ProgressPrimitive.Indicator
          className="absolute left-0 top-0 h-full bg-red-500 transition-all duration-300 ease-in-out"
          style={{
            width: `${(redSegment / 100) * 100}%`,
            transform: "translateX(0%)",
          }}
        />
      )}

      {/* Blue segment: 20-60% */}
      {blueSegment > 0 && (
        <ProgressPrimitive.Indicator
          className="absolute top-0 h-full bg-blue-500 transition-all duration-300 ease-in-out"
          style={{
            left: "20%",
            width: `${(blueSegment / 100) * 100}%`,
            transform: "translateX(0%)",
          }}
        />
      )}

      {/* Green segment: 60-100% */}
      {greenSegment > 0 && (
        <ProgressPrimitive.Indicator
          className="absolute top-0 h-full bg-green-500 transition-all duration-300 ease-in-out"
          style={{
            left: "60%",
            width: `${(greenSegment / 100) * 100}%`,
            transform: "translateX(0%)",
          }}
        />
      )}

      {/* Optional: Add segment dividers */}
      <div className="absolute top-0 left-[20%] h-full w-px bg-white/20" />
      <div className="absolute top-0 left-[60%] h-full w-px bg-white/20" />
    </ProgressPrimitive.Root>
  );
});

PositionSetupDiagram.displayName = ProgressPrimitive.Root.displayName;

export { PositionSetupDiagram };
